const { ipcMain, app, shell, BrowserWindow, dialog } = require("electron");
const path = require("path");
const http = require("http");
const https = require("https");
const crypto = require("crypto");
const fsPromises = require("fs/promises");
const AppUtils = require("../utils");
const debugLogger = require("./debugLogger");
const GnomeShortcutManager = require("./gnomeShortcut");
const AssemblyAiStreaming = require("./assemblyAiStreaming");
const { i18nMain, changeLanguage } = require("./i18nMain");
const DeepgramStreaming = require("./deepgramStreaming");

const MISTRAL_TRANSCRIPTION_URL = "https://api.mistral.ai/v1/audio/transcriptions";

class IPCHandlers {
  constructor(managers) {
    this.environmentManager = managers.environmentManager;
    this.databaseManager = managers.databaseManager;
    this.clipboardManager = managers.clipboardManager;
    this.whisperManager = managers.whisperManager;
    this.parakeetManager = managers.parakeetManager;
    this.senseVoiceManager = managers.senseVoiceManager;
    this.paraformerManager = managers.paraformerManager;
    this.windowManager = managers.windowManager;
    this.windowsKeyManager = managers.windowsKeyManager;
    this.getTrayManager = managers.getTrayManager;
    this.sessionId = crypto.randomUUID();
    this.assemblyAiStreaming = null;
    this.deepgramStreaming = null;
    this.secondaryHotkeyBeforeCapture = "";
    this.setupHandlers();
  }

  async checkLicenseGate() {
    return { allowed: true, status: null };
  }

  _syncStartupEnv(setVars, clearVars = []) {
    let changed = false;
    for (const [key, value] of Object.entries(setVars)) {
      if (process.env[key] !== value) {
        process.env[key] = value;
        changed = true;
      }
    }
    for (const key of clearVars) {
      if (process.env[key]) {
        delete process.env[key];
        changed = true;
      }
    }
    if (changed) {
      debugLogger.debug("Synced startup env vars", {
        set: Object.keys(setVars),
        cleared: clearVars.filter((k) => !process.env[k]),
      });
      this.environmentManager.saveAllKeysToEnvFile().catch(() => { });
    }
  }

  setupHandlers() {
    // Window control handlers
    ipcMain.handle("window-minimize", () => {
      if (this.windowManager.controlPanelWindow) {
        this.windowManager.controlPanelWindow.minimize();
      }
    });

    ipcMain.handle("window-maximize", () => {
      if (this.windowManager.controlPanelWindow) {
        if (this.windowManager.controlPanelWindow.isMaximized()) {
          this.windowManager.controlPanelWindow.unmaximize();
        } else {
          this.windowManager.controlPanelWindow.maximize();
        }
      }
    });

    ipcMain.handle("window-close", () => {
      if (this.windowManager.controlPanelWindow) {
        this.windowManager.controlPanelWindow.close();
      }
    });

    ipcMain.handle("window-is-maximized", () => {
      if (this.windowManager.controlPanelWindow) {
        return this.windowManager.controlPanelWindow.isMaximized();
      }
      return false;
    });

    ipcMain.handle("app-quit", () => {
      app.quit();
    });

    ipcMain.handle("hide-window", () => {
      this.windowManager.hideDictationPanel();

      if (process.platform === "darwin" && app.dock) {
        const controlPanelWindow = this.windowManager?.controlPanelWindow;
        const isControlPanelVisible =
          controlPanelWindow &&
          !controlPanelWindow.isDestroyed() &&
          controlPanelWindow.isVisible();

        // Keep Dock hidden for background dictation-only mode.
        if (!isControlPanelVisible) {
          app.dock.hide();
        }
      }
    });

    ipcMain.handle("show-dictation-panel", () => {
      this.windowManager.showDictationPanel();
    });

    ipcMain.handle("force-stop-dictation", () => {
      if (this.windowManager?.forceStopMacCompoundPush) {
        this.windowManager.forceStopMacCompoundPush("manual");
      }
      return { success: true };
    });

    ipcMain.handle("set-main-window-interactivity", (event, shouldCapture) => {
      this.windowManager.setMainWindowInteractivity(Boolean(shouldCapture));
      return { success: true };
    });

    ipcMain.handle("resize-main-window", (event, sizeKey) => {
      return this.windowManager.resizeMainWindow(sizeKey);
    });

    // Environment handlers
    ipcMain.handle("get-openai-key", async (event) => {
      return this.environmentManager.getOpenAIKey();
    });

    ipcMain.handle("save-openai-key", async (event, key) => {
      return this.environmentManager.saveOpenAIKey(key);
    });

    ipcMain.handle("create-production-env-file", async (event, apiKey) => {
      return this.environmentManager.createProductionEnvFile(apiKey);
    });

    ipcMain.handle("db-save-transcription", async (event, text) => {
      const result = this.databaseManager.saveTranscription(text);
      if (result?.success && result?.transcription) {
        setImmediate(() => {
          this.broadcastToWindows("transcription-added", result.transcription);
        });
      }
      return result;
    });

    ipcMain.handle("db-get-transcriptions", async (event, limit = 50) => {
      return this.databaseManager.getTranscriptions(limit);
    });

    ipcMain.handle("db-clear-transcriptions", async (event) => {
      const result = this.databaseManager.clearTranscriptions();
      if (result?.success) {
        setImmediate(() => {
          this.broadcastToWindows("transcriptions-cleared", {
            cleared: result.cleared,
          });
        });
      }
      return result;
    });

    ipcMain.handle("db-delete-transcription", async (event, id) => {
      const result = this.databaseManager.deleteTranscription(id);
      if (result?.success) {
        setImmediate(() => {
          this.broadcastToWindows("transcription-deleted", { id });
        });
      }
      return result;
    });

    // Dictionary handlers
    ipcMain.handle("db-get-dictionary", async () => {
      return this.databaseManager.getDictionary();
    });

    ipcMain.handle("db-set-dictionary", async (event, words) => {
      if (!Array.isArray(words)) {
        throw new Error("words must be an array");
      }
      return this.databaseManager.setDictionary(words);
    });

    // Clipboard handlers
    ipcMain.handle("paste-text", async (event, text, options) => {
      // If the floating dictation panel currently has focus, hide it first so the
      // paste keystroke lands in the user's target app instead of the overlay.
      const mainWindow = this.windowManager?.mainWindow;
      if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isFocused()) {
        mainWindow.hide();
        await new Promise((resolve) => setTimeout(resolve, 140));
      }
      return this.clipboardManager.pasteText(text, { ...options, webContents: event.sender });
    });

    ipcMain.handle("read-clipboard", async (event) => {
      return this.clipboardManager.readClipboard();
    });

    ipcMain.handle("write-clipboard", async (event, text) => {
      return this.clipboardManager.writeClipboard(text, event.sender);
    });

    ipcMain.handle("check-paste-tools", async () => {
      return this.clipboardManager.checkPasteTools();
    });

    // Whisper handlers
    ipcMain.handle("transcribe-local-whisper", async (event, audioBlob, options = {}) => {
      const licenseGate = await this.checkLicenseGate();
      if (!licenseGate.allowed) {
        return this.buildLicenseDeniedResponse(licenseGate.status);
      }

      debugLogger.log("transcribe-local-whisper called", {
        audioBlobType: typeof audioBlob,
        audioBlobSize: audioBlob?.byteLength || audioBlob?.length || 0,
        options,
      });

      try {
        const result = await this.whisperManager.transcribeLocalWhisper(audioBlob, options);

        debugLogger.log("Whisper result", {
          success: result.success,
          hasText: !!result.text,
          message: result.message,
          error: result.error,
        });

        // Check if no audio was detected and send appropriate event
        if (!result.success && result.message === "No audio detected") {
          debugLogger.log("Sending no-audio-detected event to renderer");
          event.sender.send("no-audio-detected");
        }

        return result;
      } catch (error) {
        debugLogger.error("Local Whisper transcription error", error);
        const errorMessage = error.message || "Unknown error";

        // Return specific error types for better user feedback
        if (errorMessage.includes("FFmpeg not found")) {
          return {
            success: false,
            error: "ffmpeg_not_found",
            message: "FFmpeg is missing. Please reinstall the app or install FFmpeg manually.",
          };
        }
        if (
          errorMessage.includes("FFmpeg conversion failed") ||
          errorMessage.includes("FFmpeg process error")
        ) {
          return {
            success: false,
            error: "ffmpeg_error",
            message: "Audio conversion failed. The recording may be corrupted.",
          };
        }
        if (
          errorMessage.includes("whisper.cpp not found") ||
          errorMessage.includes("whisper-cpp")
        ) {
          return {
            success: false,
            error: "whisper_not_found",
            message: "Whisper binary is missing. Please reinstall the app.",
          };
        }
        if (
          errorMessage.includes("Audio buffer is empty") ||
          errorMessage.includes("Audio data too small")
        ) {
          return {
            success: false,
            error: "no_audio_data",
            message: "No audio detected",
          };
        }
        if (
          (errorMessage.includes("model") && errorMessage.includes("not downloaded")) ||
          errorMessage.includes("model directory not found or invalid")
        ) {
          return {
            success: false,
            error: "model_not_found",
            message: errorMessage,
          };
        }

        throw error;
      }
    });

