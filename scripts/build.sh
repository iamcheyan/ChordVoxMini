#!/bin/bash

# ChordVoxMini One-Click Build Script
# This script automates the entire build process based on the current platform.

# Set colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Detect Platform
PLATFORM="unknown"
if [[ "$OSTYPE" == "darwin"* ]]; then
    PLATFORM="macos"
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    PLATFORM="linux"
elif [[ "$OSTYPE" == "msys" || "$OSTYPE" == "cygwin" || "$OSTYPE" == "win32" ]]; then
    PLATFORM="windows"
fi

# Fallback to uname if OSTYPE is not enough
if [ "$PLATFORM" == "unknown" ]; then
    case "$(uname -s)" in
        Darwin*)    PLATFORM="macos";;
        Linux*)     PLATFORM="linux";;
        CYGWIN*|MINGW*|MSYS*) PLATFORM="windows";;
    esac
fi

echo -e "${BLUE}==================================================${NC}"
echo -e "${BLUE}   ChordVoxMini Build Orchestrator (${PLATFORM})  ${NC}"
echo -e "${BLUE}==================================================${NC}"

# Exit on error
set -e

# 1. Check for Node.js dependencies
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}📦 node_modules not found. Installing dependencies...${NC}"
    npm install
else
    echo -e "${GREEN}✅ Dependencies found.${NC}"
fi

# 2. Clean previous builds
echo -e "${YELLOW}🧹 Cleaning previous build artifacts...${NC}"
rm -rf dist
rm -rf src/dist

# 3. Determine Build Target
BUILD_CMD=""
case "$PLATFORM" in
    macos)
        BUILD_CMD="build:mac"
        ;;
    linux)
        BUILD_CMD="build:linux"
        ;;
    windows)
        BUILD_CMD="build:win"
        ;;
    *)
        echo -e "${RED}❌ Error: Unsupported platform: $PLATFORM${NC}"
        exit 1
        ;;
esac

# 4. Execute Build via NPM
# We use npm run which handles prebuild/postbuild scripts automatically.
# prebuild scripts handle: native compilation and engine downloads.
echo -e "${YELLOW}🏗️  Executing build command: npm run ${BUILD_CMD}...${NC}"
npm run "$BUILD_CMD"

echo -e "${BLUE}==================================================${NC}"
echo -e "${GREEN}🎉 BUILD COMPLETE!${NC}"
echo -e "${GREEN}The installation files are in the 'dist' folder.${NC}"
echo -e "${BLUE}==================================================${NC}"

# Platform-specific tips
if [ "$PLATFORM" == "macos" ]; then
    echo -e "${YELLOW}Tip: If the app is blocked by macOS security after moving to Applications, run:${NC}"
    echo -e "xattr -dr com.apple.quarantine /Applications/ChordVoxMini.app"
elif [ "$PLATFORM" == "linux" ]; then
    echo -e "${YELLOW}Tip: Ensure you have the necessary AppImage dependencies installed if running on a fresh system.${NC}"
fi
