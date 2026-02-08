const { app, BrowserWindow, ipcMain, session, globalShortcut } = require('electron');
const path = require('path');
const { Worker } = require('worker_threads');
const modelDownloader = require('./model-downloader');
const os = require('os');
const ASRBridge = require('./asr-bridge');
const SessionStorageManager = require('./session-storage');
const LicenseManager = require('./license-manager');
const fs = require('fs');

let llmWorker;
let audioWorker;
let selectedLLMModel;
let sessionStorage;
let licenseManager;
let licenseBypass = false;
let mainWindow;
let asrBridge;
let _asrChunkCount = 0;
let _asrSrcRate = 16000; // renderer input sample rate
let _resamplePhase = 0;  // fractional source position within next chunk
let _resampleStep = 1;   // src/dst ratio

function resampleTo16k(f32) {
  if (!_asrSrcRate || _asrSrcRate === 16000) return f32;
  const step = _resampleStep || (_asrSrcRate / 16000);
  if (!isFinite(step) || step <= 0) return f32;

  const src = f32;
  const srcLen = src.length;
  // How many output samples can we produce from this chunk, given current phase
  const outLen = Math.floor((srcLen - _resamplePhase) / step);
  if (outLen <= 0) {
    // Not enough data yet; advance phase and return empty
    _resamplePhase += srcLen;
    return new Float32Array(0);
  }
  const out = new Float32Array(outLen);
  let pos = _resamplePhase;
  for (let i = 0; i < outLen; i++) {
    const i0 = Math.floor(pos);
    const frac = pos - i0;
    const i1 = i0 + 1;
    const s0 = i0 < srcLen ? src[i0] : 0;
    const s1 = i1 < srcLen ? src[i1] : s0;
    out[i] = s0 + (s1 - s0) * frac;
    pos += step;
  }
  // Update phase: position relative to start of next chunk
  _resamplePhase = pos - srcLen;
  if (_resamplePhase < 0) _resamplePhase = 0; // guard
  return out;
}

// Global shortcut functionality
function registerGlobalShortcut() {
  // Determine platform-specific shortcut
  const shortcut = process.platform === 'darwin' ? 'Cmd+Shift+Space' : 'Ctrl+Shift+Space';
  
  // Register the global shortcut
  const success = globalShortcut.register(shortcut, () => {
    toggleWindowVisibility();
  });
  
  if (success) {
    console.log(`✅ Global shortcut registered: ${shortcut}`);
  } else {
    console.log(`❌ Failed to register global shortcut: ${shortcut}`);
  }
}

function toggleWindowVisibility() {
  if (!mainWindow) return;
  
  if (mainWindow.isVisible()) {
    mainWindow.hide();
    console.log('🔽 Window hidden via global shortcut');
  } else {
    mainWindow.show();
    mainWindow.focus();
    console.log('🔼 Window shown via global shortcut');
  }
}

function detectPreferredTierFromSettingsOrHardware() {
  // Read override from user settings file if present
  try {
    const cfgPath = path.join(app.getPath('userData'), 'settings.json');
    if (fs.existsSync(cfgPath)) {
      const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      if (cfg && cfg.llmTierOverride && ['low','high','auto'].includes(cfg.llmTierOverride)) {
        if (cfg.llmTierOverride !== 'auto') return cfg.llmTierOverride;
      }
    }
  } catch (e) { /* ignore */ }
  return modelDownloader.detectHardwareTier();
}

