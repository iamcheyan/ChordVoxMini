const { app } = require("electron");
const os = require("os");
const path = require("path");

function getModelsDirForService(service) {
  const customRoot = process.env.LOCAL_MODELS_DIR;
  if (customRoot) {
    return path.join(customRoot, `${service}-models`);
  }
  const homeDir = app?.getPath?.("home") || os.homedir();
  return path.join(homeDir, ".cache", "chordvox", `${service}-models`);
}

module.exports = { getModelsDirForService };
