const fs = require('fs');
const path = require('path');
const os = require('os');

const modelDir = path.join(os.homedir(), '.cache', 'chordvox', 'translation-models', 'nllb-200-distilled-600M');

const filesToCheck = [
  'onnx/encoder_model.onnx',
  'onnx/decoder_model_merged.onnx',
  'tokenizer.json',
  'config.json',
  'onnx/decoder_model_merged_int8.onnx',
  'sentencepiece.bpe.model'
];

console.log(`Checking directory: ${modelDir}`);
if (fs.existsSync(modelDir)) {
  console.log('Directory exists.');
  filesToCheck.forEach(f => {
    const p = path.join(modelDir, f);
    console.log(`${f}: ${fs.existsSync(p) ? 'EXISTS' : 'MISSING'}`);
  });
} else {
  console.log('Directory DOES NOT exist.');
}
