const fs = require("fs");
const path = require("path");
const { app } = require("electron");
const debugLogger = require("./debugLogger");
const TranslationManager = require("./translationManager");

let ort = null;
try {
  ort = require("onnxruntime-node");
} catch (err) {
  debugLogger.warn("onnxruntime-node not available:", err.message);
}

const { spawn } = require("child_process");

class TranslationInference {
  constructor() {
    this.sessionCache = new Map();
    this.manager = new TranslationManager();
    this.pythonWorkers = new Map(); // modelName -> { process, ready, pendingRequests }
  }

  async getSession(modelName) {
    if (this.sessionCache.has(modelName)) {
      return this.sessionCache.get(modelName);
    }

    const modelDir = this.manager.getModelPath(modelName);
    const config = require("../models/modelRegistryData.json").translationModels[modelName];
    if (!config) throw new Error(`No config for model: ${modelName}`);

    if (config.usePythonInference) {
      // For Python-based inference, we manage workers separately
      return { config };
    }

    const encoderPath = path.join(modelDir, config.files.encoder);
    const decoderPath = path.join(modelDir, config.files.decoder);

    if (!fs.existsSync(encoderPath) || !fs.existsSync(decoderPath)) {
      throw new Error(`Model files not found for ${modelName}. Please download the model first.`);
    }

    debugLogger.info(`Loading translation model (Node.js): ${modelName}`);

    const encoderSession = await ort.InferenceSession.create(encoderPath, {
      executionProviders: ["cpu"],
    });
    const decoderSession = await ort.InferenceSession.create(decoderPath, {
      executionProviders: ["cpu"],
    });

    let tokenizer = null;
    const tokenizerPath = path.join(modelDir, config.files.tokenizer);
    if (fs.existsSync(tokenizerPath)) {
      tokenizer = JSON.parse(fs.readFileSync(tokenizerPath, "utf-8"));
    }

    const session = { encoderSession, decoderSession, tokenizer, config };
    this.sessionCache.set(modelName, session);
    return session;
  }

  tokenize(text, tokenizer) {
    if (!tokenizer) {
      throw new Error("Tokenizer not loaded");
    }

    const vocab = tokenizer.model?.vocab || tokenizer.vocab || [];
    const vocabMap = new Map();
    if (Array.isArray(vocab)) {
      vocab.forEach((token, id) => vocabMap.set(token, id));
    } else if (typeof vocab === "object") {
      Object.entries(vocab).forEach(([token, id]) => vocabMap.set(token, id));
    }

    const unkTokenId = tokenizer.unk_token_id ?? vocabMap.get("[UNK]") ?? 0;
    const eosTokenId = tokenizer.eos_token_id ?? vocabMap.get("[eos]") ?? 1;
    const padTokenId = tokenizer.pad_token_id ?? vocabMap.get("[pad]") ?? 0;

    const clsTokenId = vocabMap.get("[cls]") ?? vocabMap.get("<s>") ?? eosTokenId;
    const sepTokenId = vocabMap.get("[sep]") ?? vocabMap.get("</s>") ?? eosTokenId;

    const lowerText = text.toLowerCase();
    const words = lowerText.split(/(\s+)/).filter(Boolean);

    const ids = [clsTokenId];
    for (const word of words) {
      const trimmed = word.trim();
      if (!trimmed) {
        const spaceId = vocabMap.get("▁") ?? vocabMap.get("Ġ") ?? vocabMap.get(" ");
        if (spaceId !== undefined) ids.push(spaceId);
        continue;
      }

      let found = false;
      for (const [token, tokenId] of vocabMap) {
        const cleanToken = token.replace(/^▁/, "").replace(/^Ġ/, "");
        if (cleanToken === trimmed && tokenId !== clsTokenId && tokenId !== sepTokenId && tokenId !== padTokenId) {
          ids.push(tokenId);
          found = true;
          break;
        }
      }
      if (!found) {
        for (const char of trimmed) {
          const charId = vocabMap.get(char) ?? vocabMap.get(`▁${char}`) ?? vocabMap.get(`Ġ${char}`);
          if (charId !== undefined) {
            ids.push(charId);
          } else {
            ids.push(unkTokenId);
          }
        }
      }
    }
    ids.push(sepTokenId);

    return { ids, eosTokenId, padTokenId };
  }

