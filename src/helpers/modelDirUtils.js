const fs = require("fs");
const { app } = require("electron");
const os = require("os");
const path = require("path");

function getModelsDirForService(service) {
  const customRoot = process.env.LOCAL_MODELS_DIR;
  if (customRoot) {
    return path.join(customRoot, `${service}-models`);
  }
  const homeDir = app?.getPath?.("home") || os.homedir();
  const newPath = path.join(homeDir, ".cache", "chordvoxmini", `${service}-models`);

  // Fallback: check if models exist in the old Application Support path
  // (used by earlier versions: ~/Library/Application Support/chordvox/models/*/)
  const userData = app?.getPath?.("userData");
  if (userData) {
    const oldPath = path.join(userData, "models", `${service}-models`);
    try {
      if (fs.existsSync(oldPath)) {
        return oldPath;
      }
    } catch {
      // Ignore stat errors on fallback path
    }
  }

  return newPath;
}

module.exports = { getModelsDirForService };