    ipcMain.handle("check-whisper-installation", async (event) => {
      return this.whisperManager.checkWhisperInstallation();
    });

    ipcMain.handle("get-audio-diagnostics", async () => {
      return this.whisperManager.getDiagnostics();
    });

    ipcMain.handle("download-whisper-model", async (event, modelName) => {
      try {
        const result = await this.whisperManager.downloadWhisperModel(modelName, (progressData) => {
          if (!event.sender.isDestroyed()) {
            event.sender.send("whisper-download-progress", progressData);
          }
        });
        return result;
      } catch (error) {
        if (!event.sender.isDestroyed()) {
          event.sender.send("whisper-download-progress", {
            type: "error",
            model: modelName,
            error: error.message,
            code: error.code || "DOWNLOAD_FAILED",
          });
        }
        return {
          success: false,
          error: error.message,
          code: error.code || "DOWNLOAD_FAILED",
        };
      }
    });

    ipcMain.handle("check-model-status", async (event, modelName) => {
      return this.whisperManager.checkModelStatus(modelName);
    });

    ipcMain.handle("list-whisper-models", async (event) => {
      return this.whisperManager.listWhisperModels();
    });

    ipcMain.handle("delete-whisper-model", async (event, modelName) => {
      return this.whisperManager.deleteWhisperModel(modelName);
    });

    ipcMain.handle("delete-all-whisper-models", async () => {
      return this.whisperManager.deleteAllWhisperModels();
    });

    ipcMain.handle("cancel-whisper-download", async (event) => {
      return this.whisperManager.cancelDownload();
    });

    // Whisper server handlers (for faster repeated transcriptions)
    ipcMain.handle("whisper-server-start", async (event, modelName) => {
      return this.whisperManager.startServer(modelName);
    });

    ipcMain.handle("whisper-server-stop", async () => {
      return this.whisperManager.stopServer();
    });

    ipcMain.handle("whisper-server-status", async () => {
      return this.whisperManager.getServerStatus();
    });

    ipcMain.handle("check-ffmpeg-availability", async (event) => {
      return this.whisperManager.checkFFmpegAvailability();
    });

    // Parakeet (NVIDIA) handlers
    ipcMain.handle("transcribe-local-parakeet", async (event, audioBlob, options = {}) => {
      const licenseGate = await this.checkLicenseGate();
      if (!licenseGate.allowed) {
        return this.buildLicenseDeniedResponse(licenseGate.status);
      }

      debugLogger.log("transcribe-local-parakeet called", {
        audioBlobType: typeof audioBlob,
        audioBlobSize: audioBlob?.byteLength || audioBlob?.length || 0,
        options,
      });

      try {
        const result = await this.parakeetManager.transcribeLocalParakeet(audioBlob, options);

        debugLogger.log("Parakeet result", {
          success: result.success,
          hasText: !!result.text,
          message: result.message,
          error: result.error,
        });

        if (!result.success && result.message === "No audio detected") {
          debugLogger.log("Sending no-audio-detected event to renderer");
          event.sender.send("no-audio-detected");
        }

        return result;
      } catch (error) {
        debugLogger.error("Local Parakeet transcription error", error);
        const errorMessage = error.message || "Unknown error";

        if (errorMessage.includes("sherpa-onnx") && errorMessage.includes("not found")) {
          return {
            success: false,
            error: "parakeet_not_found",
            message: "Parakeet binary is missing. Please reinstall the app.",
          };
        }
        if (errorMessage.includes("model") && errorMessage.includes("not downloaded")) {
          return {
            success: false,
            error: "model_not_found",
            message: errorMessage,
          };
        }

        throw error;
      }
    });

    ipcMain.handle("check-parakeet-installation", async () => {
      return this.parakeetManager.checkInstallation();
    });

    ipcMain.handle("download-parakeet-model", async (event, modelName) => {
      try {
        const result = await this.parakeetManager.downloadParakeetModel(
          modelName,
          (progressData) => {
            if (!event.sender.isDestroyed()) {
              event.sender.send("parakeet-download-progress", progressData);
            }
          }
        );
        return result;
      } catch (error) {
        if (!event.sender.isDestroyed()) {
          event.sender.send("parakeet-download-progress", {
            type: "error",
            model: modelName,
            error: error.message,
            code: error.code || "DOWNLOAD_FAILED",
          });
        }
        return {
          success: false,
          error: error.message,
          code: error.code || "DOWNLOAD_FAILED",
        };
      }
    });

    ipcMain.handle("check-parakeet-model-status", async (_event, modelName) => {
      return this.parakeetManager.checkModelStatus(modelName);
    });

    ipcMain.handle("list-parakeet-models", async () => {
      return this.parakeetManager.listParakeetModels();
    });

    ipcMain.handle("delete-parakeet-model", async (_event, modelName) => {
      return this.parakeetManager.deleteParakeetModel(modelName);
    });

    ipcMain.handle("delete-all-parakeet-models", async () => {
      return this.parakeetManager.deleteAllParakeetModels();
    });

    ipcMain.handle("cancel-parakeet-download", async () => {
      return this.parakeetManager.cancelDownload();
    });

    ipcMain.handle("get-parakeet-diagnostics", async () => {
      return this.parakeetManager.getDiagnostics();
    });

    // Parakeet server handlers (for faster repeated transcriptions)
    ipcMain.handle("parakeet-server-start", async (event, modelName) => {
      const result = await this.parakeetManager.startServer(modelName);
      process.env.LOCAL_TRANSCRIPTION_PROVIDER = "nvidia";
      process.env.PARAKEET_MODEL = modelName;
      await this.environmentManager.saveAllKeysToEnvFile();
      return result;
    });

    ipcMain.handle("parakeet-server-stop", async () => {
      const result = await this.parakeetManager.stopServer();
      delete process.env.LOCAL_TRANSCRIPTION_PROVIDER;
      delete process.env.PARAKEET_MODEL;
      await this.environmentManager.saveAllKeysToEnvFile();
      return result;
    });

    ipcMain.handle("parakeet-server-status", async () => {
      return this.parakeetManager.getServerStatus();
    });

    // SenseVoice handlers (external local model via sense-voice-main)
    ipcMain.handle("transcribe-local-sensevoice", async (event, audioBlob, options = {}) => {
      const licenseGate = await this.checkLicenseGate();
      if (!licenseGate.allowed) {
        return this.buildLicenseDeniedResponse(licenseGate.status);
      }

      debugLogger.log("transcribe-local-sensevoice called", {
        audioBlobType: typeof audioBlob,
        audioBlobSize: audioBlob?.byteLength || audioBlob?.length || 0,
        options,
      });

      try {
        const result = await this.senseVoiceManager.transcribeLocalSenseVoice(audioBlob, options);

        debugLogger.log("SenseVoice result", {
          success: result.success,
          hasText: !!result.text,
          message: result.message,
          error: result.error,
        });

        if (!result.success && result.message === "No audio detected") {
          debugLogger.log("Sending no-audio-detected event to renderer");
          event.sender.send("no-audio-detected");
        }

        return result;
      } catch (error) {
        debugLogger.error("Local SenseVoice transcription error", error);
        const errorMessage = error.message || "Unknown error";

        if (errorMessage.includes("model path is empty")) {
          return {
            success: false,
            error: "sensevoice_model_not_set",
            message: "SenseVoice model path is empty. Please select a local GGUF model.",
          };
        }
        if (errorMessage.includes("model file not found")) {
          return {
            success: false,
            error: "sensevoice_model_not_found",
            message: errorMessage,
          };
        }
        if (errorMessage.includes("binary not found")) {
          return {
            success: false,
            error: "sensevoice_binary_not_found",
            message: "SenseVoice binary not found. Please select sense-voice-main path.",
          };
        }
        if (errorMessage.includes("timed out")) {
          return {
            success: false,
            error: "sensevoice_timeout",
            message: errorMessage,
          };
        }
        if (errorMessage.includes("Audio buffer is empty")) {
          return {
            success: false,
            error: "no_audio_data",
            message: "No audio detected",
          };
        }

        throw error;
      }
    });

    ipcMain.handle("check-sensevoice-installation", async (_event, binaryPath = "") => {
      return this.senseVoiceManager.checkInstallation(binaryPath);
    });

    ipcMain.handle("download-sensevoice-model", async (event, modelName) => {
      try {
        const result = await this.senseVoiceManager.downloadSenseVoiceModel(
          modelName,
          (progressData) => {
            if (!event.sender.isDestroyed()) {
              event.sender.send("sensevoice-download-progress", progressData);
            }
          }
        );
        return result;
      } catch (error) {
        if (!event.sender.isDestroyed()) {
          event.sender.send("sensevoice-download-progress", {
            type: "error",
            model: modelName,
            error: error.message,
            code: error.code || "DOWNLOAD_FAILED",
          });
        }
        return {
          success: false,
          error: error.message,
          code: error.code || "DOWNLOAD_FAILED",
        };
      }
    });

    ipcMain.handle("check-sensevoice-model-status", async (_event, modelPath = "") => {
      return this.senseVoiceManager.checkModelStatus(modelPath);
    });

    ipcMain.handle("list-sensevoice-models", async () => {
      return this.senseVoiceManager.listSenseVoiceModels();
    });

