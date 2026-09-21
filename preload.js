const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getHostedConfig: () => ipcRenderer.invoke('hosted-get-config'),
  setHostedConfig: (config) => ipcRenderer.invoke('hosted-set-config', config),
  getHostedReminders: () => ipcRenderer.invoke('hosted-get-reminders'),

  callingGetContext: (payload) => ipcRenderer.invoke('calling-get-context', payload || {}),
  callingSearchPeople: (payload) => ipcRenderer.invoke('calling-search-people', payload || {}),
  callingSetExpanded: (expanded) => ipcRenderer.invoke('calling-set-expanded', expanded),
  callingListScripts: (payload) => ipcRenderer.invoke('calling-list-scripts', payload || {}),
  callingGetScript: (templateId, payload) => ipcRenderer.invoke('calling-get-script', templateId, payload || {}),
  callingCreateScript: (payload) => ipcRenderer.invoke('calling-create-script', payload || {}),
  callingUpdateScript: (templateId, payload) => ipcRenderer.invoke('calling-update-script', templateId, payload || {}),
  callingArchiveScript: (templateId, payload) => ipcRenderer.invoke('calling-archive-script', templateId, payload || {}),
  callingListNumbers: (payload) => ipcRenderer.invoke('calling-list-numbers', payload || {}),
  callingNumberOptions: () => ipcRenderer.invoke('calling-number-options'),
  callingBeginCheckout: (payload) => ipcRenderer.invoke('calling-begin-checkout', payload || {}),
  callingGetNumberRequest: (requestId) => ipcRenderer.invoke('calling-get-number-request', requestId),
  callingReconcileNumber: (requestId) => ipcRenderer.invoke('calling-reconcile-number', requestId),
  callingPrepareCall: (payload) => ipcRenderer.invoke('calling-prepare-call', payload || {}),
  callingGetCall: (callId) => ipcRenderer.invoke('calling-get-call', callId),
  callingCancelCall: (callId) => ipcRenderer.invoke('calling-cancel-call', callId),
  callingMediaStart: (payload) => ipcRenderer.invoke('calling-media-start', payload),
  callingMediaTrickle: (payload) => ipcRenderer.invoke('calling-media-trickle', payload),
  callingMediaEnd: (callId) => ipcRenderer.invoke('calling-media-end', { callId }),
  callingMediaClose: (callId) => ipcRenderer.invoke('calling-media-close', { callId }),
  onCallingMediaUpdate: (callback) => {
    const listener = (_event, message) => callback(message);
    ipcRenderer.on('calling-media-update', listener);
    return () => ipcRenderer.removeListener('calling-media-update', listener);
  },
  onCallingMediaClosed: (callback) => {
    const listener = (_event, message) => callback(message);
    ipcRenderer.on('calling-media-closed', listener);
    return () => ipcRenderer.removeListener('calling-media-closed', listener);
  },

  authOpenLogin: () => ipcRenderer.invoke('auth-open-login'),
  authLoginPassword: (payload) => ipcRenderer.invoke('auth-login-password', payload || {}),
  authSignOut: () => ipcRenderer.invoke('auth-signout'),
  authStatus: () => ipcRenderer.invoke('auth-status'),
  authListOrgs: () => ipcRenderer.invoke('auth-list-orgs'),
  authOpenExternal: (url) => ipcRenderer.invoke('auth-open-external', { url }),
  onAuthUpdated: (callback) => ipcRenderer.on('auth-updated', (_e, msg) => callback(msg)),
  onQuickAsk: (callback) => ipcRenderer.on('quick-ask', (_e, msg) => callback(msg)),

  openOverlayPanel: (payload) => ipcRenderer.invoke('overlay-open-panel', payload || {}),
  closeOverlayPanel: (key) => ipcRenderer.invoke('overlay-close-panel', { key }),
  listOverlayPanels: () => ipcRenderer.invoke('overlay-list-panels'),

  windowMinimize: () => ipcRenderer.invoke('window-minimize'),
  windowClose: () => ipcRenderer.invoke('window-close'),
  windowTogglePin: () => ipcRenderer.invoke('window-toggle-pin'),

  sendPrompt: (id, prompt, transcriptContext) => ipcRenderer.send('llm-prompt', { id, prompt, transcriptContext }),
  onResponse: (callback) => ipcRenderer.on('llm-response', (_e, msg) => callback(msg)),

  sendAnalysisRequest: (request) => ipcRenderer.send('llm-analyze', request),
  onAnalysisResponse: (callback) => ipcRenderer.on('llm-analysis-response', (_e, msg) => callback({ data: msg })),

  onStatus: (callback) => ipcRenderer.on('llm-status', (_e, msg) => callback(msg)),
  onModelStatus: (callback) => ipcRenderer.on('model-status', (_e, status) => callback(status)),

  asrStart: (opts) => ipcRenderer.send('asr-start', opts || {}),
  asrSendChunkF32: (bufferOrView) => {
    try {
      if (bufferOrView instanceof ArrayBuffer) {
        ipcRenderer.postMessage('asr-audio-f32', bufferOrView, [bufferOrView]);
        return;
      }
      if (bufferOrView && bufferOrView.buffer instanceof ArrayBuffer) {
        const ab = bufferOrView.buffer;
        ipcRenderer.postMessage('asr-audio-f32', ab, [ab]);
        return;
      }
      ipcRenderer.send('asr-audio-f32', bufferOrView);
    } catch {
      try {
        ipcRenderer.send('asr-audio-f32', bufferOrView);
      } catch (_) {}
    }
  },
  asrStop: () => ipcRenderer.send('asr-stop'),
  onASRMessage: (callback) => ipcRenderer.on('asr-message', (_e, msg) => callback(msg)),

  sessionStart: (sessionId, metadata) => ipcRenderer.send('session-start', { sessionId, metadata }),
  sessionAppendTranscript: (sessionId, segment) => ipcRenderer.send('session-append-transcript', { sessionId, segment }),
  sessionAppendAnalysis: (sessionId, entry) => ipcRenderer.send('session-append-analysis', { sessionId, entry }),
  sessionEnd: (sessionId, extra) => ipcRenderer.send('session-end', { sessionId, extra }),

  getSession: (sessionId) => ipcRenderer.invoke('session-get', sessionId),
  listSessions: () => ipcRenderer.invoke('sessions-list'),
  searchSessions: (query, opts) => ipcRenderer.invoke('sessions-search', query, opts),
});