  detokenize(tokenIds, tokenizer) {
    if (!tokenizer) {
      return tokenIds.map(String).join(" ");
    }

    const vocab = tokenizer.model?.vocab || tokenizer.vocab || [];
    const idToToken = new Map();

    if (Array.isArray(vocab)) {
      vocab.forEach((token, id) => idToToken.set(id, token));
    } else if (typeof vocab === "object") {
      Object.entries(vocab).forEach(([token, id]) => idToToken.set(id, token));
    }

    const eosTokenId = tokenizer.eos_token_id ?? 1;
    const padTokenId = tokenizer.pad_token_id ?? 0;

    const tokens = [];
    for (const id of tokenIds) {
      if (id === eosTokenId || id === padTokenId) break;
      const token = idToToken.get(id) ?? `[${id}]`;
      tokens.push(token);
    }

    let text = tokens.join("");
    text = text.replace(/▁/g, " ").replace(/Ġ/g, " ");
    text = text.replace(/\s+/g, " ").trim();
    return text;
  }

  async translate(text, modelName, sourceLang, targetLang) {
    if (!text || text.trim().length === 0) {
      return "";
    }

    const session = await this.getSession(modelName);
    const { config } = session;

    if (config.usePythonInference) {
      return this.translateWithPython(text, modelName, sourceLang, targetLang);
    }

    // Node.js fallback (existing implementation)
    return this.translateWithNode(text, session);
  }

  async translateWithNode(text, session) {
    const { encoderSession, decoderSession, tokenizer } = session;
    if (!ort) throw new Error("onnxruntime-node is not available");

    const { ids, eosTokenId, padTokenId } = this.tokenize(text, tokenizer);
    const maxInputLength = 512;
    const truncatedIds = ids.slice(0, maxInputLength);

    const inputIdsArray = new BigInt64Array(truncatedIds.map((id) => BigInt(id)));
    const attentionMaskArray = new BigInt64Array(truncatedIds.map(() => BigInt(1)));

    const inputIdsTensor = new ort.Tensor("int64", inputIdsArray, [1, truncatedIds.length]);
    const attentionMaskTensor = new ort.Tensor("int64", attentionMaskArray, [1, truncatedIds.length]);

    const encoderOutputs = await encoderSession.run({
      input_ids: inputIdsTensor,
      attention_mask: attentionMaskTensor,
    });

    const encoderKey = Object.keys(encoderOutputs).find((k) => k.includes("last_hidden_state") || k.includes("encoder"));
    const encoderHiddenStates = encoderOutputs[encoderKey];

    const maxOutputLength = 512;
    const generatedIds = [];
    let decoderInputIds = [BigInt(eosTokenId)];

    for (let step = 0; step < maxOutputLength; step++) {
      const decoderInputArray = new BigInt64Array(decoderInputIds);
      const decoderInputTensor = new ort.Tensor("int64", decoderInputArray, [1, decoderInputIds.length]);

      const decoderOutputs = await decoderSession.run({
        input_ids: decoderInputTensor,
        encoder_hidden_states: encoderHiddenStates,
        encoder_attention_mask: attentionMaskTensor,
      });

      const logitsKey = Object.keys(decoderOutputs).find((k) => k.includes("logits"));
      const logits = decoderOutputs[logitsKey];
      const logitsData = logits.data;

      const vocabSize = logits.dims[logits.dims.length - 1];
      const lastTokenLogits = logitsData.slice(
        (logits.dims[1] - 1) * vocabSize,
        logits.dims[1] * vocabSize
      );

      let maxVal = -Infinity;
      let maxIdx = 0;
      for (let i = 0; i < lastTokenLogits.length; i++) {
        if (lastTokenLogits[i] > maxVal) {
          maxVal = lastTokenLogits[i];
          maxIdx = i;
        }
      }

      const nextTokenId = maxIdx;
      generatedIds.push(nextTokenId);
      if (nextTokenId === eosTokenId || nextTokenId === padTokenId) break;
      decoderInputIds = [...decoderInputIds, BigInt(nextTokenId)];
    }

    return this.detokenize(generatedIds, tokenizer);
  }

