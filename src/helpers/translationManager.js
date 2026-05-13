const fs = require("fs");
const fsPromises = require("fs").promises;
const path = require("path");
const debugLogger = require("./debugLogger");
const { downloadFile, createDownloadSignal, checkDiskSpace } = require("./downloadUtils");
const { getModelsDirForService } = require("./modelDirUtils");

const modelRegistryData = require("../models/modelRegistryData.json");

function getTranslationModelConfig(modelName) {
  return modelRegistryData.translationModels?.[modelName] || null;
}

function getValidModelNames() {
  return Object.keys(modelRegistryData.translationModels || {});
}

class TranslationManager {
  constructor() {
    this.currentDownloadProcess = null;
  }

  getModelsDir() {
    return getModelsDirForService("translation");
  }

  validateModelName(modelName) {
    if (!getValidModelNames().includes(modelName)) {
      throw new Error(`Invalid translation model: ${modelName}. Valid: ${getValidModelNames().join(", ")}`);
    }
  }

  getModelPath(modelName) {
    this.validateModelName(modelName);
    return path.join(this.getModelsDir(), modelName);
  }

  isModelDownloaded(modelName) {
    try {
      this.validateModelName(modelName);
    } catch (e) {
      debugLogger.error(`Validation failed for ${modelName}: ${e.message}`);
      return false;
    }
    const modelDir = this.getModelPath(modelName);
    if (!fs.existsSync(modelDir)) {
      debugLogger.warn(`Model directory does not exist: ${modelDir}`);
      return false;
    }

    const config = getTranslationModelConfig(modelName);
    if (!config) {
      debugLogger.error(`No config found for ${modelName}`);
      return false;
    }

    const requiredFiles = [
      config.files.encoder,
      config.files.decoder,
      config.files.tokenizer,
      config.files.config,
    ];

    for (const f of requiredFiles) {
      const p = path.join(modelDir, f);
      if (!fs.existsSync(p)) {
        debugLogger.warn(`Required file missing: ${p}`);
        return false;
      }
    }

    return true;
  }

  getDownloadedModels() {
    return getValidModelNames().filter((name) => this.isModelDownloaded(name));
  }

  getModelsByDirection(sourceLang, targetLang) {
    return getValidModelNames().filter((name) => {
      const config = getTranslationModelConfig(name);
      if (!config) return false;
      if (config.isMultilingual && config.supportedPairs) {
        return config.supportedPairs.some(
          (pair) => pair[0] === sourceLang && pair[1] === targetLang
        );
      }
      return config.sourceLang === sourceLang && config.targetLang === targetLang;
    });
  }

  async downloadModel(modelName, progressCallback = null) {
    this.validateModelName(modelName);
    const config = getTranslationModelConfig(modelName);
    if (!config) throw new Error(`No config found for model: ${modelName}`);

    const modelDir = this.getModelPath(modelName);
    const modelsDir = this.getModelsDir();

    await fsPromises.mkdir(modelDir, { recursive: true });

    if (this.isModelDownloaded(modelName)) {
      if (progressCallback) {
        progressCallback({ type: "complete", model: modelName, percentage: 100 });
      }
      return { model: modelName, downloaded: true, path: modelDir, success: true };
    }

    const totalSizeBytes = config.sizeMb * 1_000_000;
    const spaceCheck = await checkDiskSpace(modelsDir, totalSizeBytes * 3);
    if (!spaceCheck.ok) {
      throw new Error(
        `Not enough disk space. Need ~${Math.round((totalSizeBytes * 3) / 1_000_000)}MB, ` +
          `only ${Math.round(spaceCheck.availableBytes / 1_000_000)}MB available.`
      );
    }

    const { signal, abort } = createDownloadSignal();
    this.currentDownloadProcess = { abort };

    const mirrorUrl = process.env.HF_MIRROR_URL || "https://huggingface.co";
    const baseUrl = `${mirrorUrl}/${config.repoId}/resolve/main`;
    const filesToDownload = Object.entries(config.files);

    try {
      let completedFiles = 0;
      for (const [key, filePath] of filesToDownload) {
        const fileUrl = `${baseUrl}/${filePath}`;
        const destPath = path.join(modelDir, filePath);
        const destDir = path.dirname(destPath);

        await fsPromises.mkdir(destDir, { recursive: true });

        if (fs.existsSync(destPath)) {
          completedFiles++;
          continue;
        }

        debugLogger.info(`Downloading translation model file: ${filePath}`, { modelName });

        await downloadFile(fileUrl, destPath, {
          timeout: 600000,
          signal,
          onProgress: (downloadedBytes, totalBytes) => {
            if (progressCallback) {
              const fileProgress = totalBytes > 0 ? (downloadedBytes / totalBytes) * 100 : 0;
              const overallProgress = Math.round(
                ((completedFiles + fileProgress / 100) / filesToDownload.length) * 100
              );
              progressCallback({
                type: "progress",
                model: modelName,
                file: filePath,
                downloaded_bytes: downloadedBytes,
                total_bytes: totalBytes,
                percentage: overallProgress,
              });
            }
          },
        });

        completedFiles++;
      }

      if (progressCallback) {
        progressCallback({ type: "complete", model: modelName, percentage: 100 });
      }

      return { model: modelName, downloaded: true, path: modelDir, success: true };
    } catch (error) {
      if (error.isAbort) {
        debugLogger.info("Translation model download cancelled", { modelName });
        return { model: modelName, downloaded: false, success: false, cancelled: true };
      }
      throw error;
    } finally {
      this.currentDownloadProcess = null;
    }
  }

  async deleteModel(modelName) {
    this.validateModelName(modelName);
    const modelDir = this.getModelPath(modelName);

    if (!fs.existsSync(modelDir)) {
      return { success: true, message: "Model already deleted" };
    }

    await fsPromises.rm(modelDir, { recursive: true, force: true });
    debugLogger.info(`Deleted translation model: ${modelName}`);
    return { success: true, message: `Deleted ${modelName}` };
  }

  cancelDownload() {
    if (this.currentDownloadProcess) {
      this.currentDownloadProcess.abort();
      this.currentDownloadProcess = null;
    }
  }
}

module.exports = TranslationManager;