function createOverlay() {
  // Determine icon path with fallbacks
  const fs = require('fs');
  let iconPath;
  
  if (process.platform === 'darwin') {
    // Try PNG first as it's more reliable for BrowserWindow
    const pngPath = path.join(__dirname, 'icons', 'icon-256.png');
    const icnsPath = path.join(__dirname, 'app-icon.icns');
    
    if (fs.existsSync(pngPath)) {
      iconPath = pngPath;
    } else if (fs.existsSync(icnsPath)) {
      iconPath = icnsPath;
      console.log('⚠️  Using ICNS fallback icon');
    }
  } else {
    const pngPath = path.join(__dirname, 'icons', 'icon-256.png');
    if (fs.existsSync(pngPath)) {
      iconPath = pngPath;
    }
  }

  const windowOptions = {
    width: 600, // Much larger width for the new panel layout
    height: 800, // Much larger height to accommodate all panels
    contentProtection: true,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: false, // Allow app to appear in dock to show icon
    resizable: true, // Allow resizing for better user control
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  };

  // Only add icon if we found a valid one
  if (iconPath) {
    windowOptions.icon = iconPath;
    console.log('✅ Using icon:', iconPath);
  } else {
    console.log('⚠️  No icon found, using default');
  }

  const win = new BrowserWindow(windowOptions);
  mainWindow = win; // Store reference for global shortcut

  win.loadFile(path.join(__dirname, 'index.html'));
  win.once('ready-to-show', () => {
    win.show();
    win.webContents.openDevTools({ mode: 'detach' });
    
    // Register global shortcut for show/hide toggle
    registerGlobalShortcut();
    
    // Initialize session storage under app's userData (App Store-friendly)
    try {
      const baseDir = app.getPath('userData');
      sessionStorage = new SessionStorageManager(baseDir);
      console.log('✅ Session storage initialized at', path.join(baseDir, 'sessions'));
    } catch (e) {
      console.error('❌ Failed to initialize session storage', e);
    }

    // Hook ASR bridge events to renderer (bridge already started early)
    try {
      asrBridge = asrBridge || new ASRBridge(app, console);
      // Forward ASR events to renderer
      asrBridge.on('partial', (msg) => {
        win.webContents.send('asr-message', msg);
      });
      asrBridge.on('final', (msg) => {
        win.webContents.send('asr-message', msg);
      });
      asrBridge.on('error', (msg) => {
        win.webContents.send('asr-message', { op: 'error', ...msg });
      });
      asrBridge.on('status', (msg) => {
        win.webContents.send('asr-message', { op: 'status', ...msg });
      });
      console.log('✅ ASR bridge ready');
      win.webContents.send('asr-message', { op: 'status', message: 'External ASR starting…\n' });
    } catch (e) {
      console.error('❌ Failed to initialize ASR bridge', e);
    }

    // Initialize license manager
    try {
      const baseDir = app.getPath('userData');
      licenseManager = new LicenseManager(baseDir);
      licenseManager.load();
      // Env flag to bypass license checks during testing
      licenseBypass = process.env.INSIGHTO_LICENSE_BYPASS === '1' || process.env.INSIGHTO_LICENSE_BYPASS === 'true';
      if (licenseBypass) {
        console.log('⚠️ License checks bypassed (INSIGHTO_LICENSE_BYPASS).');
      }
      console.log('✅ License manager ready');
    } catch (e) {
      console.error('❌ Failed to initialize license manager', e);
    }

    // Select LLM tier and model
    const preferredTier = detectPreferredTierFromSettingsOrHardware();
    selectedLLMModel = modelDownloader.getModelInfo(preferredTier);

    // Check if selected model exists and download if needed
    if (!modelDownloader.modelExists(preferredTier)) {
      win.webContents.send('model-status', {
        state: 'checking',
        message: `Checking for LLM model (${selectedLLMModel.name})...`,
        tier: selectedLLMModel.tier,
        filename: selectedLLMModel.filename
      });
      
      // Start download process
      modelDownloader.downloadModel(preferredTier)
        .then(() => {
          win.webContents.send('model-status', {
            state: 'loading',
            message: `Model downloaded, initializing LLM (${selectedLLMModel.name})...`,
            tier: selectedLLMModel.tier
          });
          startLLMWorker(selectedLLMModel.filename);
        })
        .catch(err => {
          win.webContents.send('model-status', {
            state: 'error',
            message: `Failed to download model: ${err.message}`
          });
          console.error('Model download failed:', err);
        });
    } else {
      win.webContents.send('model-status', {
        state: 'loading',
        message: `Model found, initializing LLM (${selectedLLMModel.name})...`,
        tier: selectedLLMModel.tier
      });
      startLLMWorker(selectedLLMModel.filename);
    }

    // Native transcriber disabled: external Python ASR is the single source of transcription
  });

  // Handle manual download request from UI
  ipcMain.on('download-model', () => {
    const preferredTier = detectPreferredTierFromSettingsOrHardware();
    selectedLLMModel = modelDownloader.getModelInfo(preferredTier);
    modelDownloader.downloadModel(preferredTier)
      .then(() => {
        win.webContents.send('model-status', {
          state: 'loading',
          message: `Model downloaded, initializing LLM (${selectedLLMModel.name})...`,
          tier: selectedLLMModel.tier
        });
        startLLMWorker(selectedLLMModel.filename);
      })
      .catch(err => {
        win.webContents.send('model-status', {
          state: 'error',
          message: `Failed to download model: ${err.message}`
        });
        console.error('Model download failed:', err);
      });
  });

  // ASR IPC handlers (single registration)
  ipcMain.on('asr-start', (_e, opts) => {
    try {
      _asrSrcRate = Math.max(8000, Math.min(192000, Number(opts?.sampleRate) || 16000));
      _resampleStep = _asrSrcRate / 16000;
      _resamplePhase = 0;
      const startOpts = {
        sampleRate: 16000,
        window: opts?.window || 5,
        updateMs: opts?.updateMs || 5000,
      };
      if (opts?.source) startOpts.source = opts.source;
      if (typeof opts?.device_index !== 'undefined') startOpts.device_index = opts.device_index;
      if (asrBridge && asrBridge.isRunning()) {
        asrBridge.setConfig(startOpts);
      } else {
        asrBridge = asrBridge || new ASRBridge(app, console);
        asrBridge.start(startOpts);
      }
    } catch (err) {
      console.error('ASR start failed', err);
      if (mainWindow) {
        mainWindow.webContents.send('asr-message', { op: 'error', message: err.message });
      }
    }
  });

  // Do not stop the helper on UI stop; just stop sending audio.
  ipcMain.on('asr-stop', () => {
    console.log('[ASR] UI requested stop streaming (helper kept running)');
  });

  // Handle LLM prompts (existing chat functionality with transcript context)
  ipcMain.on('llm-prompt', (_e, payload) => {
    if (llmWorker) {
      // Ensure backward compatibility by setting type to 'chat' if not specified
      const message = { type: 'chat', ...payload };
      llmWorker.postMessage(message);
    } else {
      BrowserWindow.getAllWindows().forEach(w => w.webContents.send('llm-response', { 
        id: payload.id, 
        error: 'LLM not initialized. Please wait for model to load or download.'
      }));
    }
  });

  // Handle transcript context requests for chat
  ipcMain.on('llm-chat-with-context', (_e, payload) => {
    if (llmWorker) {
      const message = { type: 'chat', ...payload };
      llmWorker.postMessage(message);
    } else {
      BrowserWindow.getAllWindows().forEach(w => w.webContents.send('llm-response', { 
        id: payload.id, 
        error: 'LLM not initialized. Please wait for model to load or download.'
      }));
    }
  });

  // Handle analysis requests (new functionality)
  ipcMain.on('llm-analyze', (_e, payload) => {
    if (llmWorker) {
      const message = { type: 'analyze-transcript', ...payload };
      llmWorker.postMessage(message);
    } else {
      BrowserWindow.getAllWindows().forEach(w => w.webContents.send('llm-analysis-response', { 
        id: payload.id, 
        type: 'analysis-error',
        error: 'LLM not initialized. Please wait for model to load or download.'
      }));
    }
  });

  // MCP Configuration IPC handlers (disabled for MAS builds)
  const isMASBuild = process.env.MAS_BUILD === 'true';
  
  if (!isMASBuild) {
    const MCPConfigManager = require('./mcp-config-manager');
    const mcpConfigManager = new MCPConfigManager('.insighto/settings/mcp.json');

    // Get MCP configuration
    ipcMain.handle('mcp-get-config', async () => {
      try {
        const config = await mcpConfigManager.loadConfig();
        return { success: true, config };
      } catch (error) {
        console.error('Failed to get MCP config:', error);
        return { success: false, error: error.message };
      }
    });

    // Update MCP server
    ipcMain.handle('mcp-update-server', async (_e, serverId, serverConfig) => {
      try {
        await mcpConfigManager.updateServer(serverId, serverConfig);
        return { success: true };
      } catch (error) {
        console.error('Failed to update MCP server:', error);
        return { success: false, error: error.message };
      }
    });

    // Remove MCP server
    ipcMain.handle('mcp-remove-server', async (_e, serverId) => {
      try {
        await mcpConfigManager.removeServer(serverId);
        return { success: true };
      } catch (error) {
        console.error('Failed to remove MCP server:', error);
        return { success: false, error: error.message };
      }
    });

    // Test MCP connection
    ipcMain.handle('mcp-test-connection', async (_e, serverId, testConfig) => {
      try {
        // For now, we'll do a basic validation test
        // In a full implementation, this would actually try to connect to the MCP server
        const config = testConfig || mcpConfigManager.getConfig()?.mcpServers?.[serverId];
        
        if (!config) {
          return { success: false, error: 'Server configuration not found' };
        }

        const validation = mcpConfigManager.validateServerConfig(config);
        if (!validation.success) {
          return { success: false, error: validation.errors.join(', ') };
        }

        // Simulate a successful connection test
        // In a real implementation, this would use the MCP manager to test the connection
        return { 
          success: true, 
          toolCount: Math.floor(Math.random() * 10) + 1, // Simulate random tool count
          message: 'Connection test successful (simulated)' 
        };
      } catch (error) {
        console.error('Failed to test MCP connection:', error);
        return { success: false, error: error.message };
      }
    });
  } else {
    // MAS build - provide stub handlers that return "not available"
    ipcMain.handle('mcp-get-config', async () => {
      return { success: false, error: 'MCP functionality not available in App Store version' };
    });

    ipcMain.handle('mcp-update-server', async () => {
      return { success: false, error: 'MCP functionality not available in App Store version' };
    });

    ipcMain.handle('mcp-remove-server', async () => {
      return { success: false, error: 'MCP functionality not available in App Store version' };
    });

    ipcMain.handle('mcp-test-connection', async () => {
      return { success: false, error: 'MCP functionality not available in App Store version' };
    });
  }

  // Session persistence IPC handlers
  ipcMain.on('session-start', async (_e, { sessionId, metadata }) => {
    try {
      if (!sessionStorage) return;
      const augmented = {
        appName: app.getName(),
        appVersion: app.getVersion(),
        llmModel: selectedLLMModel?.filename,
        ...metadata
      };
      await sessionStorage.startSession(sessionId, augmented);
    } catch (err) {
      console.error('Failed to start session', err);
    }
  });

  ipcMain.on('session-append-transcript', async (_e, { sessionId, segment }) => {
    try {
      if (!sessionStorage) return;
      await sessionStorage.appendTranscript(sessionId, segment || {});
    } catch (err) {
      console.error('Failed to append transcript', err);
    }
  });

  ipcMain.on('session-append-analysis', async (_e, { sessionId, entry }) => {
    try {
      if (!sessionStorage) return;
      await sessionStorage.appendAnalysis(sessionId, entry || {});
    } catch (err) {
      console.error('Failed to append analysis', err);
    }
  });

  ipcMain.on('session-end', async (_e, { sessionId, extra }) => {
    try {
      if (!sessionStorage) return;
      await sessionStorage.endSession(sessionId, extra || {});
    } catch (err) {
      console.error('Failed to end session', err);
    }
  });

  // Sessions viewer IPC handlers
  ipcMain.handle('sessions-list', async () => {
    try {
      if (!sessionStorage) return [];
      const baseDir = app.getPath('userData');
      const sessionsDir = path.join(baseDir, 'sessions');
      const fs = require('fs');
      const fsp = fs.promises;
      const entries = await fsp.readdir(sessionsDir, { withFileTypes: true });
      const dirs = entries.filter(e => e.isDirectory()).map(e => e.name);
      const results = [];
      for (const dir of dirs) {
        const metaPath = path.join(sessionsDir, dir, 'metadata.json');
        let meta = { id: dir };
        try {
          meta = JSON.parse(await fsp.readFile(metaPath, 'utf8'));
        } catch (_) {}
        results.push({
          id: dir,
          createdAt: meta.createdAt || meta.startedAt || null,
          endedAt: meta.endedAt || null,
          model: meta.whisperModel || null,
          llmModel: meta.llmModel || null
        });
      }
      // Sort by createdAt desc
      results.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
      return results;
    } catch (err) {
      console.error('Failed to list sessions', err);
      return [];
    }
  });

  ipcMain.handle('session-get', async (_e, sessionId) => {
    try {
      if (!sessionStorage) return null;
      const baseDir = app.getPath('userData');
      const dir = path.join(baseDir, 'sessions', sessionId);
      const fs = require('fs');
      const fsp = fs.promises;
      const readJsonLines = async (file) => {
        try {
          const data = await fsp.readFile(path.join(dir, file), 'utf8');
          return data.split('\n').filter(Boolean).map(line => {
            try { return JSON.parse(line); } catch { return null; }
          }).filter(Boolean);
        } catch {
          return [];
        }
      };
      const metadata = JSON.parse(await fsp.readFile(path.join(dir, 'metadata.json'), 'utf8'));
      const transcript = await readJsonLines('transcript.ndjson');
      const analysis = await readJsonLines('analysis.ndjson');
      return { metadata, transcript, analysis };
    } catch (err) {
      console.error('Failed to read session', err);
      return null;
    }
  });

  // License IPC handlers
  ipcMain.handle('license-get-status', async () => {
    try {
      const base = licenseManager?.getStatus() || { key: null, valid: false, tier: 'free' };
      if (licenseBypass) return { ...base, valid: true, tier: 'pro', bypass: true };
      return base;
    }
    catch (e) { return { key: null, valid: false, tier: 'free', error: e.message }; }
  });
  ipcMain.handle('license-set-key', async (_e, key) => {
    try { return licenseManager?.setKey(key) || { success: false, error: 'not ready' }; }
    catch (e) { return { success: false, error: e.message }; }
  });
  ipcMain.handle('license-clear', async () => {
    try { return licenseManager?.clear() || { key: null, valid: false, tier: 'free' }; }
    catch (e) { return { key: null, valid: false, tier: 'free', error: e.message }; }
  });

  // LLM tier override IPC handlers
  ipcMain.handle('llm-get-tier-override', async () => {
    try {
      const cfgPath = path.join(app.getPath('userData'), 'settings.json');
      if (fs.existsSync(cfgPath)) {
        const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
        return { tier: cfg.llmTierOverride || 'auto' };
      }
      return { tier: 'auto' };
    } catch (e) { return { tier: 'auto', error: e.message }; }
  });
  ipcMain.handle('llm-set-tier-override', async (_e, tier) => {
    try {
      const allowed = ['auto','low','high'];
      if (!allowed.includes(tier)) return { success: false, error: 'invalid tier' };
      const cfgPath = path.join(app.getPath('userData'), 'settings.json');
      let cfg = {};
      if (fs.existsSync(cfgPath)) {
        try { cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8')); } catch (_) {}
      }
      cfg.llmTierOverride = tier;
      fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
      return { success: true };
    } catch (e) { return { success: false, error: e.message }; }
  });

  // Sessions search (full-text), Pro-gated unless bypass enabled
  ipcMain.handle('sessions-search', async (_e, query, opts) => {
    try {
      const lic = licenseManager?.getStatus();
      if (!(licenseBypass || (lic && lic.valid))) {
        return { success: false, error: 'Pro required for search' };
      }

      const limit = Math.max(1, Math.min(200, opts?.limit || 100));
      const caseSensitive = !!opts?.caseSensitive;
      const baseDir = app.getPath('userData');
      const sessionsDir = path.join(baseDir, 'sessions');
      const entries = await (await fs.promises.readdir(sessionsDir, { withFileTypes: true })).filter(e => e.isDirectory());
      const q = caseSensitive ? query : (query || '').toLowerCase();
      const results = [];
      for (const ent of entries) {
        const id = ent.name;
        const transPath = path.join(sessionsDir, id, 'transcript.ndjson');
        if (!fs.existsSync(transPath)) continue;
        const data = await fs.promises.readFile(transPath, 'utf8');
        const lines = data.split('\n').filter(Boolean);
        for (const line of lines) {
          try {
            const obj = JSON.parse(line);
            const text = String(obj.text || '');
            const hay = caseSensitive ? text : text.toLowerCase();
            if (hay.includes(q)) {
              results.push({ sessionId: id, ts: obj.ts || null, text });
              if (results.length >= limit) break;
            }
          } catch (_) {}
        }
        if (results.length >= limit) break;
      }
      return { success: true, results };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });
}

// Start the LLM worker
function startLLMWorker(modelFileName) {
  if (llmWorker) {
    llmWorker.terminate();
  }
  
  llmWorker = new Worker(path.join(__dirname, 'llm-worker.js'), {
    workerData: { 
      modelFileName,
      userDataPath: app.isPackaged ? app.getPath('userData') : null
    }
  });
  
  llmWorker.on('message', msg => {
    if (msg.type === 'status') {
      BrowserWindow.getAllWindows().forEach(w => w.webContents.send('llm-status', msg));
    } else if (msg.type === 'ready') {
      BrowserWindow.getAllWindows().forEach(w => w.webContents.send('model-status', {
        state: 'ready',
        message: 'LLM initialized and ready!'
      }));
      BrowserWindow.getAllWindows().forEach(w => w.webContents.send('llm-response', msg));
    } else if (msg.type === 'analysis-response' || msg.type === 'analysis-error' || msg.type === 'analysis-progress') {
      // Route analysis responses and progress to dedicated channel
      BrowserWindow.getAllWindows().forEach(w => w.webContents.send('llm-analysis-response', msg));
    } else if (msg.type === 'queue-status') {
      // Route queue status updates to UI for performance feedback
      BrowserWindow.getAllWindows().forEach(w => w.webContents.send('llm-queue-status', msg));
    } else if (msg.type === 'performance-warning') {
      // Route performance warnings to UI
      BrowserWindow.getAllWindows().forEach(w => w.webContents.send('llm-performance-warning', msg));
    } else {
      // Default to chat response channel for backward compatibility
      BrowserWindow.getAllWindows().forEach(w => w.webContents.send('llm-response', msg));
    }
  });
  
  llmWorker.on('error', err => {
    console.error('LLM worker error:', err);
    BrowserWindow.getAllWindows().forEach(w => w.webContents.send('model-status', {
      state: 'error',
      message: `LLM error: ${err.message}`
    }));
  });
}

app.whenReady().then(() => {
  // Ensure models directory exists in userData for packaged apps
  if (app.isPackaged) {
    const userDataModelsDir = path.join(app.getPath('userData'), 'models');
    if (!fs.existsSync(userDataModelsDir)) {
      try {
        fs.mkdirSync(userDataModelsDir, { recursive: true });
        console.log('✅ Models directory created in userData');
      } catch (e) {
        console.error('❌ Failed to create models directory:', e.message);
      }
    }
  }

  audioWorker = new Worker(path.join(__dirname, 'audio-worker.js'));
  audioWorker.on('message', (b64) => {
    if (asrBridge) {
      asrBridge.sendBase64(b64);
    }
  });

  ipcMain.on('asr-audio-f32', (_e, arrbuf) => {
    try {
      if (!audioWorker) return;
      
      // Use setImmediate to process audio in next tick, keeping main thread responsive
      setImmediate(() => {
        try {
          let f32;
          if (arrbuf instanceof ArrayBuffer) {
            f32 = new Float32Array(arrbuf);
          } else if (Buffer.isBuffer(arrbuf)) {
            const byteOffset = arrbuf.byteOffset || 0;
            const byteLength = arrbuf.byteLength || arrbuf.length;
            f32 = new Float32Array(arrbuf.buffer, byteOffset, Math.floor(byteLength / 4));
          } else if (arrbuf && arrbuf.buffer instanceof ArrayBuffer) {
            f32 = new Float32Array(arrbuf.buffer, arrbuf.byteOffset || 0, Math.floor((arrbuf.byteLength || arrbuf.length) / 4));
          } else {
            return;
          }
          
          // Resample to 16k if needed
          const src = resampleTo16k(f32);
          audioWorker.postMessage(src);
          
          // Light debug: log first chunk, then every 100th
          _asrChunkCount++;
          if (_asrChunkCount === 1 || _asrChunkCount % 100 === 0) {
            try {
              console.log(`[ASR] sent chunk #${_asrChunkCount}, samples=${src.length}`);
            } catch (e) {
              // Ignore EPIPE errors from console logging
            }
          }
        } catch (err) {
          console.error('ASR audio processing failed', err);
        }
      });
    } catch (err) {
      console.error('ASR audio send failed', err);
    }
  });

  // Removed duplicate asr-start/asr-stop handlers (above is the single source)
  // Early ASR start: create and start helper before window
  try {
    if (!asrBridge) {
      asrBridge = new ASRBridge(app, console);
      console.log('✅ ASR bridge created (early init)');
    }
    if (!asrBridge.isRunning()) {
      asrBridge.start({ sampleRate: 16000, window: 5, updateMs: 5000 });
      console.log('✅ External ASR starting (background)');
    }
  } catch (e) {
    console.error('❌ Early ASR init failed', e);
  }
  // Set the app name
  app.setName('Insighto');
  
  // Set app icon for dock and system with error handling
  if (process.platform === 'darwin') {
    try {
      const fs = require('fs');
      const icnsPath = path.join(__dirname, 'app-icon.icns');
      const pngPath = path.join(__dirname, 'icons', 'icon-512.png');
      
      // Try PNG first as it's more reliable
      if (fs.existsSync(pngPath)) {
        app.dock.setIcon(pngPath);
        console.log('✅ Dock icon set successfully (PNG)');
      } else if (fs.existsSync(icnsPath)) {
        app.dock.setIcon(icnsPath);
        console.log('✅ Dock icon set successfully (ICNS)');
      } else {
        console.log('⚠️  No icon files found, using default icon');
      }
    } catch (error) {
      console.log('⚠️  Failed to set dock icon:', error.message);
    }
  }
  
  // Inject COOP/COEP headers on file:// requests
  session.defaultSession.webRequest.onHeadersReceived(
    { urls: ['file://*/*'] },
    (details, callback) => {
      const h = details.responseHeaders;
      h['Cross-Origin-Opener-Policy']   = ['same-origin'];
      h['Cross-Origin-Embedder-Policy'] = ['require-corp'];
      callback({ responseHeaders: h });
    }
  );

  createOverlay();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createOverlay();
  });
});

app.on('window-all-closed', () => {
  if (llmWorker) {
    llmWorker.terminate();
  }
  if (audioWorker) {
    audioWorker.terminate();
  }
  try { asrBridge?.dispose(); } catch {}
  // Unregister all global shortcuts
  globalShortcut.unregisterAll();
  app.quit();
});

// Handle app termination
app.on('before-quit', () => {
  if (llmWorker) {
    llmWorker.terminate();
  }
  if (audioWorker) {
    audioWorker.terminate();
  }
  try { asrBridge?.dispose(); } catch {}
  // Unregister all global shortcuts
  globalShortcut.unregisterAll();
});
