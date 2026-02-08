#!/bin/bash

# Optimized build script for Insighto - excludes LLM models for smaller distribution
# This script builds the Python ASR server binary and packages the Electron app WITHOUT LLM models

set -e  # Exit on any error

echo "🚀 Building Insighto (Optimized - No LLM Models)"
echo "================================================"

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

# Ensure MCP is enabled for regular builds
export MAS_BUILD=false

print_status "Building optimized version for platform: $PLATFORM (MCP enabled)"

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

# Step 3: Build ASR server binary (reuse existing if available)
if [ -f "dist/$ASR_BINARY_NAME" ]; then
    print_warning "ASR binary already exists, skipping rebuild"
    print_status "To force rebuild, delete dist/$ASR_BINARY_NAME"
else
    print_status "Building ASR server binary..."
    
    # Create Python virtual environment for clean build
    if [ ! -d "build-venv" ]; then
        print_status "Creating Python virtual environment..."
        python3 -m venv build-venv
    fi
    
    # Activate virtual environment
    source build-venv/bin/activate
    
    # Build the ASR binary
    python3 build-asr-binary.py
    
    if [ ! -f "dist/$ASR_BINARY_NAME" ]; then
        print_error "ASR binary not found after build"
        exit 1
    fi
    
    print_success "ASR server binary built: dist/$ASR_BINARY_NAME"
    deactivate
fi

# Step 4: Clean up any existing models to ensure they're not bundled
print_status "Ensuring models directory is excluded from build..."
if [ -d "models" ]; then
    print_warning "Found models directory with $(du -sh models | cut -f1) of data"
    print_warning "Models will be excluded from build (downloaded on first run)"
fi

# Step 5: Create optimized build configuration
print_status "Creating optimized build configuration..."

cat > electron-builder-config.js << EOF
const config = {
  appId: "com.yourcompany.insighto",
  productName: "Insighto",
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
    "!*.exe",
    "!*.log",
    "!BUILD_*.md",
    "!AUDIO_*.md"
  ],
  mac: {
    icon: "app-icon.icns",
    category: "public.app-category.productivity",
    entitlements: "entitlements.mas.plist",
    entitlementsInherit: "entitlements.mas.plist",
    target: [
      {
        target: "dmg",
        arch: ["x64", "arm64"]
      },
      {
        target: "mas",
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

print_success "Optimized build configuration created"

# Step 6: Build Electron app
print_status "Building Electron application (optimized)..."

# Use the custom config
npx electron-builder --config electron-builder-config.js

if [ $? -eq 0 ]; then
    print_success "Electron app built successfully!"
    
    # Show output location and sizes
    if [ -d "dist-app" ]; then
        print_status "Build artifacts:"
        ls -la dist-app/
        
        # Show size comparison
        echo ""
        print_status "📊 Size Analysis:"
        if [ -f "dist-app/Insighto-1.0.0.dmg" ]; then
            DMG_SIZE=$(du -sh dist-app/Insighto-1.0.0.dmg | cut -f1)
            print_success "Intel DMG size: $DMG_SIZE"
        fi
        if [ -f "dist-app/Insighto-1.0.0-arm64.dmg" ]; then
            ARM_SIZE=$(du -sh dist-app/Insighto-1.0.0-arm64.dmg | cut -f1)
            print_success "Apple Silicon DMG size: $ARM_SIZE"
        fi
        
        # Check app bundle size
        if [ -d "dist-app/mac/Insighto.app" ]; then
            APP_SIZE=$(du -sh dist-app/mac/Insighto.app | cut -f1)
            print_success "App bundle size: $APP_SIZE"
        fi
    fi
    
    echo ""
    print_success "🎉 Optimized build completed successfully!"
    echo ""
    print_status "✅ LLM models excluded - will download on first run"
    print_status "✅ ASR server binary included for offline transcription"
    print_status "✅ Much smaller distribution size"
    echo ""
    print_status "The optimized app will:"
    print_status "• Download LLM models on first launch (user choice of size)"
    print_status "• Work offline for transcription (ASR binary included)"
    print_status "• Have significantly smaller download size"
    
else
    print_error "Electron app build failed"
    exit 1
fi

# Cleanup
print_status "Cleaning up temporary files..."
rm -f electron-builder-config.js

print_success "Optimized build process completed!"