const fs = require("fs");
const fsPromises = require("fs").promises;
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const debugLogger = require("./debugLogger");
const { getSafeTempDir } = require("./safeTempDir");
const { convertToWav } = require("./ffmpegUtils");
const { killProcess } = require("../utils/process");
const {
  downloadFile,
  createDownloadSignal,
  validateFileSize,
  cleanupStaleDownloads,
  checkDiskSpace,
} = require("./downloadUtils");
const { getModelsDirForService } = require("./modelDirUtils");
const modelRegistryData = require("../models/modelRegistryData.json");

const DEFAULT_TIMEOUT_MS = 300000;

// sherpa-onnx release version whose binary can serve as paraformer-main CLI
const SHERPA_ONNX_VERSION = "1.12.23";
const SHERPA_ONNX_RELEASE_URL = `https://github.com/k2-fsa/sherpa-onnx/releases/download/v${SHERPA_ONNX_VERSION}`;

const SHERPA_RELEASE_INFO = {
  "darwin-arm64": {
    archiveName: `sherpa-onnx-v${SHERPA_ONNX_VERSION}-osx-universal2-shared.tar.bz2`,
    libPattern: "*.dylib",
  },
  "darwin-x64": {
    archiveName: `sherpa-onnx-v${SHERPA_ONNX_VERSION}-osx-universal2-shared.tar.bz2`,
    libPattern: "*.dylib",
  },
  "win32-x64": {
    archiveName: `sherpa-onnx-v${SHERPA_ONNX_VERSION}-win-x64-shared.tar.bz2`,
    libPattern: "*.dll",
  },
  "linux-x64": {
    archiveName: `sherpa-onnx-v${SHERPA_ONNX_VERSION}-linux-x64-shared.tar.bz2`,
    libPattern: "*.so*",
  },
};

function getParaformerModelConfig(modelName) {
  const modelInfo = modelRegistryData.paraformerModels?.[modelName];
  if (!modelInfo) return null;
  return {
    url: modelInfo.downloadUrl,
    size: modelInfo.sizeMb * 1_000_000,
    extractDir: modelInfo.extractDir,
  };
}

function getValidParaformerModelNames() {
  return Object.keys(modelRegistryData.paraformerModels || {});
}

function normalizeLanguage(language) {
  const value = String(language || "auto").trim().toLowerCase();
  const supported = new Set(["auto", "zh", "en"]);
  return supported.has(value) ? value : "auto";
}

