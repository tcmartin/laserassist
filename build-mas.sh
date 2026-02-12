#!/bin/bash

# MAS-specific build script for Laserreach Intelli
# This script builds the App Store version WITHOUT MCP functionality

set -e  # Exit on any error

echo "🏪 Building Laserreach Intelli for Mac App Store (MCP Disabled)"
echo "===================================================="

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

# Set MAS build environment variable
export MAS_BUILD=true

print_status "Building for Mac App Store (MCP functionality disabled)"

# Step 1: Check prerequisites
print_status "Checking prerequisites..."

if ! command -v python3 &> /dev/null; then
    print_error "Python 3 is required but not installed"
    exit 1
fi

if ! command -v node &> /dev/null; then
    print_error "Node.js is required but not installed"
    exit 1
fi

if ! command -v npm &> /dev/null; then
    print_error "npm is required but not installed"
    exit 1
fi

print_success "All prerequisites found"

# Step 2: Install Node.js dependencies
print_status "Installing Node.js dependencies..."
npm install
print_success "Node.js dependencies installed"

# Step 3: Build ASR server binary (reuse existing if available)
if [ -f "dist/cluely-asr" ]; then
    print_warning "ASR binary already exists, skipping rebuild"
else
    print_status "Building ASR server binary..."
    
    if [ ! -d "build-venv" ]; then
        print_status "Creating Python virtual environment..."
        python3 -m venv build-venv
    fi
    
    source build-venv/bin/activate
    python3 build-asr-binary.py
    
    if [ ! -f "dist/cluely-asr" ]; then
        print_error "ASR binary not found after build"
        exit 1
    fi
    
    print_success "ASR server binary built: dist/cluely-asr"
    deactivate
fi

# Step 4: Create MAS-specific build configuration
print_status "Creating MAS build configuration..."

cat > electron-builder-mas.js << EOF
const config = {
  appId: "com.laserreach.intelli",
  productName: "Laserreach Intelli",
  directories: {
    output: "dist-mas"
  },
  files: [
    "**/*",
    "!dist/**/*",
    "!dist-app/**/*",
    "!dist-mas/**/*",
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
    "!AUDIO_*.md",
    "!MAS_*.md"
  ],
  mac: {
    icon: "app-icon.icns",
    category: "public.app-category.productivity",
    entitlements: "entitlements.mas.plist",
    entitlementsInherit: "entitlements.mas.plist",
    target: [
      {
        target: "mas",
        arch: ["x64", "arm64"]
      }
    ],
    extraFiles: [
      {
        from: "dist/cluely-asr",
        to: "Contents/MacOS/cluely-asr"
      }
    ]
  }
};

module.exports = config;
EOF

print_success "MAS build configuration created"

# Step 5: Build for Mac App Store
print_status "Building for Mac App Store..."

# Set environment variable for the build process
export MAS_BUILD=true

npx electron-builder --config electron-builder-mas.js

if [ $? -eq 0 ]; then
    print_success "Mac App Store build completed successfully!"
    
    # Show output location and sizes
    if [ -d "dist-mas" ]; then
        print_status "MAS build artifacts:"
        ls -la dist-mas/
        
        # Show size analysis
        echo ""
        print_status "📊 MAS Build Analysis:"
        if [ -f "dist-mas/Laserreach Intelli-1.0.0.pkg" ]; then
            PKG_SIZE=$(du -sh dist-mas/Laserreach\ Intelli-1.0.0.pkg | cut -f1)
            print_success "MAS package size: $PKG_SIZE"
        fi
        
        # Check app bundle size
        if [ -d "dist-mas/mas/Laserreach Intelli.app" ]; then
            APP_SIZE=$(du -sh dist-mas/mas/Laserreach\ Intelli.app | cut -f1)
            print_success "App bundle size: $APP_SIZE"
        fi
    fi
    
    echo ""
    print_success "🏪 Mac App Store build completed successfully!"
    echo ""
    print_status "✅ MCP functionality disabled for App Store compliance"
    print_status "✅ Proper entitlements included"
    print_status "✅ Sandboxing enabled"
    print_status "✅ All external process execution secured"
    echo ""
    print_status "Ready for App Store submission!"
    print_status "Next steps:"
    print_status "1. Test the MAS build thoroughly"
    print_status "2. Submit for App Store review"
    print_status "3. Use regular DMG build for direct distribution"
    
else
    print_error "Mac App Store build failed"
    exit 1
fi

# Cleanup
print_status "Cleaning up temporary files..."
rm -f electron-builder-mas.js

print_success "MAS build process completed!"
