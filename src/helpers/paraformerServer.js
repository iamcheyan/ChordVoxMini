const fs = require("fs");
const path = require("path");
const debugLogger = require("./debugLogger");
const { getSafeTempDir } = require("./safeTempDir");
const {
  getFFmpegPath,
  isWavFormat,
  convertToWav,
  wavToFloat32Samples,
  computeFloat32RMS,
} = require("./ffmpegUtils");
const ParaformerWsServer = require("./paraformerWsServer");

const SAMPLE_RATE = 16000;
const BYTES_PER_SAMPLE = 4;
const MAX_SEGMENT_SECONDS = 30;
const MAX_SEGMENT_BYTES = MAX_SEGMENT_SECONDS * SAMPLE_RATE * BYTES_PER_SAMPLE;
const SILENCE_RMS_THRESHOLD = 0.001;

class ParaformerServerManager {
  constructor() {
    this.wsServer = new ParaformerWsServer();
  }

  isAvailable() {
    return this.wsServer.isAvailable();
  }

  isModelDirectoryValid(modelDir) {
    if (!modelDir || !fs.existsSync(modelDir)) return false;
    return (
      fs.existsSync(path.join(modelDir, "model.onnx")) &&
      fs.existsSync(path.join(modelDir, "tokens.txt"))
    );
  }

  async _ensureWav(audioBuffer) {
    const isWav = isWavFormat(audioBuffer);
    if (isWav) return { wavBuffer: audioBuffer, filesToCleanup: [] };

    const ffmpegPath = getFFmpegPath();
    if (!ffmpegPath) {
      throw new Error(
        "FFmpeg not found - required for audio conversion."
      );
    }

    const tempDir = getSafeTempDir();
    const timestamp = Date.now();
    const tempInputPath = path.join(tempDir, `paraformer-input-${timestamp}.webm`);
    const tempWavPath = path.join(tempDir, `paraformer-${timestamp}.wav`);

    fs.writeFileSync(tempInputPath, audioBuffer);

    const inputStats = fs.statSync(tempInputPath);
    debugLogger.debug("Converting audio to WAV", { inputSize: inputStats.size });

    await convertToWav(tempInputPath, tempWavPath, { sampleRate: 16000, channels: 1 });

    const outputStats = fs.statSync(tempWavPath);
    debugLogger.debug("FFmpeg conversion complete", { outputSize: outputStats.size });

    const wavBuffer = fs.readFileSync(tempWavPath);
    return { wavBuffer, filesToCleanup: [tempInputPath, tempWavPath] };
  }

  async transcribe(audioBuffer, options = {}) {
    const { modelPath = "" } = options;
    const resolvedModelDir = path.resolve(modelPath);

    if (!this.isModelDirectoryValid(resolvedModelDir)) {
      throw new Error(`Paraformer model directory not found or invalid: ${resolvedModelDir}`);
    }

    debugLogger.debug("Paraformer server transcription request", {
      modelPath,
      audioSize: audioBuffer?.length || 0,
    });

    const { wavBuffer, filesToCleanup } = await this._ensureWav(audioBuffer);
    try {
      if (!this.wsServer.ready || this.wsServer.modelDir !== resolvedModelDir) {
        await this.wsServer.start(resolvedModelDir);
      }

      const samples = wavToFloat32Samples(wavBuffer);
      const durationSeconds = samples.length / BYTES_PER_SAMPLE / SAMPLE_RATE;

      const rms = computeFloat32RMS(samples);
      debugLogger.debug("Paraformer audio analysis", { durationSeconds, rms });
      if (rms < SILENCE_RMS_THRESHOLD) {
        return { text: "", elapsed: 0 };
      }

      if (samples.length <= MAX_SEGMENT_BYTES) {
        const result = await this.wsServer.transcribe(samples, SAMPLE_RATE);
        return result;
      }

      debugLogger.debug("Paraformer segmenting long audio", {
        durationSeconds,
        segmentCount: Math.ceil(samples.length / MAX_SEGMENT_BYTES),
      });

      const texts = [];
      let totalElapsed = 0;

      for (let offset = 0; offset < samples.length; offset += MAX_SEGMENT_BYTES) {
        const end = Math.min(offset + MAX_SEGMENT_BYTES, samples.length);
        const segment = samples.subarray(offset, end);
        const result = await this.wsServer.transcribe(segment, SAMPLE_RATE);
        totalElapsed += result.elapsed || 0;
        if (result.text) texts.push(result.text);
      }

      return { text: texts.join(" "), elapsed: totalElapsed };
    } finally {
      this._cleanupFiles(filesToCleanup);
    }
  }

  _cleanupFiles(filePaths) {
    for (const filePath of filePaths) {
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      } catch (err) {
        debugLogger.warn("Failed to cleanup temp audio file", {
          path: filePath,
          error: err.message,
        });
      }
    }
  }

  async startServer(modelDir) {
    if (!this.wsServer.isAvailable()) {
      return { success: false, reason: "paraformer WS server binary not found" };
    }

    if (!this.isModelDirectoryValid(modelDir)) {
      return { success: false, reason: `Model directory invalid: ${modelDir}` };
    }

    try {
      await this.wsServer.start(modelDir);
      return { success: true, port: this.wsServer.port };
    } catch (error) {
      debugLogger.error("Failed to start paraformer WS server", { error: error.message });
      return { success: false, reason: error.message };
    }
  }

  async stopServer() {
    await this.wsServer.stop();
  }

  getServerStatus() {
    return this.wsServer.getStatus();
  }
}

module.exports = ParaformerServerManager;
