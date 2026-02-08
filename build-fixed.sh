#!/bin/bash

# Fixed build script for Insighto that handles ASAR packaging properly
# This script ensures all external files are properly accessible

set -e  # Exit on any error

echo "🚀 Building Insighto (ASAR-compatible)"
echo "====================================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

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

# Check platform
if [[ "$OSTYPE" == "darwin"* ]]; then
    PLATFORM="mac"
    ASR_BINARY_NAME="cluely-asr"
else
    print_error "This fixed build script is currently macOS-only"
    exit 1
fi

print_status "Building for platform: $PLATFORM"

# Step 1: Install dependencies
print_status "Installing Node.js dependencies..."
npm install
print_success "Dependencies installed"

# Step 2: Build ASR binary (if needed)
if [ ! -f "dist/$ASR_BINARY_NAME" ]; then
    print_status "Building ASR server binary..."
    python3 build-asr-binary.py
    print_success "ASR binary built"
fi

# Step 3: Create electron-builder config that handles ASAR properly
print_status "Creating ASAR-compatible build configuration..."

cat > electron-builder-fixed.js << 'EOF'
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
    "!requirements*.txt",
    "!*.sh",
    "!*.bat",
    "!test-*.js",
    "!.kiro/**/*",
    "!models/**/*",
    "!*.dmg",
    "!*.exe",
    "!electron-builder-*.js"
  ],
  // Unpack node-llama-cpp since it contains native binaries
  asarUnpack: [
    "node_modules/node-llama-cpp/**/*"
  ],
  mac: {
    icon: "app-icon.icns",
    category: "public.app-category.productivity",
    target: [
      {
        target: "dmg",
        arch: ["arm64"]
      }
    ],
    // Place ASR binary in MacOS directory where it can be executed
    extraFiles: [
      {
        from: "dist/cluely-asr",
        to: "Contents/MacOS/cluely-asr"
      }
    ]
  },
  // Ensure binary is executable after packaging
  afterPack: async (context) => {
    const fs = require('fs');
    const path = require('path');
    const binaryPath = path.join(context.appOutDir, 'Insighto.app/Contents/MacOS/cluely-asr');
    if (fs.existsSync(binaryPath)) {
      fs.chmodSync(binaryPath, 0o755);
      console.log('✅ Made ASR binary executable');
    }
  }
};

module.exports = config;
EOF

print_success "Build configuration created"

# Step 4: Build the app
print_status "Building Electron application..."
npx electron-builder --config electron-builder-fixed.js

if [ $? -eq 0 ]; then
    print_success "Build completed successfully!"
    
    # Verify the build
    if [ -d "dist-app/mac-arm64/Insighto.app" ]; then
        print_status "Verifying build structure..."
        
        APP_PATH="dist-app/mac-arm64/Insighto.app"
        
        # Check if ASR binary is in the right place
        if [ -f "$APP_PATH/Contents/MacOS/cluely-asr" ]; then
            print_success "✓ ASR binary found in MacOS directory"
        else
            print_warning "⚠ ASR binary not found in MacOS directory"
        fi
        
        # Check if ASR binary is properly placed
        if [ -f "$APP_PATH/Contents/MacOS/cluely-asr" ]; then
            print_success "✓ ASR binary found in MacOS directory"
            # Test if binary is executable
            if [ -x "$APP_PATH/Contents/MacOS/cluely-asr" ]; then
                print_success "✓ ASR binary is executable"
            else
                print_warning "⚠ ASR binary is not executable"
            fi
        else
            print_warning "⚠ ASR binary not found in MacOS directory"
        fi
        
        print_status "Build artifacts:"
        ls -la dist-app/
    fi
    
    echo ""
    print_success "🎉 ASAR-compatible build completed!"
    echo ""
    print_status "Key fixes applied:"
    echo "  • Compiled ASR binary included (no Python dependencies needed)"
    echo "  • ASR binary placed in executable location"
    echo "  • Models directory will be created in userData"
    echo "  • ASAR packaging optimized for performance"
    echo ""
    
else
    print_error "Build failed"
    exit 1
fi

# Cleanup
rm -f electron-builder-fixed.js

print_success "Build process completed!"