    ipcMain.handle("delete-sensevoice-model", async (_event, modelName) => {
      return this.senseVoiceManager.deleteSenseVoiceModel(modelName);
    });

    ipcMain.handle("delete-all-sensevoice-models", async () => {
      return this.senseVoiceManager.deleteAllSenseVoiceModels();
    });

    ipcMain.handle("cancel-sensevoice-download", async () => {
      return this.senseVoiceManager.cancelDownload();
    });

    // Paraformer handlers (external local model via paraformer-main)
    ipcMain.handle("transcribe-local-paraformer", async (event, audioBlob, options = {}) => {
      debugLogger.log("transcribe-local-paraformer called", {
        audioBlobType: typeof audioBlob,
        audioBlobLength: audioBlob?.length || audioBlob?.byteLength || 0,
        options: { ...options, binaryPath: options.binaryPath ? "[set]" : "[not set]" },
      });

      try {
        const result = await this.paraformerManager.transcribeLocalParaformer(audioBlob, options);
        debugLogger.log("Paraformer result", {
          success: result.success,
          textLength: result.text?.length || 0,
          hasText: !!result.text,
        });
        return result;
      } catch (error) {
        debugLogger.error("Local Paraformer transcription error", error);

        if (error.message.includes("model path is empty")) {
          return {
            success: false,
            error: "paraformer_model_not_set",
            message: "Paraformer model path is empty. Please select a model directory.",
          };
        }
        if (error.message.includes("model") && error.message.includes("not found")) {
          return {
            success: false,
            error: "paraformer_model_not_found",
            message: error.message,
          };
        }
        if (error.message.includes("binary not found")) {
          return {
            success: false,
            error: "paraformer_binary_not_found",
            message: "Paraformer binary not found. Please select paraformer-main path.",
          };
        }
        if (error.message.includes("timed out")) {
          return {
            success: false,
            error: "paraformer_timeout",
            message: error.message,
          };
        }

        throw error;
      }
    });

    ipcMain.handle("check-paraformer-installation", async (_event, binaryPath = "") => {
      return this.paraformerManager.checkInstallation(binaryPath);
    });

