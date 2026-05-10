#!/usr/bin/env node

/**
 * ChordVox One-Click Build Script
 * Detects the current platform and runs the appropriate build commands.
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');

function log(message, type = 'info') {
  const colors = {
    info: '\x1b[36m',    // Cyan
    success: '\x1b[32m', // Green
    warning: '\x1b[33m', // Yellow
    error: '\x1b[31m',   // Red
    reset: '\x1b[0m'
  };
  console.log(`${colors[type]}[Build] ${message}${colors.reset}`);
}

function runCommand(command, args, cwd = projectRoot) {
  log(`Running: ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: true,
    cwd
  });

  if (result.status !== 0) {
    log(`Command failed with status ${result.status}`, 'error');
    process.exit(1);
  }
}

async function main() {
  log('Starting ChordVox one-click build process...', 'info');

  // 1. Check node_modules
  if (!fs.existsSync(path.join(projectRoot, 'node_modules'))) {
    log('node_modules not found. Installing dependencies...', 'warning');
    runCommand('npm', ['install']);
  }

  // 2. Detect platform
  const platform = process.platform;
  let buildScript = '';

  if (platform === 'darwin') {
    log('Detected macOS platform.', 'success');
    buildScript = 'build:mac';
  } else if (platform === 'win32') {
    log('Detected Windows platform.', 'success');
    buildScript = 'build:win';
  } else if (platform === 'linux') {
    log('Detected Linux platform.', 'success');
    buildScript = 'build:linux';
  } else {
    log(`Unsupported platform: ${platform}`, 'error');
    process.exit(1);
  }

  // 3. Run the build command
  // Note: This triggers the 'prebuild:...' scripts in package.json automatically
  log(`Executing build command: npm run ${buildScript}`, 'info');
  runCommand('npm', ['run', buildScript]);

  // 4. Success message
  const distPath = path.join(projectRoot, 'dist');
  log('\n' + '='.repeat(50), 'success');
  log('BUILD SUCCESSFUL!', 'success');
  log(`Output files are located in: ${distPath}`, 'success');
  log('='.repeat(50) + '\n', 'success');

  if (platform === 'darwin') {
    log('Tip: On macOS, if the app is blocked by Gatekeeper, run:');
    log('xattr -dr com.apple.quarantine /Applications/ChordVox.app');
  }
}

main().catch(err => {
  log(`Unexpected error: ${err.message}`, 'error');
  process.exit(1);
});