function normalizeTranscript(text) {
  if (!text) return "";
  return text
    .replace(/<\|[^>]+?\|>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function sanitizeErrorSnippet(text, maxLength = 300) {
  const cleaned = String(text || "").replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength)}...` : cleaned;
}

function fileExists(filePath) {
  try {
    return !!filePath && fs.existsSync(filePath);
  } catch {
    return false;
  }
}

function ensureExecutable(filePath) {
  if (!fileExists(filePath)) return false;
  if (process.platform === "win32") return true;

  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    try {
      fs.chmodSync(filePath, 0o755);
      fs.accessSync(filePath, fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }
}

function toAudioBuffer(audioBlob) {
  if (Buffer.isBuffer(audioBlob)) {
    return audioBlob;
  }
  if (ArrayBuffer.isView(audioBlob)) {
    return Buffer.from(audioBlob.buffer, audioBlob.byteOffset, audioBlob.byteLength);
  }
  if (audioBlob instanceof ArrayBuffer) {
    return Buffer.from(audioBlob);
  }
  if (typeof audioBlob === "string") {
    return Buffer.from(audioBlob, "base64");
  }
  if (audioBlob && audioBlob.buffer && typeof audioBlob.byteLength === "number") {
    return Buffer.from(audioBlob.buffer, audioBlob.byteOffset || 0, audioBlob.byteLength);
  }

  throw new Error(`Unsupported audio data type: ${typeof audioBlob}`);
}

class ParaformerManager {
  constructor() {
    this.cachedBinaryPath = null;
    this.currentDownloadProcess = null;
    this.currentBinaryDownload = null;
    this._server = null;
  }

  _getServer() {
    if (!this._server) {
      const ParaformerServerManager = require("./paraformerServer");
      this._server = new ParaformerServerManager();
    }
    return this._server;
  }

  async stopServer() {
    if (this._server) {
      await this._server.stopServer();
    }
  }

  getServerStatus() {
    return this._server ? this._server.getServerStatus() : { running: false };
  }

  getModelsDir() {
    return getModelsDirForService("paraformer");
  }

  getBinDir() {
    const homeDir = os.homedir();
    return path.join(homeDir, ".cache", "chordvoxmini", "bin");
  }

  _getSherpaReleaseInfo() {
    const key = `${process.platform}-${process.arch}`;
    const info = SHERPA_RELEASE_INFO[key];
    if (!info) {
      throw new Error(`Unsupported platform for Paraformer binary download: ${key}`);
    }
    return info;
  }

  validateModelName(modelName) {
    const validModels = getValidParaformerModelNames();
    if (!validModels.includes(modelName)) {
      throw new Error(
        `Invalid Paraformer model: ${modelName}. Valid models: ${validModels.join(", ")}`
      );
    }
    return true;
  }

  getModelDir(modelName) {
    this.validateModelName(modelName);
    return path.join(this.getModelsDir(), modelName);
  }

  _getBinaryName() {
    return process.platform === "win32" ? "paraformer-main.exe" : "paraformer-main";
  }

  _findBinaryInPath(binaryName) {
    const pathEnv = process.env.PATH || "";
    const separator = process.platform === "win32" ? ";" : ":";
    const candidates = pathEnv.split(separator).filter(Boolean);

    for (const dir of candidates) {
      const cleanDir = dir.replace(/^"|"$/g, "");
      const candidate = path.join(cleanDir, binaryName);
      if (ensureExecutable(candidate)) {
        return candidate;
      }
    }

    return null;
  }

  _resolveBinaryPath(customPath) {
    if (this.cachedBinaryPath && !customPath) {
      return this.cachedBinaryPath;
    }

    const binaryName = this._getBinaryName();
    const candidates = [];

    if (customPath && String(customPath).trim()) {
      candidates.push(String(customPath).trim());
    }
    if (process.env.PARAFORMER_BINARY_PATH) {
      candidates.push(process.env.PARAFORMER_BINARY_PATH);
    }

    // Check the download bin dir (~/.cache/chordvox/bin/)
    candidates.push(path.join(this.getBinDir(), binaryName));

    const home = os.homedir();
    candidates.push(
      path.join(home, "Tools", "Paraformer.cpp", "build", "bin", binaryName),
      path.join(home, "Tools", "sherpa-onnx", "build", "bin", binaryName),
      path.join(home, "paraformer", "build", "bin", binaryName)
    );

    if (process.resourcesPath) {
      candidates.push(
        path.join(process.resourcesPath, "bin", binaryName),
        path.join(process.resourcesPath, "app.asar.unpacked", "bin", binaryName)
      );
    }

    for (const candidate of candidates) {
      if (ensureExecutable(candidate)) {
        if (!customPath) {
          this.cachedBinaryPath = candidate;
        }
        return candidate;
      }
    }

    const fromPath = this._findBinaryInPath(binaryName);
    if (fromPath) {
      if (!customPath) {
        this.cachedBinaryPath = fromPath;
      }
      return fromPath;
    }

    throw new Error(
      "Paraformer binary not found. Configure paraformer-main path in settings."
    );
  }

  checkBinaryStatus() {
    try {
      const resolved = this._resolveBinaryPath();
      return { installed: true, path: resolved };
    } catch {
      return { installed: false, path: "" };
    }
  }

  async downloadBinary(progressCallback) {
    const releaseInfo = this._getSherpaReleaseInfo();
    const binDir = this.getBinDir();
    await fsPromises.mkdir(binDir, { recursive: true });

    const binaryName = this._getBinaryName();
    const outputPath = path.join(binDir, binaryName);

    // Check if already installed
    if (ensureExecutable(outputPath)) {
      debugLogger.info("Paraformer binary already installed", { path: outputPath });
      return { success: true, path: outputPath };
    }

    if (this.currentBinaryDownload) {
      debugLogger.warn("Paraformer binary download already in progress");
      return { success: false, error: "Download already in progress" };
    }

    const url = `${SHERPA_ONNX_RELEASE_URL}/${releaseInfo.archiveName}`;
    const archivePath = path.join(getSafeTempDir(), releaseInfo.archiveName);
    const extractDir = path.join(getSafeTempDir(), `sherpa-extract-${Date.now()}`);

    try {
      // Progress: downloading
      if (progressCallback) {
        progressCallback({ type: "download", percentage: 0 });
      }

      const { signal, abort } = createDownloadSignal();
      this.currentBinaryDownload = { abort };

      await downloadFile(url, archivePath, {
        timeout: 600000,
        signal,
        onProgress: (downloadedBytes, totalBytes) => {
          if (progressCallback) {
            const pct = totalBytes > 0 ? Math.round((downloadedBytes / totalBytes) * 90) : 0;
            progressCallback({
              type: "download",
              percentage: pct,
              downloadedBytes,
              totalBytes,
            });
          }
        },
      });

      // Progress: extracting
      if (progressCallback) {
        progressCallback({ type: "extract", percentage: 92 });
      }

      // Extract tarball
      await fsPromises.mkdir(extractDir, { recursive: true });
      const { execSync } = require("child_process");
      try {
        execSync(`tar -xjf "${archivePath}" -C "${extractDir}"`, { timeout: 120000 });
      } catch (extractError) {
        throw new Error(`Extraction failed: ${extractError.message}`);
      }

      // Find the offline CLI binary in the extracted directory
      const offlineBinaryPath = this._findFileInDir(extractDir, "sherpa-onnx-offline");
      if (!offlineBinaryPath || !fs.existsSync(offlineBinaryPath)) {
        throw new Error("sherpa-onnx-offline binary not found in extracted archive");
      }

      // Copy the binary to the target location
      fs.copyFileSync(offlineBinaryPath, outputPath);
      fs.chmodSync(outputPath, 0o755);

      // Copy shared libraries alongside the binary
      const libPatterns = {
        "darwin": "*.dylib",
        "win32": "*.dll",
        "linux": "*.so",
      };
      const pattern = libPatterns[process.platform];
      if (pattern) {
        const libDir = path.dirname(outputPath);
        const libs = this._findFilesByPattern(extractDir, pattern);
        for (const libPath of libs) {
          const libName = path.basename(libPath);
          const destPath = path.join(libDir, libName);
          if (!fs.existsSync(destPath)) {
            fs.copyFileSync(libPath, destPath);
            if (process.platform !== "win32") {
              fs.chmodSync(destPath, 0o755);
            }
          }
        }
      }

      // Progress: complete
      if (progressCallback) {
        progressCallback({ type: "complete", percentage: 100 });
      }

      // Clear cached path so next resolve picks up the new binary
      this.cachedBinaryPath = null;

      debugLogger.info("Paraformer binary installed", { path: outputPath });
      return { success: true, path: outputPath };
    } catch (error) {
      if (error.isAbort) {
        return { success: false, error: "Download cancelled by user" };
      }
      debugLogger.error("Failed to download Paraformer binary", error);
      if (progressCallback) {
        progressCallback({ type: "error", percentage: 0, error: error.message });
      }
      return { success: false, error: error.message };
    } finally {
      this.currentBinaryDownload = null;
      // Cleanup temp files
      try { if (fs.existsSync(archivePath)) fs.unlinkSync(archivePath); } catch {}
      try { if (fs.existsSync(extractDir)) fs.rmSync(extractDir, { recursive: true, force: true }); } catch {}
    }
  }

  cancelBinaryDownload() {
    if (this.currentBinaryDownload) {
      this.currentBinaryDownload.abort();
      this.currentBinaryDownload = null;
      return { success: true };
    }
    return { success: false, error: "No active binary download" };
  }

  _findFileInDir(dir, fileName, maxDepth = 5, depth = 0) {
    if (depth >= maxDepth) return null;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return null; }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const found = this._findFileInDir(fullPath, fileName, maxDepth, depth + 1);
        if (found) return found;
      } else if (entry.name === fileName) {
        return fullPath;
      }
    }
    return null;
  }

  _findFilesByPattern(dir, pattern, maxDepth = 5, depth = 0) {
    if (depth >= maxDepth) return [];
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return []; }

    const matches = (name) => {
      if (pattern === "*.dylib") return name.endsWith(".dylib");
      if (pattern === "*.dll") return name.endsWith(".dll");
      if (pattern === "*.so*") return /\.so(\.\d+)*$/.test(name) || name.endsWith(".so");
      return name.endsWith(pattern.slice(1));
    };

    const results = [];
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...this._findFilesByPattern(fullPath, pattern, maxDepth, depth + 1));
      } else if (matches(entry.name)) {
        results.push(fullPath);
      }
    }
    return results;
  }

  _resolveModelPath(modelPath) {
    const resolved = String(modelPath || process.env.PARAFORMER_MODEL_PATH || "").trim();
    if (!resolved) {
      throw new Error("Paraformer model path is empty. Please select a model directory.");
    }

    // If it's a known model name, resolve to the models dir
    if (getValidParaformerModelNames().includes(resolved)) {
      const modelDir = this.getModelDir(resolved);
      if (!this._isModelDirectoryValid(modelDir)) {
        throw new Error(`Paraformer model directory not found or invalid: ${modelDir}`);
      }
      return modelDir;
    }

    // It's a direct path
    if (!this._isModelDirectoryValid(resolved)) {
      throw new Error(`Paraformer model directory not found or invalid: ${resolved}`);
    }
    return resolved;
  }

  _isModelDirectoryValid(modelDir) {
    if (!modelDir || !fs.existsSync(modelDir)) return false;
    return (
      fs.existsSync(path.join(modelDir, "model.onnx")) &&
      fs.existsSync(path.join(modelDir, "tokens.txt"))
    );
  }

  _extractText(output) {
    if (!output) return "";

    // Split into lines and process reverse to find the most recent result
    const lines = output.split(/\r?\n/).filter(Boolean);

    // Try to parse sherpa-onnx JSON output format: {"text": "...", "tokens": [...]}
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      try {
        const parsed = JSON.parse(line);
        if (parsed.text && typeof parsed.text === "string" && parsed.text.trim()) {
          return normalizeTranscript(parsed.text);
        }
      } catch {
        // Not JSON, continue
      }

      // Also try to match a plain text line that isn't a known noise line
      const lower = line.toLowerCase();
      if (
        line.startsWith("----") ||
        lower.includes("num threads") ||
        lower.includes("decoding method") ||
        lower.includes("elapsed seconds") ||
        lower.includes("real time factor") ||
        lower.includes("creating recognizer") ||
        lower.includes("recognizer created") ||
        lower.startsWith("started") ||
        lower.startsWith("done") ||
        lower.includes(".cc:") ||
        lower.endsWith(".wav") ||
        lower.endsWith(".mp3") ||
        line.startsWith("OfflineRecognizerConfig")
      ) {
        continue;
      }

      const normalized = normalizeTranscript(line);
      if (normalized) {
        return normalized;
      }
    }

    return "";
  }

  async checkInstallation(binaryPath = "") {
    try {
      const resolved = this._resolveBinaryPath(binaryPath);
      return { installed: true, working: true, path: resolved };
    } catch (error) {
      return { installed: false, working: false, error: error.message };
    }
  }

  async initializeAtStartup() {
    try {
      await cleanupStaleDownloads(this.getModelsDir());
    } catch (error) {
      debugLogger.warn("Paraformer initialization warning", { error: error.message });
    }
  }

  async checkModelStatus(modelPathOrName = "") {
    const input = String(modelPathOrName || "").trim();
    if (!input) {
      return { success: true, modelPath: "", downloaded: false };
    }

    if (getValidParaformerModelNames().includes(input)) {
      const modelDir = this.getModelDir(input);
      if (!this._isModelDirectoryValid(modelDir)) {
        return { success: true, model: input, modelPath: modelDir, downloaded: false };
      }

      try {
        const modelOnnxPath = path.join(modelDir, "model.onnx");
        const stats = fs.statSync(modelOnnxPath);
        return {
          success: true,
          model: input,
          modelPath: modelDir,
          downloaded: true,
          size_mb: Math.round(stats.size / (1024 * 1024)),
        };
      } catch {
        return { success: true, model: input, modelPath: modelDir, downloaded: false };
      }
    }

    if (!this._isModelDirectoryValid(input)) {
      return { success: true, modelPath: input, downloaded: false };
    }

    try {
      const modelOnnxPath = path.join(input, "model.onnx");
      const stats = fs.statSync(modelOnnxPath);
      return {
        success: true,
        modelPath: input,
        downloaded: true,
        size_mb: Math.round(stats.size / (1024 * 1024)),
      };
    } catch {
      return { success: true, modelPath: input, downloaded: false };
    }
  }

  async listParaformerModels() {
    const models = getValidParaformerModelNames();
    const modelInfo = [];

    for (const model of models) {
      const status = await this.checkModelStatus(model);
      modelInfo.push({
        ...status,
        model,
      });
    }

    return {
      models: modelInfo,
      cache_dir: this.getModelsDir(),
      success: true,
    };
  }

  async downloadParaformerModel(modelName, progressCallback = null) {
    this.validateModelName(modelName);
    const modelConfig = getParaformerModelConfig(modelName);
    const modelDir = this.getModelDir(modelName);
    const modelsDir = this.getModelsDir();

    await fsPromises.mkdir(modelsDir, { recursive: true });

    if (this.currentDownloadProcess) {
      debugLogger.warn("Paraformer model download already in progress", { model: modelName });
      return { success: false, error: "Download already in progress" };
    }

    if (this._isModelDirectoryValid(modelDir)) {
      const modelOnnxPath = path.join(modelDir, "model.onnx");
      const stats = await fsPromises.stat(modelOnnxPath);
      return {
        model: modelName,
        downloaded: true,
        path: modelDir,
        size_bytes: stats.size,
        size_mb: Math.round(stats.size / (1024 * 1024)),
        success: true,
      };
    }

    const spaceCheck = await checkDiskSpace(modelsDir, modelConfig.size * 1.2);
    if (!spaceCheck.ok) {
      throw new Error(
        `Not enough disk space to download model. Need ~${Math.round((modelConfig.size * 1.2) / 1_000_000)}MB, ` +
          `only ${Math.round(spaceCheck.availableBytes / 1_000_000)}MB available.`
      );
    }

    const { signal, abort } = createDownloadSignal();
    this.currentDownloadProcess = { abort };

    try {
      // Download and extract tar.bz2 archive
      const archivePath = path.join(modelsDir, `${modelName}.tar.bz2`);
      await downloadFile(modelConfig.url, archivePath, {
        timeout: 600000,
        signal,
        expectedSize: modelConfig.size,
        onProgress: (downloadedBytes, totalBytes) => {
          if (progressCallback) {
            progressCallback({
              type: "progress",
              model: modelName,
              downloaded_bytes: downloadedBytes,
              total_bytes: totalBytes,
              percentage: totalBytes > 0 ? Math.round((downloadedBytes / totalBytes) * 100) : 0,
            });
          }
        },
      });

      // Extract archive
      if (progressCallback) {
        progressCallback({ type: "installing", model: modelName, percentage: 95 });
      }

      const { execSync } = require("child_process");
      try {
        execSync(`tar xjf "${archivePath}" -C "${modelsDir}"`, { timeout: 120000 });
      } catch (extractError) {
        throw new Error(`Extraction failed: ${extractError.message}`);
      }

      // Rename extracted directory to match model name
      const extractedDir = path.join(modelsDir, modelConfig.extractDir);
      if (fs.existsSync(extractedDir) && extractedDir !== modelDir) {
        await fsPromises.rename(extractedDir, modelDir);
      }

      // Cleanup archive
      try {
        await fsPromises.unlink(archivePath);
      } catch {
        // Non-fatal
      }

      const modelOnnxPath = path.join(modelDir, "model.onnx");
      const stats = await fsPromises.stat(modelOnnxPath);

      if (progressCallback) {
        progressCallback({ type: "complete", model: modelName, percentage: 100 });
      }

      return {
        model: modelName,
        downloaded: true,
        path: modelDir,
        size_bytes: stats.size,
        size_mb: Math.round(stats.size / (1024 * 1024)),
        success: true,
      };
    } catch (error) {
      if (error.isAbort) {
        throw new Error("Download interrupted by user");
      }
      throw error;
    } finally {
      this.currentDownloadProcess = null;
    }
  }

  async cancelDownload() {
    if (this.currentDownloadProcess) {
      this.currentDownloadProcess.abort();
      this.currentDownloadProcess = null;
      return { success: true, message: "Download cancelled" };
    }
    return { success: false, error: "No active download to cancel" };
  }

  async deleteParaformerModel(modelName) {
    const modelDir = this.getModelDir(modelName);

    if (fs.existsSync(modelDir)) {
      let totalSize = 0;
      const files = await fsPromises.readdir(modelDir);
      for (const file of files) {
        const filePath = path.join(modelDir, file);
        try {
          const stats = await fsPromises.stat(filePath);
          if (stats.isFile()) totalSize += stats.size;
        } catch {
          // Continue
        }
      }

      await fsPromises.rm(modelDir, { recursive: true, force: true });
      return {
        model: modelName,
        deleted: true,
        freed_bytes: totalSize,
        freed_mb: Math.round(totalSize / (1024 * 1024)),
        success: true,
      };
    }

    return { model: modelName, deleted: false, error: "Model not found", success: false };
  }

  async deleteAllParaformerModels() {
    const modelsDir = this.getModelsDir();
    let totalFreed = 0;
    let deletedCount = 0;

    try {
      if (!fs.existsSync(modelsDir)) {
        return { success: true, deleted_count: 0, freed_bytes: 0, freed_mb: 0 };
      }

      const entries = await fsPromises.readdir(modelsDir);
      for (const entry of entries) {
        const entryPath = path.join(modelsDir, entry);
        try {
          const stats = await fsPromises.stat(entryPath);
          if (stats.isDirectory()) {
            const innerFiles = await fsPromises.readdir(entryPath);
            for (const f of innerFiles) {
              const fp = path.join(entryPath, f);
              const s = await fsPromises.stat(fp);
              if (s.isFile()) totalFreed += s.size;
            }
            await fsPromises.rm(entryPath, { recursive: true, force: true });
            deletedCount++;
          }
        } catch {
          // Continue
        }
      }

      return {
        success: true,
        deleted_count: deletedCount,
        freed_bytes: totalFreed,
        freed_mb: Math.round(totalFreed / (1024 * 1024)),
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async transcribeLocalParaformer(audioBlob, options = {}) {
    const modelPath = this._resolveModelPath(options.modelPath);

    try {
      const audioBuffer = toAudioBuffer(audioBlob);
      if (!audioBuffer || audioBuffer.length === 0) {
        throw new Error("Audio buffer is empty - no audio data received");
      }

      // Use persistent WS server for fast transcription (model stays in memory)
      const server = this._getServer();
      if (server.isAvailable()) {
        const result = await server.transcribe(audioBuffer, { modelPath });
        if (result.text) {
          return { success: true, text: result.text };
        }
        return { success: false, message: "No audio detected" };
      }

      throw new Error("Paraformer WS server binary not found");
    } catch (error) {
      // Fallback: CLI spawn
      debugLogger.warn("Paraformer server transcription failed, falling back to CLI", {
        error: error.message,
      });

      return this._transcribeWithCli(audioBlob, options);
    }
  }

  async _transcribeWithCli(audioBlob, options = {}) {
    const modelPath = this._resolveModelPath(options.modelPath);
    const binaryPath = this._resolveBinaryPath(options.binaryPath);
    const threads = Number.isFinite(Number(options.threads))
      ? Math.max(1, Math.floor(Number(options.threads)))
      : null;
    const timeoutMs = Number.isFinite(Number(options.timeoutMs))
      ? Math.max(1000, Math.floor(Number(options.timeoutMs)))
      : DEFAULT_TIMEOUT_MS;

    const tempDir = getSafeTempDir();
    const timestamp = Date.now();
    const inputPath = path.join(tempDir, `paraformer-input-${timestamp}.webm`);
    const wavPath = path.join(tempDir, `paraformer-input-${timestamp}.wav`);

    const cleanup = () => {
      for (const filePath of [inputPath, wavPath]) {
        try {
          if (fileExists(filePath)) {
            fs.unlinkSync(filePath);
          }
        } catch (err) {
          debugLogger.warn("Failed to cleanup Paraformer temp file", {
            path: filePath,
            error: err.message,
          });
        }
      }
    };

    try {
      const audioBuffer = toAudioBuffer(audioBlob);
      if (!audioBuffer || audioBuffer.length === 0) {
        throw new Error("Audio buffer is empty - no audio data received");
      }

      fs.writeFileSync(inputPath, audioBuffer);
      await convertToWav(inputPath, wavPath, { sampleRate: 16000, channels: 1 });

      const modelOnnxPath = path.join(modelPath, "model.onnx");
      const tokensPath = path.join(modelPath, "tokens.txt");

      const args = [
        `--paraformer=${modelOnnxPath}`,
        `--tokens=${tokensPath}`,
        `--num-threads=${String(threads || 4)}`,
        "--decoding-method=greedy_search",
      ];
      args.push(wavPath);

      debugLogger.debug("Starting Paraformer CLI (fallback)", {
        binaryPath,
        args,
        modelPath,
      });

      const spawnEnv = { ...process.env };
      const pathSeparator = process.platform === "win32" ? ";" : ":";
      const binaryDir = path.dirname(binaryPath);
      const candidateLibDir = path.resolve(binaryDir, "..", "lib");
      if (fileExists(candidateLibDir)) {
        if (process.platform === "darwin") {
          const current = spawnEnv.DYLD_LIBRARY_PATH || "";
          spawnEnv.DYLD_LIBRARY_PATH = current
            ? `${candidateLibDir}${pathSeparator}${current}`
            : candidateLibDir;
        } else if (process.platform === "linux") {
          const current = spawnEnv.LD_LIBRARY_PATH || "";
          spawnEnv.LD_LIBRARY_PATH = current
            ? `${candidateLibDir}${pathSeparator}${current}`
            : candidateLibDir;
        } else if (process.platform === "win32") {
          const current = spawnEnv.PATH || "";
          spawnEnv.PATH = `${candidateLibDir}${pathSeparator}${current}`;
        }
      }

      const { stdout, stderr, code } = await new Promise((resolve, reject) => {
        const proc = spawn(binaryPath, args, {
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
          env: spawnEnv,
          cwd: path.dirname(binaryPath),
        });

        let stdout = "";
        let stderr = "";
        let settled = false;

        const timeout = setTimeout(() => {
          if (settled) return;
          settled = true;
          killProcess(proc, "SIGTERM");
          setTimeout(() => killProcess(proc, "SIGKILL"), 3000);
          reject(new Error(`Paraformer timed out after ${timeoutMs}ms`));
        }, timeoutMs);

        proc.stdout.on("data", (chunk) => {
          stdout += chunk.toString();
        });

        proc.stderr.on("data", (chunk) => {
          stderr += chunk.toString();
        });

        proc.on("error", (error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          reject(new Error(`Failed to run paraformer-main: ${error.message}`));
        });

        proc.on("close", (code) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          resolve({ stdout, stderr, code });
        });
      });

      const mergedOutput = `${stdout || ""}\n${stderr || ""}`.trim();
      if (code !== 0) {
        throw new Error(
          `Paraformer process failed (code ${code}): ${sanitizeErrorSnippet(stderr || stdout)}`
        );
      }

      const text = this._extractText(mergedOutput);

      const fatalHints = /(dyld|no such file|library not loaded|segmentation fault|abort trap)/i;
      if (!text && fatalHints.test(mergedOutput)) {
        throw new Error(`Paraformer failed: ${sanitizeErrorSnippet(mergedOutput)}`);
      }

      if (!text) {
        return { success: false, message: "No audio detected" };
      }

      return { success: true, text };
    } finally {
      cleanup();
    }
  }
}

module.exports = ParaformerManager;