  async getPythonWorker(modelName) {
    if (this.pythonWorkers.has(modelName)) {
      return this.pythonWorkers.get(modelName);
    }

    const appPath = app?.getAppPath?.() || process.cwd();
    let scriptPath = path.join(appPath, "scripts", "test_nllb_translation.py");
    if (!fs.existsSync(scriptPath)) {
      scriptPath = path.join(process.cwd(), "scripts", "test_nllb_translation.py");
    }

    debugLogger.info(`Starting persistent Python translation worker for ${modelName}`);

    const pythonProcess = spawn("python3", [scriptPath, "--listen"]);
    const worker = {
      process: pythonProcess,
      readyPromise: null,
      pendingRequests: [],
      currentResponse: "",
    };

    worker.readyPromise = new Promise((resolve, reject) => {
      const onData = (data) => {
        const msg = data.toString();
        if (msg.includes("[ready]")) {
          pythonProcess.stderr.off("data", onData);
          resolve();
        }
      };
      pythonProcess.stderr.on("data", onData);
      pythonProcess.on("error", reject);
      
      // Cleanup on exit
      pythonProcess.on("exit", () => {
        debugLogger.warn(`Python translation worker for ${modelName} exited`);
        this.pythonWorkers.delete(modelName);
      });
    });

    pythonProcess.stdout.on("data", (data) => {
      worker.currentResponse += data.toString();
      if (worker.currentResponse.includes("\n")) {
        const lines = worker.currentResponse.split("\n");
        // Process all complete lines
        while (lines.length > 1) {
          const line = lines.shift().trim();
          if (line) {
            try {
              const result = JSON.parse(line);
              const nextRequest = worker.pendingRequests.shift();
              if (nextRequest) nextRequest.resolve(result);
            } catch (e) {
              debugLogger.error("Failed to parse Python worker response", { line, error: e.message });
            }
          }
        }
        worker.currentResponse = lines[0];
      }
    });

    pythonProcess.stderr.on("data", (data) => {
      const msg = data.toString();
      if (msg.includes("[error]")) debugLogger.error(`Python Worker Error: ${msg}`);
      else if (msg.includes("[info]")) debugLogger.info(`Python Worker: ${msg}`);
    });

    this.pythonWorkers.set(modelName, worker);
    await worker.readyPromise;
    return worker;
  }

  async translateWithPython(text, modelName, sourceLang, targetLang) {
    try {
      const worker = await this.getPythonWorker(modelName);
      
      return new Promise((resolve, reject) => {
        worker.pendingRequests.push({ resolve, reject });
        worker.process.stdin.write(JSON.stringify({ text, src: sourceLang, tgt: targetLang }) + "\n");
      }).then(response => {
        if (!response.success) throw new Error(response.error || "Translation failed");
        debugLogger.info(`Translation complete (Python Daemon)`, { 
          elapsed: response.elapsed,
          model: modelName 
        });
        return response.text;
      });
    } catch (error) {
      debugLogger.error("Python translation failed", { error: error.message });
      throw error;
    }
  }

  clearCache() {
    for (const session of this.sessionCache.values()) {
      if (session.encoderSession) session.encoderSession.release?.();
      if (session.decoderSession) session.decoderSession.release?.();
    }
    this.sessionCache.clear();
    
    for (const worker of this.pythonWorkers.values()) {
      worker.process.kill();
    }
    this.pythonWorkers.clear();
  }
}

const translationInference = new TranslationInference();
module.exports = translationInference;
