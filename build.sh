#!/bin/bash

# Complete build script for Insighto with ASR server
# This script builds the Python ASR server binary and packages the Electron app

set -e  # Exit on any error

echo "🚀 Building Laserreach Intelli with ASR Server"
echo "===================================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if we're on macOS
if [[ "$OSTYPE" == "darwin"* ]]; then
    PLATFORM="mac"
    ASR_BINARY_NAME="cluely-asr"
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    PLATFORM="linux"
    ASR_BINARY_NAME="cluely-asr"
elif [[ "$OSTYPE" == "msys" ]] || [[ "$OSTYPE" == "win32" ]]; then
    PLATFORM="windows"
    ASR_BINARY_NAME="cluely-asr.exe"
else
    print_error "Unsupported platform: $OSTYPE"
    exit 1
fi

print_status "Building for platform: $PLATFORM"

# Step 1: Check prerequisites
print_status "Checking prerequisites..."

# Check Python
if ! command -v python3 &> /dev/null; then
    print_error "Python 3 is required but not installed"
    exit 1
fi

PYTHON_VERSION=$(python3 --version | cut -d' ' -f2)
print_success "Python version: $PYTHON_VERSION"

# Check Node.js
if ! command -v node &> /dev/null; then
    print_error "Node.js is required but not installed"
    exit 1
fi

NODE_VERSION=$(node --version)
print_success "Node.js version: $NODE_VERSION"

# Check npm
if ! command -v npm &> /dev/null; then
    print_error "npm is required but not installed"
    exit 1
fi

NPM_VERSION=$(npm --version)
print_success "npm version: $NPM_VERSION"

# Step 2: Install Node.js dependencies
print_status "Installing Node.js dependencies..."
npm install
print_success "Node.js dependencies installed"

# Step 3: Build ASR server binary
print_status "Building ASR server binary..."

# Create Python virtual environment for clean build
if [ ! -d "venv" ]; then
    print_status "Creating Python virtual environment..."
    python3 -m venv venv
fi

# Activate virtual environment
source venv/bin/activate

# Build the ASR binary
python3 build-asr-binary.py

if [ ! -f "dist/$ASR_BINARY_NAME" ]; then
    print_error "ASR binary not found after build"
    exit 1
fi

print_success "ASR server binary built: dist/$ASR_BINARY_NAME"

# Step 4: Update package.json build configuration
print_status "Updating build configuration..."

# Create a temporary build config that includes the ASR binary
cat > electron-builder-config.js << EOF
const config = {
  appId: "com.laserreach.intelli",
  productName: "Laserreach Intelli",
  directories: {
    output: "dist-app"
  },
  files: [
    "**/*",
    "!dist/**/*",
    "!dist-app/**/*",
    "!venv/**/*",
    "!build-venv/**/*",
    "!build-asr-binary.py",
    "!asr_server.spec",
    "!requirements.txt",
    "!*.sh",
    "!*.bat",
    "!test-*.js",
    "!.kiro/**/*",
    "!models/**/*",
    "!*.dmg",
    "!*.exe"
  ],
  extraFiles: [
    {
      from: "dist/$ASR_BINARY_NAME",
      to: "Resources/$ASR_BINARY_NAME",
      filter: ["**/*"]
    }
  ],
  mac: {
    icon: "app-icon.icns",
    category: "public.app-category.productivity",
    target: [
      {
        target: "dmg",
        arch: ["x64", "arm64"]
      }
    ],
    extraFiles: [
      {
        from: "dist/$ASR_BINARY_NAME",
        to: "Contents/MacOS/$ASR_BINARY_NAME"
      }
    ]
  },
  linux: {
    icon: "icons/icon-512.png",
    category: "Office",
    target: [
      {
        target: "AppImage",
        arch: ["x64"]
      }
    ]
  },
  win: {
    icon: "icons/icon-256.png",
    target: [
      {
        target: "nsis",
        arch: ["x64"]
      }
    ]
  }
};

module.exports = config;
EOF

print_success "Build configuration updated"

# Step 5: Build Electron app
print_status "Building Electron application..."

# Use the custom config
npx electron-builder --config electron-builder-config.js

if [ $? -eq 0 ]; then
    print_success "Electron app built successfully!"
    
    # Show output location
    if [ -d "dist-app" ]; then
        print_status "Build artifacts:"
        ls -la dist-app/
    fi
    
    echo ""
    print_success "🎉 Build completed successfully!"
    echo ""
    print_status "The ASR server binary has been included in the app bundle."
    print_status "You can find the built application in the 'dist-app' directory."
    
else
    print_error "Electron app build failed"
    exit 1
fi

# Cleanup
print_status "Cleaning up temporary files..."
rm -f electron-builder-config.js
deactivate  # Deactivate Python virtual environment

print_success "Build process completed!"
