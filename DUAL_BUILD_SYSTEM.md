# Dual Build System: MAS vs Regular Distribution

## 🎯 **Overview**

The project now supports two distinct build targets:
1. **Mac App Store (MAS)** - Compliant, secure, no MCP
2. **Regular DMG** - Full features, including MCP functionality

## 🏗️ **Build Commands**

### **Mac App Store Build**
```bash
npm run build-mas
# or
./build-mas.sh
```
- **Output**: `dist-mas/` directory
- **Features**: Core functionality only
- **MCP**: ❌ Disabled for security compliance
- **Target**: App Store submission

### **Regular DMG Build**
```bash
npm run build
# or
./build-optimized.sh
```
- **Output**: `dist-app/` directory  
- **Features**: Full functionality
- **MCP**: ✅ Enabled for power users
- **Target**: Direct distribution

## 🔄 **How It Works**

### **Environment Variable Control**
```javascript
const isMASBuild = process.env.MAS_BUILD === 'true';

if (!isMASBuild) {
  // Initialize MCP functionality
  const mcpManager = new MCPManager();
  // ... full MCP setup
} else {
  // MAS build - disable MCP
  console.log('MCP disabled for App Store version');
}
```

### **Conditional Compilation**
- **LLM Worker**: MCP imports and initialization are conditional
- **Main Process**: MCP IPC handlers provide stubs for MAS builds
- **UI**: Could show/hide MCP features based on build type

## 📊 **Feature Comparison**

| Feature | Regular DMG | Mac App Store |
|---------|-------------|---------------|
| **Core App** | ✅ Full | ✅ Full |
| **ASR Transcription** | ✅ Included | ✅ Included |
| **LLM Chat** | ✅ Full | ✅ Full |
| **Model Downloads** | ✅ Auto | ✅ Auto |
| **MCP Functions** | ✅ Enabled | ❌ Disabled |
| **External Tools** | ✅ uvx, Python | ❌ Blocked |
| **File Size** | ~1.1GB | ~1.1GB |
| **Security** | Standard | Sandboxed |

## 🔒 **Security Differences**

### **Regular DMG Build**
- Standard macOS security
- Can spawn external processes
- MCP servers run as child processes
- Full network client access

### **Mac App Store Build**
- App Sandbox enabled
- Restricted process execution
- No external executable spawning
- Limited network access (model downloads only)

## 🛠️ **Technical Implementation**

### **1. Environment Detection**
```bash
# MAS build
export MAS_BUILD=true
./build-mas.sh

# Regular build  
export MAS_BUILD=false
./build-optimized.sh
```

### **2. Conditional Module Loading**
```javascript
// Only load MCP modules for non-MAS builds
if (!isMASBuild) {
  const MCPManager = require('./mcp-manager');
  const MCPConfigManager = require('./mcp-config-manager');
  // ... initialize MCP
}
```

### **3. Stub Handlers for MAS**
```javascript
// Provide "not available" responses for MCP functions in MAS
ipcMain.handle('mcp-get-config', async () => {
  return { 
    success: false, 
    error: 'MCP functionality not available in App Store version' 
  };
});
```

## 📦 **Build Artifacts**

### **Regular Build** (`dist-app/`)
```
dist-app/
├── Insighto-1.0.0.dmg           # Intel DMG
├── Insighto-1.0.0-arm64.dmg     # Apple Silicon DMG
├── mac/Insighto.app             # Intel app bundle
└── mac-arm64/Insighto.app       # Apple Silicon app bundle
```

### **MAS Build** (`dist-mas/`)
```
dist-mas/
├── Insighto-1.0.0.pkg           # MAS installer package
├── mas/Insighto.app             # Intel MAS app
└── mas-arm64/Insighto.app       # Apple Silicon MAS app
```

## 🎯 **Distribution Strategy**

### **For End Users**
1. **Power Users**: Download regular DMG for full MCP functionality
2. **General Users**: Get from Mac App Store for security/convenience
3. **Enterprise**: Use regular DMG for custom MCP integrations

### **For Developers**
1. **Development**: Use `npm start` (full features)
2. **Testing MAS**: Use `npm run build-mas` 
3. **Testing Regular**: Use `npm run build`
4. **CI/CD**: Build both versions automatically

## ⚠️ **Important Notes**

### **MCP Security Implications**
- **Regular builds** can execute external tools (uvx, Python scripts)
- **MAS builds** cannot spawn unsigned executables
- This is why MCP must be disabled for App Store compliance

### **User Experience**
- Both versions have identical core functionality
- MAS version shows "MCP not available" messages
- Regular version has full MCP integration

### **Maintenance**
- Single codebase with conditional compilation
- Environment variable controls feature availability
- No code duplication between builds

## 🚀 **Next Steps**

1. **Test both builds** thoroughly
2. **Submit MAS version** to App Store
3. **Distribute regular DMG** for power users
4. **Consider feature flags** in UI to show/hide MCP options

This dual-build approach gives you the best of both worlds: App Store compliance AND full functionality for direct distribution! 🎉