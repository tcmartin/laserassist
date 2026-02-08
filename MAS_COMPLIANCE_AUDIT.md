# Mac App Store Compliance Audit

## 🔍 **Comprehensive MAS Compliance Review**

### ✅ **COMPLIANT AREAS**

#### **1. Network Server Entitlements**
- **Status**: ✅ **COMPLIANT**
- **Finding**: ASR server uses `stdio` mode only, no WebSocket server
- **Evidence**: All ASR bridge calls use `--mode stdio`
- **Risk**: None - no `com.apple.security.network.server` entitlement needed

#### **2. App Size Requirements**
- **Status**: ✅ **COMPLIANT** 
- **Current Size**: 1.1GB DMG (optimized build)
- **MAS Limit**: 4GB
- **Compliance**: 27% of limit used
- **Models**: Downloaded on first run (not bundled)

#### **3. Sandboxing Compatibility**
- **Status**: ✅ **COMPLIANT**
- **File Access**: Uses `app.getPath('userData')` for all data storage
- **Session Storage**: Contained within app sandbox
- **Cache Management**: Uses proper app support directories

#### **4. Code Signing**
- **Status**: ✅ **READY**
- **Current**: Development signing working
- **Next Step**: Add distribution certificates for MAS

---

### ⚠️ **AREAS REQUIRING ATTENTION**

#### **1. Missing Entitlements File**
- **Status**: ⚠️ **NEEDS CREATION**
- **Issue**: No explicit entitlements.plist file
- **Required Entitlements**:
  - `com.apple.security.microphone` (for audio recording)
  - `com.apple.security.network.client` (for model downloads)
  - `com.apple.security.files.user-selected.read-write` (optional)

#### **2. Child Process Execution**
- **Status**: ⚠️ **REVIEW NEEDED**
- **Finding**: App spawns ASR server binary as child process
- **Files**: `asr-bridge.js`, `mcp-manager.js`
- **Risk**: May need `com.apple.security.cs.allow-unsigned-executable-memory`
- **Mitigation**: ASR binary is signed with same certificate

#### **3. Network Client Usage**
- **Status**: ⚠️ **NEEDS ENTITLEMENT**
- **Finding**: Downloads LLM models from HuggingFace
- **URLs**: `https://huggingface.co/unsloth/...`
- **Required**: `com.apple.security.network.client`

---

### 🚨 **POTENTIAL ISSUES**

#### **1. MCP Server Execution**
- **Status**: 🚨 **HIGH RISK**
- **Issue**: MCP manager spawns external processes (`uvx`, Python scripts)
- **Problem**: External executables may not be signed
- **Solution**: Either remove MCP or ensure all MCP servers are signed

#### **2. Python Binary Execution**
- **Status**: 🚨 **MEDIUM RISK**
- **Issue**: Falls back to system Python in development
- **Problem**: System Python not signed by developer
- **Solution**: Always use bundled ASR binary in production

---

### 📋 **REQUIRED ACTIONS FOR MAS SUBMISSION**

#### **1. Create Entitlements File**
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <!-- Enable App Sandbox -->
    <key>com.apple.security.app-sandbox</key>
    <true/>
    
    <!-- Microphone access for audio recording -->
    <key>com.apple.security.microphone</key>
    <true/>
    
    <!-- Network client for model downloads -->
    <key>com.apple.security.network.client</key>
    <true/>
    
    <!-- Allow child processes (for ASR binary) -->
    <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
    <true/>
    
    <!-- File access within container -->
    <key>com.apple.security.files.user-selected.read-write</key>
    <true/>
</dict>
</plist>
```

#### **2. Update Build Configuration**
- Add entitlements to electron-builder config
- Ensure ASR binary is properly signed
- Remove or secure MCP functionality

#### **3. Privacy Policy Requirements**
- **Microphone Usage**: "This app uses the microphone to transcribe your speech"
- **Network Usage**: "This app downloads AI models for offline use"
- **Data Storage**: "Transcripts are stored locally on your device"

---

### 🔧 **RECOMMENDED FIXES**

#### **Fix 1: Create Entitlements File**
```bash
# Create entitlements file
cat > entitlements.mas.plist << 'EOF'
[entitlements content above]
EOF
```

#### **Fix 2: Update Build Config**
```javascript
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
  ]
}
```

#### **Fix 3: Secure MCP (Optional)**
```javascript
// Disable MCP for MAS build
const isMASBuild = process.env.MAS_BUILD === 'true';
if (!isMASBuild) {
  // Initialize MCP only for non-MAS builds
  mcpManager = new MCPManager(mcpConfigManager);
}
```

---

### 📊 **COMPLIANCE SCORECARD**

| Category | Status | Score |
|----------|--------|-------|
| App Size | ✅ Compliant | 10/10 |
| Sandboxing | ✅ Ready | 9/10 |
| Network Server | ✅ Compliant | 10/10 |
| Code Signing | ⚠️ Needs Certs | 7/10 |
| Entitlements | ⚠️ Missing File | 6/10 |
| Child Processes | 🚨 Review Needed | 5/10 |
| MCP Security | 🚨 High Risk | 3/10 |

**Overall Score**: 7.1/10 (Good, needs fixes)

---

### 🎯 **PRIORITY ACTIONS**

1. **HIGH**: Create entitlements.plist file
2. **HIGH**: Update build config for MAS target
3. **MEDIUM**: Review MCP security implications
4. **MEDIUM**: Add privacy policy text
5. **LOW**: Get distribution certificates

---

### 📝 **NOTES**

- **Native-core**: Correctly excluded from builds (not part of this project)
- **Models Directory**: Properly excluded from builds
- **Development vs Production**: Clear separation maintained
- **File Permissions**: All within sandbox boundaries

The app is **mostly MAS-ready** but needs entitlements file and MCP security review before submission.