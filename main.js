const { app, BrowserWindow, ipcMain, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');

const { HostedConfigStore } = require('./src/hosted-config');
const { HostedApiClient } = require('./src/hosted-client');
const { HostedAudioTranscriber } = require('./src/hosted-audio');

let mainWindow = null;
let hostedConfigStore = null;
let hostedClient = null;
let audioTranscriber = null;

function safeSend(channel, payload) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send(channel, payload);
}

function createHostedRuntime() {
  hostedConfigStore = new HostedConfigStore({ app });
  hostedClient = new HostedApiClient({
    getConfig: () => hostedConfigStore.get(),
    fetchImpl: fetch,
  });
  audioTranscriber = new HostedAudioTranscriber({
    transcribeFn: (wavBuffer) => hostedClient.transcribeWav(wavBuffer),
    onTranscript: (msg) => safeSend('asr-message', msg),
    onStatus: (msg) => safeSend('asr-message', msg),
    onError: (msg) => safeSend('asr-message', msg),
    flushIntervalMs: 3200,
    minBytes: 32000,
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 760,
    minHeight: 520,
    frame: false,
    transparent: false,
    title: 'Laserreach Intelli',
    movable: true,
    resizable: true,
    alwaysOnTop: true,
    backgroundColor: '#0b0f17',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.loadFile('index.html');
  mainWindow.once('ready-to-show', () => {
    safeSend('model-status', {
      state: 'ready',
      tier: 'hosted',
      message: 'Hosted runtime ready (Deepgram + GPT-5-mini via Laserreach backend)',
    });
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function registerShortcuts() {
  const toggleShortcut = process.platform === 'darwin' ? 'Command+Shift+Space' : 'Control+Shift+Space';
  try {
    globalShortcut.register(toggleShortcut, () => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      if (mainWindow.isVisible()) {
        mainWindow.hide();
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
    });
  } catch (err) {
    console.error('Failed to register global shortcut:', err);
  }
}

function normalizeFloatChunk(payload) {
  if (!payload) return null;
  if (payload instanceof Float32Array) return payload;
  if (payload instanceof ArrayBuffer) return new Float32Array(payload);
  if (Buffer.isBuffer(payload)) {
    return new Float32Array(payload.buffer, payload.byteOffset, Math.floor(payload.byteLength / 4));
  }
  if (payload.buffer instanceof ArrayBuffer) {
    return new Float32Array(payload.buffer, payload.byteOffset || 0, Math.floor((payload.byteLength || payload.length || 0) / 4));
  }
  return null;
}

function ensureHostedConfigured() {
  const validation = hostedConfigStore.validate();
  if (!validation.ok) {
    throw new Error(`Hosted configuration invalid: ${validation.errors.join(', ')}`);
  }
  return validation.config;
}

async function handleAnalyzeRequest(payload, fallbackType = 'full') {
  const cfg = ensureHostedConfigured();
  const prompt = String(payload?.prompt || '').trim();
  const transcriptContext = String(payload?.transcriptContext || '').trim();
  const transcript = String(payload?.transcript || transcriptContext || prompt).trim();
  if (!transcript) {
    throw new Error('Transcript is required for analysis');
  }

  const result = await hostedClient.analyze({
    transcript,
    prompt,
    analysisType: payload?.analysisType || payload?.analysis_type || fallbackType,
    maxCompletionTokens: payload?.maxCompletionTokens || payload?.max_completion_tokens || 12000,
    pipelineId: payload?.pipelineId || payload?.pipeline_id || cfg.defaultPipelineId || undefined,
    eventId: payload?.eventId || payload?.event_id || undefined,
    model: payload?.model || cfg.analysisModel || 'gpt-5-mini',
  });

  return result;
}

function registerIpc() {
  ipcMain.handle('hosted-get-config', async () => {
    try {
      return { success: true, config: hostedConfigStore.get() };
    } catch (err) {
      return { success: false, error: String(err?.message || err) };
    }
  });

  ipcMain.handle('hosted-set-config', async (_e, next) => {
    try {
      const config = hostedConfigStore.set(next || {});
      return { success: true, config };
    } catch (err) {
      return { success: false, error: String(err?.message || err) };
    }
  });

  ipcMain.handle('hosted-get-reminders', async () => {
    try {
      ensureHostedConfigured();
      const result = await hostedClient.getReminders();
      return { success: true, reminders: result.reminders || [], count: Number(result.count || 0) };
    } catch (err) {
      return { success: false, error: String(err?.message || err), reminders: [], count: 0 };
    }
  });

  ipcMain.on('llm-prompt', async (_e, payload) => {
    const id = payload?.id;
    try {
      const result = await handleAnalyzeRequest(payload, 'full');
      const responseText =
        (typeof result?.text === 'string' && result.text.trim()) ||
        (result?.parsed ? JSON.stringify(result.parsed, null, 2) : '') ||
        'No response generated.';
      safeSend('llm-response', { id, response: responseText, raw: result });
    } catch (err) {
      safeSend('llm-response', { id, error: String(err?.message || err) });
    }
  });

  ipcMain.on('llm-analyze', async (_e, payload) => {
    try {
      const result = await handleAnalyzeRequest(payload, 'full');
      const parsed = result?.parsed || {};
      const normalized = {
        summary: parsed.summary || result?.text || '',
        suggestions: {
          actionItems: parsed.actionItems || parsed.next_best_actions || [],
          questions: parsed.questions || parsed.discovery_questions || [],
          topics: parsed.topics || [],
          activities: parsed.activities || [],
        },
      };
      safeSend('llm-analysis-response', {
        id: payload?.id,
        type: 'analysis-response',
        results: normalized,
        raw: result,
        timeRange: payload?.timeRange,
      });
    } catch (err) {
      safeSend('llm-analysis-response', {
        id: payload?.id,
        type: 'analysis-response',
        error: String(err?.message || err),
      });
    }
  });

  ipcMain.on('asr-start', (_e, opts) => {
    try {
      ensureHostedConfigured();
      audioTranscriber.start({
        sampleRate: Number(opts?.sampleRate || opts?.sample_rate || 16000),
        flushIntervalMs: Number(opts?.updateMs || 3200),
      });
    } catch (err) {
      safeSend('asr-message', { op: 'error', message: String(err?.message || err) });
    }
  });

  ipcMain.on('asr-audio-f32', (_e, payload) => {
    try {
      const chunk = normalizeFloatChunk(payload);
      if (!chunk || !chunk.length) return;
      audioTranscriber.addFloat32Chunk(chunk);
    } catch (err) {
      safeSend('asr-message', { op: 'error', message: `Audio chunk error: ${String(err?.message || err)}` });
    }
  });

  ipcMain.on('asr-stop', async () => {
    try {
      await audioTranscriber.stop();
      safeSend('asr-message', { op: 'status', message: 'Hosted ASR stopped' });
    } catch (err) {
      safeSend('asr-message', { op: 'error', message: String(err?.message || err) });
    }
  });

  ipcMain.on('session-start', async (_e, payload) => {
    try {
      ensureHostedConfigured();
      await hostedClient.sessionStart({ sessionId: payload?.sessionId, metadata: payload?.metadata || {} });
    } catch (err) {
      safeSend('llm-status', { type: 'session-error', message: String(err?.message || err) });
    }
  });

  ipcMain.on('session-append-transcript', async (_e, payload) => {
    try {
      ensureHostedConfigured();
      await hostedClient.sessionAppendEvent({
        sessionId: payload?.sessionId,
        type: 'transcript',
        payload: payload?.segment || {},
      });
    } catch (err) {
      safeSend('llm-status', { type: 'session-error', message: String(err?.message || err) });
    }
  });

  ipcMain.on('session-append-analysis', async (_e, payload) => {
    try {
      ensureHostedConfigured();
      await hostedClient.sessionAppendEvent({
        sessionId: payload?.sessionId,
        type: 'analysis',
        payload: payload?.entry || {},
      });
    } catch (err) {
      safeSend('llm-status', { type: 'session-error', message: String(err?.message || err) });
    }
  });

  ipcMain.on('session-end', async (_e, payload) => {
    try {
      ensureHostedConfigured();
      await hostedClient.sessionEnd({ sessionId: payload?.sessionId, metadata: payload?.extra || {} });
    } catch (err) {
      safeSend('llm-status', { type: 'session-error', message: String(err?.message || err) });
    }
  });

  ipcMain.handle('session-get', async (_e, sessionId) => {
    try {
      ensureHostedConfigured();
      return await hostedClient.sessionGet(sessionId);
    } catch (err) {
      return { success: false, error: String(err?.message || err) };
    }
  });

  ipcMain.handle('sessions-list', async () => {
    return {
      success: false,
      error: 'Session listing is managed by backend APIs and is not exposed in this desktop build.',
      sessions: [],
    };
  });

  ipcMain.handle('sessions-search', async () => {
    return {
      success: false,
      error: 'Session search is not available in hosted-only desktop mode.',
      results: [],
    };
  });
}

function cleanup() {
  try {
    globalShortcut.unregisterAll();
  } catch (_) {}

  try {
    if (audioTranscriber) {
      audioTranscriber.stop();
    }
  } catch (_) {}
}

function bootstrap() {
  createHostedRuntime();
  createWindow();
  registerShortcuts();
  registerIpc();
}

app.whenReady().then(() => {
  try {
    const userData = app.getPath('userData');
    if (!fs.existsSync(userData)) {
      fs.mkdirSync(userData, { recursive: true });
    }
  } catch (_) {}

  bootstrap();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      bootstrap();
    }
  });
});

app.on('window-all-closed', () => {
  cleanup();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  cleanup();
});
