const TranslationManager = require('../src/helpers/translationManager');
const manager = new TranslationManager();
const modelName = 'nllb-200-distilled-600M';

console.log(`Checking model: ${modelName}`);
try {
  const isDownloaded = manager.isModelDownloaded(modelName);
  console.log(`isModelDownloaded: ${isDownloaded}`);
  
  const modelsDir = manager.getModelsDir();
  console.log(`Models dir: ${modelsDir}`);
  
  const modelPath = manager.getModelPath(modelName);
  console.log(`Model path: ${modelPath}`);
} catch (e) {
  console.error(`Error: ${e.message}`);
}