    ipcMain.handle("download-paraformer-model", async (event, modelName) => {
      try {
        const result = await this.paraformerManager.downloadParaformerModel(
          modelName,
          (progressData) => {
            event.sender.send("paraformer-download-progress", progressData);
          }
        );
        return result;
      } catch (error) {
        event.sender.send("paraformer-download-progress", {
          type: "error",
          model: modelName,
          error: error.message,
        });
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("check-paraformer-model-status", async (_event, modelPath = "") => {
      return this.paraformerManager.checkModelStatus(modelPath);
    });

    ipcMain.handle("list-paraformer-models", async () => {
      return this.paraformerManager.listParaformerModels();
    });

    ipcMain.handle("delete-paraformer-model", async (_event, modelName) => {
      return this.paraformerManager.deleteParaformerModel(modelName);
    });

    ipcMain.handle("delete-all-paraformer-models", async () => {
      return this.paraformerManager.deleteAllParaformerModels();
    });

    ipcMain.handle("cancel-paraformer-download", async () => {
      return this.paraformerManager.cancelDownload();
    });

    // Paraformer binary download
    ipcMain.handle("check-paraformer-binary-status", async () => {
      return this.paraformerManager.checkBinaryStatus();
    });

    ipcMain.handle("download-paraformer-binary", async (event) => {
      try {
        const result = await this.paraformerManager.downloadBinary(
          (progressData) => {
            event.sender.send("paraformer-binary-download-progress", progressData);
          }
        );
        return result;
      } catch (error) {
        event.sender.send("paraformer-binary-download-progress", {
          type: "error",
          percentage: 0,
          error: error.message,
        });
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("cancel-paraformer-binary-download", async () => {
      return this.paraformerManager.cancelBinaryDownload();
    });

    // Translation model handlers
    ipcMain.handle("download-translation-model", async (event, modelName) => {
      try {
        const TranslationManager = require("./translationManager");
        const manager = new TranslationManager();
        const result = await manager.downloadModel(modelName, (progressData) => {
          if (!event.sender.isDestroyed()) {
            event.sender.send("translation-download-progress", progressData);
          }
        });
        return result;
      } catch (error) {
        if (!event.sender.isDestroyed()) {
          event.sender.send("translation-download-progress", {
            type: "error",
            model: modelName,
            error: error.message,
          });
        }
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("check-translation-model", async (_event, modelName) => {
      const TranslationManager = require("./translationManager");
      const manager = new TranslationManager();
      return { downloaded: manager.isModelDownloaded(modelName) };
    });

    ipcMain.handle("delete-translation-model", async (_event, modelName) => {
      const TranslationManager = require("./translationManager");
      const manager = new TranslationManager();
      return await manager.deleteModel(modelName);
    });

    ipcMain.handle("translate-text", async (_event, text, sourceLang, targetLang) => {
      if (!this.windowManager.translationEnabled) {
        return { success: false, error: "Translation feature is disabled in settings" };
      }
      const translationInference = require("./translationInference");
      const TranslationManager = require("./translationManager");
      const manager = new TranslationManager();

      const models = manager.getModelsByDirection(sourceLang, targetLang);
      if (!models.length) {
        return { success: false, error: `No translation model found for ${sourceLang} → ${targetLang}` };
      }

      // Priority mapping to match UI preference
      const preferredModels = {
        "zh-ja": "nllb-200-distilled-600M",
        "ja-zh": "nllb-200-distilled-600M",
        "en-ja": "opus-mt-en-jap",
        "ja-en": "opus-mt-ja-en",
        "zh-en": "opus-mt-zh-en",
        "en-zh": "opus-mt-en-zh",
      };

      const key = `${sourceLang}-${targetLang}`;
      const preferredModel = preferredModels[key];

      // Use preferred model if it matches, otherwise fallback to the first match
      const modelName = (preferredModel && models.includes(preferredModel)) ? preferredModel : models[0];

      if (!manager.isModelDownloaded(modelName)) {
        return { success: false, error: `Translation model not downloaded: ${modelName}` };
      }

      try {
        const result = await translationInference.translate(text, modelName, sourceLang, targetLang);
        return { success: true, text: result };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("set-translation-enabled", async (event, enabled) => {
      this.windowManager.setTranslationEnabled(enabled);
      if (!enabled) {
        const translationInference = require("./translationInference");
        translationInference.clearCache();
      }
      return { success: true };
    });

    ipcMain.handle("list-translation-models", async () => {
      const modelRegistryData = require("../models/modelRegistryData.json");
      return modelRegistryData.translationModels || {};
    });

    ipcMain.handle("pick-models-directory", async (event, defaultPath = "") => {
      try {
        const targetWindow = BrowserWindow.fromWebContents(event.sender);
        const options = {
          title: "Select Local Model Storage Directory",
          defaultPath: defaultPath || app.getPath("home"),
          properties: ["openDirectory", "createDirectory"],
        };
        const result = targetWindow
          ? await dialog.showOpenDialog(targetWindow, options)
          : await dialog.showOpenDialog(options);

        if (result.canceled || !result.filePaths?.length) {
          return { success: false, cancelled: true };
        }
        return { success: true, path: result.filePaths[0], cancelled: false };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("pick-whisper-model-file", async (event, defaultPath = "") => {
      try {
        const targetWindow = BrowserWindow.fromWebContents(event.sender);
        const options = {
          title: "Select Whisper model",
          defaultPath: defaultPath || undefined,
          properties: ["openFile"],
          filters: [
            { name: "Whisper model", extensions: ["bin"] },
            { name: "All files", extensions: ["*"] },
          ],
        };
        const result = targetWindow
          ? await dialog.showOpenDialog(targetWindow, options)
          : await dialog.showOpenDialog(options);

        if (result.canceled || !result.filePaths?.length) {
          return { success: true, path: null, cancelled: true };
        }

        return { success: true, path: result.filePaths[0], cancelled: false };
      } catch (error) {
        return { success: false, error: error.message, path: null, cancelled: false };
      }
    });

    ipcMain.handle("pick-parakeet-model-directory", async (event, defaultPath = "") => {
      try {
        const targetWindow = BrowserWindow.fromWebContents(event.sender);
        const options = {
          title: "Select Parakeet model directory",
          defaultPath: defaultPath || undefined,
          properties: ["openDirectory"],
        };
        const result = targetWindow
          ? await dialog.showOpenDialog(targetWindow, options)
          : await dialog.showOpenDialog(options);

        if (result.canceled || !result.filePaths?.length) {
          return { success: true, path: null, cancelled: true };
        }

        return { success: true, path: result.filePaths[0], cancelled: false };
      } catch (error) {
        return { success: false, error: error.message, path: null, cancelled: false };
      }
    });

    ipcMain.handle("pick-sensevoice-model-file", async (event, defaultPath = "") => {
      try {
        const targetWindow = BrowserWindow.fromWebContents(event.sender);
        const options = {
          title: "Select SenseVoice model",
          defaultPath: defaultPath || undefined,
          properties: ["openFile"],
          filters: [
            { name: "GGUF model", extensions: ["gguf"] },
            { name: "All files", extensions: ["*"] },
          ],
        };
        const result = targetWindow
          ? await dialog.showOpenDialog(targetWindow, options)
          : await dialog.showOpenDialog(options);

        if (result.canceled || !result.filePaths?.length) {
          return { success: true, path: null, cancelled: true };
        }

        return { success: true, path: result.filePaths[0], cancelled: false };
      } catch (error) {
        return { success: false, error: error.message, path: null, cancelled: false };
      }
    });

    ipcMain.handle("pick-sensevoice-binary", async (event, defaultPath = "") => {
      try {
        const targetWindow = BrowserWindow.fromWebContents(event.sender);
        const options = {
          title: "Select sense-voice-main binary",
          defaultPath: defaultPath || undefined,
          properties: ["openFile"],
          filters: [
            {
              name: "SenseVoice binary",
              extensions: process.platform === "win32" ? ["exe"] : ["*"],
            },
            { name: "All files", extensions: ["*"] },
          ],
        };
        const result = targetWindow
          ? await dialog.showOpenDialog(targetWindow, options)
          : await dialog.showOpenDialog(options);

        if (result.canceled || !result.filePaths?.length) {
          return { success: true, path: null, cancelled: true };
        }

        return { success: true, path: result.filePaths[0], cancelled: false };
      } catch (error) {
        return { success: false, error: error.message, path: null, cancelled: false };
      }
    });

    ipcMain.handle("pick-paraformer-model-file", async (event, defaultPath = "") => {
      try {
        const targetWindow = BrowserWindow.fromWebContents(event.sender);
        const options = {
          title: "Select Paraformer model directory",
          defaultPath: defaultPath || undefined,
          properties: ["openDirectory"],
        };
        const result = targetWindow
          ? await dialog.showOpenDialog(targetWindow, options)
          : await dialog.showOpenDialog(options);

        if (result.canceled || !result.filePaths?.length) {
          return { success: true, path: null, cancelled: true };
        }

        return { success: true, path: result.filePaths[0], cancelled: false };
      } catch (error) {
        return { success: false, error: error.message, path: null, cancelled: false };
      }
    });

    ipcMain.handle("pick-paraformer-binary", async (event, defaultPath = "") => {
      try {
        const targetWindow = BrowserWindow.fromWebContents(event.sender);
        const options = {
          title: "Select paraformer-main binary",
          defaultPath: defaultPath || undefined,
          properties: ["openFile"],
          filters: [
            {
              name: "Paraformer binary",
              extensions: process.platform === "win32" ? ["exe"] : ["*"],
            },
            { name: "All files", extensions: ["*"] },
          ],
        };
        const result = targetWindow
          ? await dialog.showOpenDialog(targetWindow, options)
          : await dialog.showOpenDialog(options);

        if (result.canceled || !result.filePaths?.length) {
          return { success: true, path: null, cancelled: true };
        }

        return { success: true, path: result.filePaths[0], cancelled: false };
      } catch (error) {
        return { success: false, error: error.message, path: null, cancelled: false };
      }
    });

    ipcMain.handle("export-settings-file", async (event, payload = {}) => {
      try {
        const targetWindow = BrowserWindow.fromWebContents(event.sender);
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const options = {
          title: "Export ChordVox Settings",
          defaultPath: `ChordVox-settings-${timestamp}.json`,
          filters: [{ name: "JSON", extensions: ["json"] }],
        };

        const result = targetWindow
          ? await dialog.showSaveDialog(targetWindow, options)
          : await dialog.showSaveDialog(options);

        if (result.canceled || !result.filePath) {
          return { success: true, cancelled: true };
        }

        await fsPromises.writeFile(result.filePath, JSON.stringify(payload, null, 2), "utf8");
        return { success: true, cancelled: false, filePath: result.filePath };
      } catch (error) {
        debugLogger.error("Failed to export settings file:", error);
        return { success: false, cancelled: false, error: error.message };
      }
    });

    ipcMain.handle("import-settings-file", async (event) => {
      try {
        const targetWindow = BrowserWindow.fromWebContents(event.sender);
        const options = {
          title: "Import ChordVox Settings",
          properties: ["openFile"],
          filters: [{ name: "JSON", extensions: ["json"] }],
        };

        const result = targetWindow
          ? await dialog.showOpenDialog(targetWindow, options)
          : await dialog.showOpenDialog(options);

        if (result.canceled || !result.filePaths?.length) {
          return { success: true, cancelled: true };
        }

        const filePath = result.filePaths[0];
        const raw = await fsPromises.readFile(filePath, "utf8");
        let parsed;
        try {
          parsed = JSON.parse(raw);
        } catch (parseError) {
          return {
            success: false,
            cancelled: false,
            error: `Invalid JSON file: ${parseError.message}`,
          };
        }

        return { success: true, cancelled: false, filePath, data: parsed };
      } catch (error) {
        debugLogger.error("Failed to import settings file:", error);
        return { success: false, cancelled: false, error: error.message };
      }
    });

    // Utility handlers
    ipcMain.handle("cleanup-app", async (event) => {
      try {
        AppUtils.cleanup(this.windowManager.mainWindow);
        return { success: true, message: "Cleanup completed successfully" };
      } catch (error) {
        throw error;
      }
    });

    ipcMain.handle("update-hotkey", async (event, hotkey) => {
      return await this.windowManager.updateHotkey(hotkey);
    });

    ipcMain.handle("update-secondary-hotkey", async (event, hotkey) => {
      return await this.windowManager.updateSecondaryHotkey(hotkey);
    });

    ipcMain.handle("update-tertiary-hotkey", async (event, hotkey) => {
      return await this.windowManager.updateTertiaryHotkey(hotkey);
    });

    ipcMain.handle("set-hotkey-listening-mode", async (event, enabled, newHotkey = null) => {
      this.windowManager.setHotkeyListeningMode(enabled);
      const hotkeyManager = this.windowManager.hotkeyManager;

      // When exiting capture mode with a new hotkey, use that to avoid reading stale state
      const effectiveHotkey = !enabled && newHotkey ? newHotkey : hotkeyManager.getCurrentHotkey();

      const { isModifierOnlyHotkey, isRightSideModifier } = require("./hotkeyManager");
      const usesNativeListener = (hotkey) =>
        !hotkey ||
        hotkey === "GLOBE" ||
        isModifierOnlyHotkey(hotkey) ||
        isRightSideModifier(hotkey);

      if (enabled) {
        this.secondaryHotkeyBeforeCapture = this.windowManager.secondaryHotkey || "";
        if (this.secondaryHotkeyBeforeCapture) {
          await this.windowManager.unregisterSecondaryHotkey();
        }

        // Entering capture mode - unregister globalShortcut so it doesn't consume key events
        const currentHotkey = hotkeyManager.getCurrentHotkey();
        if (currentHotkey && !usesNativeListener(currentHotkey)) {
          debugLogger.log(
            `[IPC] Unregistering globalShortcut "${currentHotkey}" for hotkey capture mode`
          );
          const { globalShortcut } = require("electron");
          globalShortcut.unregister(currentHotkey);
        }

        // On Windows, stop the Windows key listener
        if (process.platform === "win32" && this.windowsKeyManager) {
          debugLogger.log("[IPC] Stopping Windows key listener for hotkey capture mode");
          this.windowsKeyManager.stop();
        }

        // On GNOME Wayland, unregister the keybinding during capture
        if (hotkeyManager.isUsingGnome() && hotkeyManager.gnomeManager) {
          debugLogger.log("[IPC] Unregistering GNOME keybinding for hotkey capture mode");
          await hotkeyManager.gnomeManager.unregisterKeybinding().catch((err) => {
            debugLogger.warn("[IPC] Failed to unregister GNOME keybinding:", err.message);
          });
        }
      } else {
        if (this.secondaryHotkeyBeforeCapture) {
          await this.windowManager.updateSecondaryHotkey(this.secondaryHotkeyBeforeCapture);
          this.secondaryHotkeyBeforeCapture = "";
        }

        // Exiting capture mode - re-register globalShortcut if not already registered
        if (effectiveHotkey && !usesNativeListener(effectiveHotkey)) {
          const { globalShortcut } = require("electron");
          const accelerator = effectiveHotkey.startsWith("Fn+")
            ? effectiveHotkey.slice(3)
            : effectiveHotkey;
          if (!globalShortcut.isRegistered(accelerator)) {
            debugLogger.log(
              `[IPC] Re-registering globalShortcut "${accelerator}" after capture mode`
            );
            const callback = this.windowManager.createHotkeyCallback();
            const registered = globalShortcut.register(accelerator, callback);
            if (!registered) {
              debugLogger.warn(
                `[IPC] Failed to re-register globalShortcut "${accelerator}" after capture mode`
              );
            }
          }
        }

        if (process.platform === "win32" && this.windowsKeyManager) {
          const activationMode = this.windowManager.getActivationMode();
          debugLogger.log(
            `[IPC] Exiting hotkey capture mode, activationMode="${activationMode}", hotkey="${effectiveHotkey}"`
          );
          const needsListener =
            effectiveHotkey &&
            effectiveHotkey !== "GLOBE" &&
            (activationMode === "push" || isModifierOnlyHotkey(effectiveHotkey));
          if (needsListener) {
            debugLogger.log(`[IPC] Restarting Windows key listener for hotkey: ${effectiveHotkey}`);
            this.windowsKeyManager.start(effectiveHotkey);
          }
        }

        // On GNOME Wayland, re-register the keybinding with the effective hotkey
        if (hotkeyManager.isUsingGnome() && hotkeyManager.gnomeManager && effectiveHotkey) {
          const gnomeHotkey = GnomeShortcutManager.convertToGnomeFormat(effectiveHotkey);
          debugLogger.log(
            `[IPC] Re-registering GNOME keybinding "${gnomeHotkey}" after capture mode`
          );
          const success = await hotkeyManager.gnomeManager.registerKeybinding(gnomeHotkey);
          if (success) {
            hotkeyManager.currentHotkey = effectiveHotkey;
          }
        }
      }

      return { success: true };
    });

    ipcMain.handle("get-hotkey-mode-info", async () => {
      return {
        isUsingGnome: this.windowManager.isUsingGnomeHotkeys(),
      };
    });

    ipcMain.handle("start-window-drag", async (event) => {
      return await this.windowManager.startWindowDrag();
    });

    ipcMain.handle("stop-window-drag", async (event) => {
      return await this.windowManager.stopWindowDrag();
    });

    // External link handler
    ipcMain.handle("open-external", async (event, url) => {
      try {
        await shell.openExternal(url);
        return { success: true };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    // Auto-start handlers
    ipcMain.handle("get-auto-start-enabled", async () => {
      try {
        return this.environmentManager.getAutoStartEnabled();
      } catch (error) {
        debugLogger.error("Error getting auto-start status:", error);
        return true;
      }
    });

    ipcMain.handle("set-auto-start-enabled", async (event, enabled) => {
      try {
        this.environmentManager.saveAutoStartEnabled(enabled);
        app.setLoginItemSettings({
          openAtLogin: enabled,
          openAsHidden: true, // Start minimized to tray
        });
        debugLogger.debug("Auto-start setting updated", { enabled });
        return { success: true };
      } catch (error) {
        debugLogger.error("Error setting auto-start:", error);
        return { success: false, error: error.message };
      }
    });

    // Model management handlers
    ipcMain.handle("model-get-all", async () => {
      try {
        debugLogger.debug("model-get-all called", undefined, "ipc");
        const modelManager = require("./modelManagerBridge").default;
        const models = await modelManager.getModelsWithStatus();
        debugLogger.debug("Returning models", { count: models.length }, "ipc");
        return models;
      } catch (error) {
        debugLogger.error("Error in model-get-all:", error);
        throw error;
      }
    });

    ipcMain.handle("model-check", async (_, modelId) => {
      const modelManager = require("./modelManagerBridge").default;
      return modelManager.isModelDownloaded(modelId);
    });

    ipcMain.handle("model-download", async (event, modelId) => {
      try {
        const modelManager = require("./modelManagerBridge").default;
        const result = await modelManager.downloadModel(
          modelId,
          (progress, downloadedSize, totalSize) => {
            if (!event.sender.isDestroyed()) {
              event.sender.send("model-download-progress", {
                modelId,
                progress,
                downloadedSize,
                totalSize,
              });
            }
          }
        );
        return { success: true, path: result };
      } catch (error) {
        return {
          success: false,
          error: error.message,
          code: error.code,
          details: error.details,
        };
      }
    });

    ipcMain.handle("model-delete", async (event, modelId) => {
      try {
        const modelManager = require("./modelManagerBridge").default;
        await modelManager.deleteModel(modelId);
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error.message,
          code: error.code,
          details: error.details,
        };
      }
    });

    ipcMain.handle("model-delete-all", async () => {
      try {
        const modelManager = require("./modelManagerBridge").default;
        await modelManager.deleteAllModels();
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error.message,
          code: error.code,
          details: error.details,
        };
      }
    });

    ipcMain.handle("model-cancel-download", async (event, modelId) => {
      try {
        const modelManager = require("./modelManagerBridge").default;
        const cancelled = modelManager.cancelDownload(modelId);
        return { success: cancelled };
      } catch (error) {
        return {
          success: false,
          error: error.message,
        };
      }
    });

    ipcMain.handle("model-check-runtime", async (event) => {
      try {
        const modelManager = require("./modelManagerBridge").default;
        await modelManager.ensureLlamaCpp();
        return { available: true };
      } catch (error) {
        return {
          available: false,
          error: error.message,
          code: error.code,
          details: error.details,
        };
      }
    });

    ipcMain.handle("get-anthropic-key", async (event) => {
      return this.environmentManager.getAnthropicKey();
    });

    ipcMain.handle("get-openrouter-key", async () => {
      return this.environmentManager.getOpenRouterKey();
    });

    ipcMain.handle("get-gemini-key", async (event) => {
      return this.environmentManager.getGeminiKey();
    });

    ipcMain.handle("save-gemini-key", async (event, key) => {
      return this.environmentManager.saveGeminiKey(key);
    });

    ipcMain.handle("get-groq-key", async (event) => {
      return this.environmentManager.getGroqKey();
    });

    ipcMain.handle("save-groq-key", async (event, key) => {
      return this.environmentManager.saveGroqKey(key);
    });

    ipcMain.handle("get-mistral-key", async () => {
      return this.environmentManager.getMistralKey();
    });

    ipcMain.handle("save-mistral-key", async (event, key) => {
      return this.environmentManager.saveMistralKey(key);
    });

    // Proxy Mistral transcription through main process to avoid CORS
    ipcMain.handle(
      "proxy-mistral-transcription",
      async (event, { audioBuffer, model, language, contextBias }) => {
        const licenseGate = await this.checkLicenseGate();
        if (!licenseGate.allowed) {
          return this.buildLicenseDeniedResponse(licenseGate.status);
        }

        const apiKey = this.environmentManager.getMistralKey();
        if (!apiKey) {
          throw new Error("Mistral API key not configured");
        }

        const formData = new FormData();
        const audioBlob = new Blob([Buffer.from(audioBuffer)], { type: "audio/webm" });
        formData.append("file", audioBlob, "audio.webm");
        formData.append("model", model || "voxtral-mini-latest");
        if (language && language !== "auto") {
          formData.append("language", language);
        }
        if (contextBias && contextBias.length > 0) {
          for (const token of contextBias) {
            formData.append("context_bias", token);
          }
        }

        const response = await fetch(MISTRAL_TRANSCRIPTION_URL, {
          method: "POST",
          headers: {
            "x-api-key": apiKey,
          },
          body: formData,
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Mistral API Error: ${response.status} ${errorText}`);
        }

        return await response.json();
      }
    );

    ipcMain.handle("get-custom-transcription-key", async () => {
      return this.environmentManager.getCustomTranscriptionKey();
    });

    ipcMain.handle("save-custom-transcription-key", async (event, key) => {
      return this.environmentManager.saveCustomTranscriptionKey(key);
    });

    ipcMain.handle("get-custom-reasoning-key", async () => {
      return this.environmentManager.getCustomReasoningKey();
    });

    ipcMain.handle("save-custom-reasoning-key", async (event, key) => {
      return this.environmentManager.saveCustomReasoningKey(key);
    });


    // Dictation key handlers for reliable persistence across restarts
    ipcMain.handle("get-dictation-key", async () => {
      return this.environmentManager.getDictationKey();
    });

    ipcMain.handle("save-dictation-key", async (_event, key) => {
      return this.environmentManager.saveDictationKey(key);
    });

    ipcMain.handle("get-hf-mirror-url", async () => {
      return this.environmentManager.getHfMirrorUrl();
    });

    ipcMain.handle("save-hf-mirror-url", async (_event, url) => {
      return this.environmentManager.saveHfMirrorUrl(url);
    });

    ipcMain.handle("get-local-models-dir", async () => {
      return this.environmentManager.getLocalModelsDir();
    });

    ipcMain.handle("save-local-models-dir", async (_event, dir) => {
      const result = this.environmentManager.saveLocalModelsDir(dir);
      const modelManager = require("./modelManagerBridge").default;
      modelManager.refreshConfig();
      await this.environmentManager.saveAllKeysToEnvFile();
      return result;
    });

    ipcMain.handle("get-activation-mode", async () => {
      return this.environmentManager.getActivationMode();
    });

    ipcMain.handle("save-activation-mode", async (event, mode) => {
      return this.environmentManager.saveActivationMode(mode);
    });

    ipcMain.handle("save-anthropic-key", async (event, key) => {
      return this.environmentManager.saveAnthropicKey(key);
    });

    ipcMain.handle("save-openrouter-key", async (event, key) => {
      return this.environmentManager.saveOpenRouterKey(key);
    });

    ipcMain.handle("get-ui-language", async () => {
      return this.environmentManager.getUiLanguage();
    });

    ipcMain.handle("save-ui-language", async (event, language) => {
      return this.environmentManager.saveUiLanguage(language);
    });

    ipcMain.handle("set-ui-language", async (event, language) => {
      const result = this.environmentManager.saveUiLanguage(language);
      process.env.UI_LANGUAGE = result.language;
      changeLanguage(result.language);
      this.windowManager?.refreshLocalizedUi?.();
      this.getTrayManager?.()?.updateTrayMenu?.();
      return { success: true, language: result.language };
    });

    ipcMain.handle("save-all-keys-to-env", async () => {
      return this.environmentManager.saveAllKeysToEnvFile();
    });

    ipcMain.handle("sync-startup-preferences", async (event, prefs) => {
      const setVars = {};
      const clearVars = [];

      if (prefs.localModelsDir) {
        setVars.LOCAL_MODELS_DIR = prefs.localModelsDir;
      } else {
        clearVars.push("LOCAL_MODELS_DIR");
      }

      if (prefs.useLocalWhisper && prefs.model) {
        // Local mode with model selected - set provider and model for pre-warming
        setVars.LOCAL_TRANSCRIPTION_PROVIDER = prefs.localTranscriptionProvider;
        if (prefs.localTranscriptionProvider === "nvidia") {
          setVars.PARAKEET_MODEL = prefs.model;
          clearVars.push("LOCAL_WHISPER_MODEL", "SENSEVOICE_MODEL_PATH", "SENSEVOICE_BINARY_PATH", "PARAFORMER_MODEL_PATH", "PARAFORMER_BINARY_PATH");
        } else if (prefs.localTranscriptionProvider === "sensevoice") {
          setVars.SENSEVOICE_MODEL_PATH = prefs.model;
          if (prefs.senseVoiceBinaryPath) {
            setVars.SENSEVOICE_BINARY_PATH = prefs.senseVoiceBinaryPath;
          } else {
            clearVars.push("SENSEVOICE_BINARY_PATH");
          }
          clearVars.push("PARAKEET_MODEL", "LOCAL_WHISPER_MODEL", "PARAFORMER_MODEL_PATH", "PARAFORMER_BINARY_PATH");
        } else if (prefs.localTranscriptionProvider === "paraformer") {
          setVars.PARAFORMER_MODEL_PATH = prefs.model;
          if (prefs.paraformerBinaryPath) {
            setVars.PARAFORMER_BINARY_PATH = prefs.paraformerBinaryPath;
          } else {
            clearVars.push("PARAFORMER_BINARY_PATH");
          }
          clearVars.push("PARAKEET_MODEL", "LOCAL_WHISPER_MODEL", "SENSEVOICE_MODEL_PATH", "SENSEVOICE_BINARY_PATH");
        } else {
          setVars.LOCAL_WHISPER_MODEL = prefs.model;
          clearVars.push("PARAKEET_MODEL", "SENSEVOICE_MODEL_PATH", "SENSEVOICE_BINARY_PATH", "PARAFORMER_MODEL_PATH", "PARAFORMER_BINARY_PATH");
        }
      } else if (prefs.useLocalWhisper) {
        // Local mode enabled but no model selected - clear pre-warming vars
        clearVars.push(
          "LOCAL_TRANSCRIPTION_PROVIDER",
          "PARAKEET_MODEL",
          "LOCAL_WHISPER_MODEL",
          "SENSEVOICE_MODEL_PATH",
          "SENSEVOICE_BINARY_PATH",
          "PARAFORMER_MODEL_PATH",
          "PARAFORMER_BINARY_PATH"
        );
      } else {
        // Cloud mode - clear all local transcription vars
        clearVars.push(
          "LOCAL_TRANSCRIPTION_PROVIDER",
          "PARAKEET_MODEL",
          "LOCAL_WHISPER_MODEL",
          "SENSEVOICE_MODEL_PATH",
          "SENSEVOICE_BINARY_PATH",
          "PARAFORMER_MODEL_PATH",
          "PARAFORMER_BINARY_PATH"
        );
      }

      if (prefs.reasoningProvider === "local" && prefs.reasoningModel) {
        setVars.REASONING_PROVIDER = "local";
        setVars.LOCAL_REASONING_MODEL = prefs.reasoningModel;
      } else if (prefs.reasoningProvider && prefs.reasoningProvider !== "local") {
        clearVars.push("REASONING_PROVIDER", "LOCAL_REASONING_MODEL");
      }

      this._syncStartupEnv(setVars, clearVars);
    });

    // Local reasoning handler
    ipcMain.handle("process-local-reasoning", async (event, text, modelId, config) => {
      const licenseGate = await this.checkLicenseGate();
      if (!licenseGate.allowed) {
        return this.buildLicenseDeniedResponse(licenseGate.status);
      }

      try {
        const LocalReasoningService = require("../services/localReasoningBridge").default;
        const result = await LocalReasoningService.processText(text, modelId, config);
        return { success: true, text: result };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    // Anthropic reasoning handler
    ipcMain.handle(
      "process-anthropic-reasoning",
      async (event, text, modelId, config) => {
        const licenseGate = await this.checkLicenseGate();
        if (!licenseGate.allowed) {
          return this.buildLicenseDeniedResponse(licenseGate.status);
        }

        try {
          const apiKey = this.environmentManager.getAnthropicKey();

          if (!apiKey) {
            throw new Error("Anthropic API key not configured");
          }

          const systemPrompt = config?.systemPrompt || "";
          const userPrompt = text;

          if (!modelId) {
            throw new Error("No model specified for Anthropic API call");
          }

          const requestBody = {
            model: modelId,
            messages: [{ role: "user", content: userPrompt }],
            system: systemPrompt,
            max_tokens: config?.maxTokens || Math.max(100, Math.min(text.length * 2, 4096)),
            temperature: config?.temperature || 0.3,
          };

          const response = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-API-Key": apiKey,
              "anthropic-version": "2023-06-01",
            },
            body: JSON.stringify(requestBody),
          });

          if (!response.ok) {
            const errorText = await response.text();
            let errorData = { error: response.statusText };
            try {
              errorData = JSON.parse(errorText);
            } catch {
              errorData = { error: errorText || response.statusText };
            }
            throw new Error(
              errorData.error?.message ||
              errorData.error ||
              `Anthropic API error: ${response.status}`
            );
          }

          const data = await response.json();
          return { success: true, text: data.content[0].text.trim() };
        } catch (error) {
          debugLogger.error("Anthropic reasoning error:", error);
          return { success: false, error: error.message };
        }
      }
    );

    // Check if local reasoning is available
    ipcMain.handle("check-local-reasoning-available", async () => {
      try {
        const LocalReasoningService = require("../services/localReasoningBridge").default;
        return await LocalReasoningService.isAvailable();
      } catch (error) {
        return false;
      }
    });

    // llama.cpp installation handlers
    ipcMain.handle("llama-cpp-check", async () => {
      try {
        const llamaCppInstaller = require("./llamaCppInstaller").default;
        const isInstalled = await llamaCppInstaller.isInstalled();
        const version = isInstalled ? await llamaCppInstaller.getVersion() : null;
        return { isInstalled, version };
      } catch (error) {
        return { isInstalled: false, error: error.message };
      }
    });

    ipcMain.handle("llama-cpp-install", async () => {
      try {
        const llamaCppInstaller = require("./llamaCppInstaller").default;
        const result = await llamaCppInstaller.install();
        return result;
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("llama-cpp-uninstall", async () => {
      try {
        const llamaCppInstaller = require("./llamaCppInstaller").default;
        const result = await llamaCppInstaller.uninstall();
        return result;
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    // llama-server management handlers
    ipcMain.handle("llama-server-start", async (event, modelId) => {
      try {
        const modelManager = require("./modelManagerBridge").default;
        const modelInfo = modelManager.findModelById(modelId);
        if (!modelInfo) {
          return { success: false, error: `Model "${modelId}" not found` };
        }

        const modelPath = require("path").join(modelManager.modelsDir, modelInfo.model.fileName);

        await modelManager.serverManager.start(modelPath, {
          contextSize: modelInfo.model.contextLength || 4096,
          threads: 4,
        });
        modelManager.currentServerModelId = modelId;

        return { success: true, port: modelManager.serverManager.port };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("llama-server-stop", async () => {
      try {
        const modelManager = require("./modelManagerBridge").default;
        await modelManager.stopServer();
        return { success: true };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("llama-server-status", async () => {
      try {
        const modelManager = require("./modelManagerBridge").default;
        return modelManager.getServerStatus();
      } catch (error) {
        return { available: false, running: false, error: error.message };
      }
    });

    ipcMain.handle("get-log-level", async () => {
      return debugLogger.getLevel();
    });

    ipcMain.handle("app-log", async (event, entry) => {
      debugLogger.logEntry(entry);
      return { success: true };
    });

    const SYSTEM_SETTINGS_URLS = {
      darwin: {
        microphone: "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
        sound: "x-apple.systempreferences:com.apple.preference.sound?input",
        accessibility:
          "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
      },
      win32: {
        microphone: "ms-settings:privacy-microphone",
        sound: "ms-settings:sound",
      },
    };

    const openSystemSettings = async (settingType) => {
      const platform = process.platform;
      const urls = SYSTEM_SETTINGS_URLS[platform];
      const url = urls?.[settingType];

      if (!url) {
        // Platform doesn't support this settings URL
        const messages = {
          microphone: i18nMain.t("systemSettings.microphone"),
          sound: i18nMain.t("systemSettings.sound"),
          accessibility: i18nMain.t("systemSettings.accessibility"),
        };
        return {
          success: false,
          error:
            messages[settingType] || `${settingType} settings are not available on this platform.`,
        };
      }

      try {
        await shell.openExternal(url);
        return { success: true };
      } catch (error) {
        debugLogger.error(`Failed to open ${settingType} settings:`, error);
        return { success: false, error: error.message };
      }
    };

    ipcMain.handle("open-microphone-settings", () => openSystemSettings("microphone"));
    ipcMain.handle("open-sound-input-settings", () => openSystemSettings("sound"));
    ipcMain.handle("open-accessibility-settings", () => openSystemSettings("accessibility"));

    ipcMain.handle("request-microphone-access", async () => {
      if (process.platform !== "darwin") {
        return { granted: true };
      }
      const { systemPreferences } = require("electron");
      const granted = await systemPreferences.askForMediaAccess("microphone");
      return { granted };
    });

    ipcMain.handle("open-whisper-models-folder", async () => {
      try {
        const cacheRoot = path.join(app.getPath("home"), ".cache", "chordvox");
        await fsPromises.mkdir(cacheRoot, { recursive: true });
        await shell.openPath(cacheRoot);
        return { success: true };
      } catch (error) {
        debugLogger.error("Failed to open model cache folder:", error);
        return { success: false, error: error.message };
      }
    });

    // Debug logging handlers
    ipcMain.handle("get-debug-state", async () => {
      try {
        return {
          enabled: debugLogger.isEnabled(),
          logPath: debugLogger.getLogPath(),
          logLevel: debugLogger.getLevel(),
        };
      } catch (error) {
        debugLogger.error("Failed to get debug state:", error);
        return { enabled: false, logPath: null, logLevel: "info" };
      }
    });

    ipcMain.handle("set-debug-logging", async (event, enabled) => {
      try {
        const path = require("path");
        const fs = require("fs");
        const envPath = path.join(app.getPath("userData"), ".env");

        // Read current .env content
        let envContent = "";
        if (fs.existsSync(envPath)) {
          envContent = fs.readFileSync(envPath, "utf8");
        }

        // Parse lines
        const lines = envContent.split("\n");
        const logLevelIndex = lines.findIndex((line) =>
          line.trim().startsWith("CHORDVOX_LOG_LEVEL=")
        );

        if (enabled) {
          // Set to debug
          if (logLevelIndex !== -1) {
            lines[logLevelIndex] = "CHORDVOX_LOG_LEVEL=debug";
          } else {
            // Add new line
            if (lines.length > 0 && lines[lines.length - 1] !== "") {
              lines.push("");
            }
            lines.push("# Debug logging setting");
            lines.push("CHORDVOX_LOG_LEVEL=debug");
          }
        } else {
          // Remove or set to info
          if (logLevelIndex !== -1) {
            lines[logLevelIndex] = "CHORDVOX_LOG_LEVEL=info";
          }
        }

        // Write back
        fs.writeFileSync(envPath, lines.join("\n"), "utf8");

        // Update environment variable
        process.env.CHORDVOX_LOG_LEVEL = enabled ? "debug" : "info";

        // Refresh logger state
        debugLogger.refreshLogLevel();

        return {
          success: true,
          enabled: debugLogger.isEnabled(),
          logPath: debugLogger.getLogPath(),
        };
      } catch (error) {
        debugLogger.error("Failed to set debug logging:", error);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("open-logs-folder", async () => {
      try {
        const logsDir = path.join(app.getPath("userData"), "logs");
        await shell.openPath(logsDir);
        return { success: true };
      } catch (error) {
        debugLogger.error("Failed to open logs folder:", error);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("get-call-trace-sessions", async (_event, limit = 20) => {
      try {
        return { success: true, sessions: debugLogger.getCallTraceSessions(limit) };
      } catch (error) {
        debugLogger.error("Failed to load call trace sessions:", error);
        return { success: false, sessions: [], error: error.message };
      }
    });

    ipcMain.handle("get-call-trace-events", async (_event, runId, limit = 80) => {
      try {
        return {
          success: true,
          events: debugLogger.getCallTraceEvents(runId, limit),
        };
      } catch (error) {
        debugLogger.error("Failed to load call trace events:", error);
        return { success: false, events: [], error: error.message };
      }
    });

    ipcMain.handle("clear-call-traces", async () => {
      try {
        debugLogger.clearRecentEntries("call-trace");
        return { success: true };
      } catch (error) {
        debugLogger.error("Failed to clear call traces:", error);
        return { success: false, error: error.message };
      }
    });

    // --- Assembly AI Streaming handlers ---

    // Helper to fetch streaming token
    const fetchStreamingToken = async (event) => {
      const apiUrl = getApiUrl();
      if (!apiUrl) {
        throw new Error("ChordVox API URL not configured");
      }

      const cookieHeader = await getSessionCookies(event);
      if (!cookieHeader) {
        throw new Error("No session cookies available");
      }

      const tokenResponse = await fetch(`${apiUrl}/api/streaming-token`, {
        method: "POST",
        headers: {
          Cookie: cookieHeader,
        },
      });

      if (!tokenResponse.ok) {
        if (tokenResponse.status === 401) {
          const err = new Error("Session expired");
          err.code = "AUTH_EXPIRED";
          throw err;
        }
        const errorData = await tokenResponse.json().catch(() => ({}));
        throw new Error(
          errorData.error || `Failed to get streaming token: ${tokenResponse.status}`
        );
      }

      const { token } = await tokenResponse.json();
      if (!token) {
        throw new Error("No token received from API");
      }

      return token;
    };

    ipcMain.handle("assemblyai-streaming-warmup", async (event, options = {}) => {
      try {
        const apiUrl = getApiUrl();
        if (!apiUrl) {
          return { success: false, error: "API not configured", code: "NO_API" };
        }

        if (!this.assemblyAiStreaming) {
          this.assemblyAiStreaming = new AssemblyAiStreaming();
        }

        if (this.assemblyAiStreaming.hasWarmConnection()) {
          debugLogger.debug("AssemblyAI connection already warm", {}, "streaming");
          return { success: true, alreadyWarm: true };
        }

        let token = this.assemblyAiStreaming.getCachedToken();
        if (!token) {
          debugLogger.debug("Fetching new streaming token for warmup", {}, "streaming");
          token = await fetchStreamingToken(event);
        }

        await this.assemblyAiStreaming.warmup({ ...options, token });
        debugLogger.debug("AssemblyAI connection warmed up", {}, "streaming");

        return { success: true };
      } catch (error) {
        debugLogger.error("AssemblyAI warmup error", { error: error.message });
        if (error.code === "AUTH_EXPIRED") {
          return { success: false, error: "Session expired", code: "AUTH_EXPIRED" };
        }
        return { success: false, error: error.message };
      }
    });

    let streamingStartInProgress = false;

    ipcMain.handle("assemblyai-streaming-start", async (event, options = {}) => {
      if (streamingStartInProgress) {
        debugLogger.debug("Streaming start already in progress, ignoring", {}, "streaming");
        return { success: false, error: "Operation in progress" };
      }

      streamingStartInProgress = true;
      try {
        const apiUrl = getApiUrl();
        if (!apiUrl) {
          return { success: false, error: "API not configured", code: "NO_API" };
        }

        const win = BrowserWindow.fromWebContents(event.sender);

        if (!this.assemblyAiStreaming) {
          this.assemblyAiStreaming = new AssemblyAiStreaming();
        }

        // Clean up any stale active connection (shouldn't happen normally)
        if (this.assemblyAiStreaming.isConnected) {
          debugLogger.debug(
            "AssemblyAI cleaning up stale connection before start",
            {},
            "streaming"
          );
          await this.assemblyAiStreaming.disconnect(false);
        }

        const hasWarm = this.assemblyAiStreaming.hasWarmConnection();
        debugLogger.debug(
          "AssemblyAI streaming start",
          { hasWarmConnection: hasWarm },
          "streaming"
        );

        let token = this.assemblyAiStreaming.getCachedToken();
        if (!token) {
          debugLogger.debug("Fetching streaming token from API", {}, "streaming");
          token = await fetchStreamingToken(event);
          this.assemblyAiStreaming.cacheToken(token);
        } else {
          debugLogger.debug("Using cached streaming token", {}, "streaming");
        }

        // Set up callbacks to forward events to renderer
        this.assemblyAiStreaming.onPartialTranscript = (text) => {
          if (win && !win.isDestroyed()) {
            win.webContents.send("assemblyai-partial-transcript", text);
          }
        };

        this.assemblyAiStreaming.onFinalTranscript = (text) => {
          if (win && !win.isDestroyed()) {
            win.webContents.send("assemblyai-final-transcript", text);
          }
        };

        this.assemblyAiStreaming.onError = (error) => {
          if (win && !win.isDestroyed()) {
            win.webContents.send("assemblyai-error", error.message);
          }
        };

        this.assemblyAiStreaming.onSessionEnd = (data) => {
          if (win && !win.isDestroyed()) {
            win.webContents.send("assemblyai-session-end", data);
          }
        };

        await this.assemblyAiStreaming.connect({ ...options, token });
        debugLogger.debug("AssemblyAI streaming started", {}, "streaming");

        return {
          success: true,
          usedWarmConnection: this.assemblyAiStreaming.hasWarmConnection() === false,
        };
      } catch (error) {
        debugLogger.error("AssemblyAI streaming start error", { error: error.message });
        if (error.code === "AUTH_EXPIRED") {
          return { success: false, error: "Session expired", code: "AUTH_EXPIRED" };
        }
        return { success: false, error: error.message };
      } finally {
        streamingStartInProgress = false;
      }
    });

    ipcMain.on("assemblyai-streaming-send", (event, audioBuffer) => {
      try {
        if (!this.assemblyAiStreaming) return;
        const buffer = Buffer.from(audioBuffer);
        this.assemblyAiStreaming.sendAudio(buffer);
      } catch (error) {
        debugLogger.error("AssemblyAI streaming send error", { error: error.message });
      }
    });

    ipcMain.on("assemblyai-streaming-force-endpoint", () => {
      this.assemblyAiStreaming?.forceEndpoint();
    });

    ipcMain.handle("assemblyai-streaming-stop", async () => {
      try {
        let result = { text: "" };
        if (this.assemblyAiStreaming) {
          result = await this.assemblyAiStreaming.disconnect(true);
          this.assemblyAiStreaming.cleanupAll();
          this.assemblyAiStreaming = null;
        }

        return { success: true, text: result?.text || "" };
      } catch (error) {
        debugLogger.error("AssemblyAI streaming stop error", { error: error.message });
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("assemblyai-streaming-status", async () => {
      if (!this.assemblyAiStreaming) {
        return { isConnected: false, sessionId: null };
      }
      return this.assemblyAiStreaming.getStatus();
    });

    // --- Deepgram Streaming handlers ---

    let deepgramTokenWindowId = null;

    const fetchDeepgramStreamingTokenFromWindow = async (windowId) => {
      const apiUrl = getApiUrl();
      if (!apiUrl) throw new Error("ChordVox API URL not configured");

      const win = BrowserWindow.fromId(windowId);
      if (!win || win.isDestroyed()) throw new Error("Window not available for token refresh");

      const cookieHeader = await getSessionCookiesFromWindow(win);
      if (!cookieHeader) throw new Error("No session cookies available");

      const tokenResponse = await fetch(`${apiUrl}/api/deepgram-streaming-token`, {
        method: "POST",
        headers: { Cookie: cookieHeader },
      });

      if (!tokenResponse.ok) {
        if (tokenResponse.status === 401) {
          const err = new Error("Session expired");
          err.code = "AUTH_EXPIRED";
          throw err;
        }
        throw new Error(`Failed to get Deepgram streaming token: ${tokenResponse.status}`);
      }

      const { token } = await tokenResponse.json();
      if (!token) throw new Error("No token received from API");
      return token;
    };

    const fetchDeepgramStreamingToken = async (event) => {
      const apiUrl = getApiUrl();
      if (!apiUrl) {
        throw new Error("ChordVox API URL not configured");
      }

      const cookieHeader = await getSessionCookies(event);
      if (!cookieHeader) {
        throw new Error("No session cookies available");
      }

      const tokenResponse = await fetch(`${apiUrl}/api/deepgram-streaming-token`, {
        method: "POST",
        headers: {
          Cookie: cookieHeader,
        },
      });

      if (!tokenResponse.ok) {
        if (tokenResponse.status === 401) {
          const err = new Error("Session expired");
          err.code = "AUTH_EXPIRED";
          throw err;
        }
        const errorData = await tokenResponse.json().catch(() => ({}));
        throw new Error(
          errorData.error || `Failed to get Deepgram streaming token: ${tokenResponse.status}`
        );
      }

      const { token } = await tokenResponse.json();
      if (!token) {
        throw new Error("No token received from API");
      }

      return token;
    };

    ipcMain.handle("deepgram-streaming-warmup", async (event, options = {}) => {
      try {
        const apiUrl = getApiUrl();
        if (!apiUrl) {
          return { success: false, error: "API not configured", code: "NO_API" };
        }

        const win = BrowserWindow.fromWebContents(event.sender);
        if (win && !win.isDestroyed()) {
          deepgramTokenWindowId = win.id;
        }

        if (!this.deepgramStreaming) {
          this.deepgramStreaming = new DeepgramStreaming();
        }

        this.deepgramStreaming.setTokenRefreshFn(async () => {
          if (!deepgramTokenWindowId) throw new Error("No window reference");
          return fetchDeepgramStreamingTokenFromWindow(deepgramTokenWindowId);
        });

        if (this.deepgramStreaming.hasWarmConnection()) {
          debugLogger.debug("Deepgram connection already warm", {}, "streaming");
          return { success: true, alreadyWarm: true };
        }

        let token = this.deepgramStreaming.getCachedToken();
        if (!token) {
          debugLogger.debug("Fetching new Deepgram streaming token for warmup", {}, "streaming");
          token = await fetchDeepgramStreamingToken(event);
        }

        await this.deepgramStreaming.warmup({ ...options, token });
        debugLogger.debug("Deepgram connection warmed up", {}, "streaming");

        return { success: true };
      } catch (error) {
        debugLogger.error("Deepgram warmup error", { error: error.message });
        if (error.code === "AUTH_EXPIRED") {
          return { success: false, error: "Session expired", code: "AUTH_EXPIRED" };
        }
        return { success: false, error: error.message };
      }
    });

    let deepgramStreamingStartInProgress = false;

    ipcMain.handle("deepgram-streaming-start", async (event, options = {}) => {
      if (deepgramStreamingStartInProgress) {
        debugLogger.debug(
          "Deepgram streaming start already in progress, ignoring",
          {},
          "streaming"
        );
        return { success: false, error: "Operation in progress" };
      }

      deepgramStreamingStartInProgress = true;
      try {
        const apiUrl = getApiUrl();
        if (!apiUrl) {
          return { success: false, error: "API not configured", code: "NO_API" };
        }

        const win = BrowserWindow.fromWebContents(event.sender);
        if (win && !win.isDestroyed()) {
          deepgramTokenWindowId = win.id;
        }

        if (!this.deepgramStreaming) {
          this.deepgramStreaming = new DeepgramStreaming();
        }

        this.deepgramStreaming.setTokenRefreshFn(async () => {
          if (!deepgramTokenWindowId) throw new Error("No window reference");
          return fetchDeepgramStreamingTokenFromWindow(deepgramTokenWindowId);
        });

        if (this.deepgramStreaming.isConnected) {
          debugLogger.debug("Deepgram cleaning up stale connection before start", {}, "streaming");
          await this.deepgramStreaming.disconnect(false);
        }

        const hasWarm = this.deepgramStreaming.hasWarmConnection();
        debugLogger.debug("Deepgram streaming start", { hasWarmConnection: hasWarm }, "streaming");

        let token = this.deepgramStreaming.getCachedToken();
        if (!token) {
          debugLogger.debug("Fetching Deepgram streaming token from API", {}, "streaming");
          token = await fetchDeepgramStreamingToken(event);
          this.deepgramStreaming.cacheToken(token);
        } else {
          debugLogger.debug("Using cached Deepgram streaming token", {}, "streaming");
        }

        this.deepgramStreaming.onPartialTranscript = (text) => {
          if (win && !win.isDestroyed()) {
            win.webContents.send("deepgram-partial-transcript", text);
          }
        };

        this.deepgramStreaming.onFinalTranscript = (text) => {
          if (win && !win.isDestroyed()) {
            win.webContents.send("deepgram-final-transcript", text);
          }
        };

        this.deepgramStreaming.onError = (error) => {
          if (win && !win.isDestroyed()) {
            win.webContents.send("deepgram-error", error.message);
          }
        };

        this.deepgramStreaming.onSessionEnd = (data) => {
          if (win && !win.isDestroyed()) {
            win.webContents.send("deepgram-session-end", data);
          }
        };

        await this.deepgramStreaming.connect({ ...options, token });
        debugLogger.debug("Deepgram streaming started", {}, "streaming");

        return {
          success: true,
          usedWarmConnection: hasWarm,
        };
      } catch (error) {
        debugLogger.error("Deepgram streaming start error", { error: error.message });
        if (error.code === "AUTH_EXPIRED") {
          return { success: false, error: "Session expired", code: "AUTH_EXPIRED" };
        }
        return { success: false, error: error.message };
      } finally {
        deepgramStreamingStartInProgress = false;
      }
    });

    ipcMain.on("deepgram-streaming-send", (event, audioBuffer) => {
      try {
        if (!this.deepgramStreaming) return;
        const buffer = Buffer.from(audioBuffer);
        this.deepgramStreaming.sendAudio(buffer);
      } catch (error) {
        debugLogger.error("Deepgram streaming send error", { error: error.message });
      }
    });

    ipcMain.on("deepgram-streaming-finalize", () => {
      this.deepgramStreaming?.finalize();
    });

    ipcMain.handle("deepgram-streaming-stop", async () => {
      try {
        let result = { text: "" };
        if (this.deepgramStreaming) {
          result = await this.deepgramStreaming.disconnect(true);
        }

        return { success: true, text: result?.text || "" };
      } catch (error) {
        debugLogger.error("Deepgram streaming stop error", { error: error.message });
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("deepgram-streaming-status", async () => {
      if (!this.deepgramStreaming) {
        return { isConnected: false, sessionId: null };
      }
      return this.deepgramStreaming.getStatus();
    });
  }

  broadcastToWindows(channel, payload) {
    const windows = BrowserWindow.getAllWindows();
    windows.forEach((win) => {
      if (!win.isDestroyed()) {
        win.webContents.send(channel, payload);
      }
    });
  }
}

module.exports = IPCHandlers;
