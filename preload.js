const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  sendPrompt: (id, prompt, transcriptContext) => ipcRenderer.send('llm-prompt', { id, prompt, transcriptContext }),
  onResponse: callback => ipcRenderer.on('llm-response', (_e, msg) => callback(msg)),
  onStatus: callback => ipcRenderer.on('llm-status', (_e, msg) => callback(msg)),
  onModelStatus: callback => ipcRenderer.on('model-status', (_e, status) => callback(status)),
  downloadModel: () => ipcRenderer.send('download-model'),
  
  // Analysis-specific IPC methods
  sendAnalysisRequest: (request) => ipcRenderer.send('llm-analyze', request),
  onAnalysisResponse: callback => ipcRenderer.on('llm-analysis-response', (_e, msg) => callback({ data: msg })),
  onQueueStatus: callback => ipcRenderer.on('llm-queue-status', (_e, msg) => callback(msg)),
  onPerformanceWarning: callback => ipcRenderer.on('llm-performance-warning', (_e, msg) => callback(msg)),
  
  // MCP-specific IPC methods
  getMCPConfig: () => ipcRenderer.invoke('mcp-get-config'),
  updateMCPServer: (serverId, serverConfig) => ipcRenderer.invoke('mcp-update-server', serverId, serverConfig),
  removeMCPServer: (serverId) => ipcRenderer.invoke('mcp-remove-server', serverId),
  testMCPConnection: (serverId, testConfig) => ipcRenderer.invoke('mcp-test-connection', serverId, testConfig),
  onMCPToolCall: callback => ipcRenderer.on('mcp-tool-event', (_e, event) => callback(event)),

  // Session persistence APIs
  sessionStart: (sessionId, metadata) => ipcRenderer.send('session-start', { sessionId, metadata }),
  sessionAppendTranscript: (sessionId, segment) => ipcRenderer.send('session-append-transcript', { sessionId, segment }),
  sessionAppendAnalysis: (sessionId, entry) => ipcRenderer.send('session-append-analysis', { sessionId, entry }),
  sessionEnd: (sessionId, extra) => ipcRenderer.send('session-end', { sessionId, extra }),

  // Sessions viewer APIs
  listSessions: () => ipcRenderer.invoke('sessions-list'),
  getSession: (sessionId) => ipcRenderer.invoke('session-get', sessionId),
  searchSessions: (query, opts) => ipcRenderer.invoke('sessions-search', query, opts),

  // License APIs
  getLicenseStatus: () => ipcRenderer.invoke('license-get-status'),
  setLicenseKey: (key) => ipcRenderer.invoke('license-set-key', key),
  clearLicense: () => ipcRenderer.invoke('license-clear'),

  // LLM Tier override APIs
  getLLMTierOverride: () => ipcRenderer.invoke('llm-get-tier-override'),
  setLLMTierOverride: (tier) => ipcRenderer.invoke('llm-set-tier-override', tier),

  // Hosted backend mode (Laserreach backend: Deepgram + GPT-5-mini)
  getHostedConfig: () => ipcRenderer.invoke('hosted-get-config'),
  setHostedConfig: (config) => ipcRenderer.invoke('hosted-set-config', config),
  getHostedReminders: () => ipcRenderer.invoke('hosted-get-reminders'),

  // ASR helper APIs
  asrStart: (opts) => ipcRenderer.send('asr-start', opts || {}),
  asrSendChunkF32: (bufferOrView) => {
    try {
      // Prefer zero-copy transfer for ArrayBuffer
      if (bufferOrView instanceof ArrayBuffer) {
        ipcRenderer.postMessage('asr-audio-f32', bufferOrView, [bufferOrView]);
        return;
      }
      if (bufferOrView && bufferOrView.buffer instanceof ArrayBuffer) {
        const ab = bufferOrView.buffer;
        ipcRenderer.postMessage('asr-audio-f32', ab, [ab]);
        return;
      }
      // Fallback to standard send for Buffers or unknown types
      ipcRenderer.send('asr-audio-f32', bufferOrView);
    } catch (e) {
      try { ipcRenderer.send('asr-audio-f32', bufferOrView); } catch {}
    }
  },
  asrStop: () => ipcRenderer.send('asr-stop'),
  onASRMessage: (cb) => ipcRenderer.on('asr-message', (_e, msg) => cb(msg)),
  
});
