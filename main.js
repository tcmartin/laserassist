const { app, BrowserWindow, ipcMain, globalShortcut, shell, screen } = require('electron');
const path = require('path');
const fs = require('fs');

const { HostedConfigStore } = require('./src/hosted-config');
const { HostedApiClient } = require('./src/hosted-client');
const { HostedAudioTranscriber } = require('./src/hosted-audio');

let barWindow = null;
let authWindow = null;
let hostedConfigStore = null;
let hostedClient = null;
let audioTranscriber = null;
let isPinned = true;
let panelCounter = 0;
const panelWindows = new Map();
const meetingAlertedIds = new Set();
const captureProtectionMode = String(process.env.INTELLI_CAPTURE_PROTECTION || 'strict').trim().toLowerCase();

function applyContentProtection(win, label = 'window') {
  try {
    if (!win || win.isDestroyed()) return;
    if (captureProtectionMode === 'off') return;
    // Compatibility mode for debugging specific desktop-share clients.
    // Default remains strict non-capturable behavior.
    if (process.platform === 'darwin' && captureProtectionMode === 'desktop-share-safe' && label === 'bar') {
      return;
    }
    win.setContentProtection(true);
  } catch (err) {
    console.warn(`Unable to enable content protection for ${label}:`, err);
  }
}

function safeSend(channel, payload) {
  if (!barWindow || barWindow.isDestroyed()) return;
  barWindow.webContents.send(channel, payload);
}

function safeJsonParse(text, fallback) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function escapeHtml(input) {
  return String(input || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function createHostedRuntime() {
  console.log(`[intelli] capture_protection_mode=${captureProtectionMode}`);
  hostedConfigStore = new HostedConfigStore({ app });
  hostedClient = new HostedApiClient({
    getConfig: () => hostedConfigStore.get(),
    fetchImpl: fetch,
    onStatus: (msg) => safeSend('llm-status', msg),
  });
  audioTranscriber = new HostedAudioTranscriber({
    transcribeFn: (wavBuffer) => hostedClient.transcribeWav(wavBuffer),
    onTranscript: (msg) => safeSend('asr-message', msg),
    onStatus: (msg) => safeSend('asr-message', msg),
    onError: (msg) => safeSend('asr-message', msg),
    flushIntervalMs: 2600,
    minBytes: 28000,
  });
}

function createBarWindow() {
  barWindow = new BrowserWindow({
    width: 1120,
    height: 108,
    minWidth: 720,
    minHeight: 86,
    maxHeight: 220,
    frame: false,
    transparent: true,
    resizable: true,
    movable: true,
    alwaysOnTop: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    skipTaskbar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  applyContentProtection(barWindow, 'bar');

  barWindow.loadFile('index.html');
  barWindow.once('ready-to-show', () => {
    safeSend('model-status', {
      state: 'ready',
      tier: 'hosted',
      message: 'Laserreach Intelli overlay ready (Deepgram + GPT-5-mini)',
    });
  });

  barWindow.on('closed', () => {
    barWindow = null;
  });
}

function registerShortcuts() {
  const toggleShortcut = process.platform === 'darwin' ? 'Command+Shift+Space' : 'Control+Shift+Space';
  try {
    globalShortcut.register(toggleShortcut, () => {
      if (!barWindow || barWindow.isDestroyed()) return;
      if (barWindow.isVisible()) {
        barWindow.hide();
      } else {
        barWindow.show();
        barWindow.focus();
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

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 500)}`);
  }
  return safeJsonParse(text, {});
}

async function inferTenantId(backendUrl, jwtToken, fallbackTenantId = '') {
  const headers = {
    Authorization: `Bearer ${jwtToken}`,
  };
  try {
    const orgs = await fetchJson(`${backendUrl}/me/orgs`, { method: 'GET', headers });
    if (Array.isArray(orgs) && orgs.length) {
      const firstOrg = orgs.find((o) => o && o.org_id) || orgs[0];
      if (firstOrg && firstOrg.org_id) return String(firstOrg.org_id);
    }
  } catch (_) {
    // no-op
  }
  return String(fallbackTenantId || '');
}

function normalizeBackendUrl(url) {
  return String(url || '').trim().replace(/\/+$/, '');
}

function appendAuthCandidates(list, baseUrl) {
  const base = normalizeBackendUrl(baseUrl);
  if (!base) return;
  list.push(`${base}/oauth-bridge`);
  list.push(`${base}/login`);
  list.push(`${base}/register`);
  list.push(`${base}/`);
}

function deriveFrontendBases(backendUrl) {
  const base = normalizeBackendUrl(backendUrl);
  if (!base) return [];
  try {
    const parsed = new URL(base);
    const host = parsed.hostname;
    const isLocalHost =
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '0.0.0.0' ||
      host === '::1';
    if (!isLocalHost) return [];
    return [
      `${parsed.protocol}//${host}:3100`,
      `${parsed.protocol}//${host}:3000`,
      `${parsed.protocol}//${host}:3125`,
    ];
  } catch (_) {
    return [];
  }
}

function loginUrlCandidates(config = {}) {
  const out = [];
  const seen = new Set();
  const pushUnique = (url) => {
    const normalized = normalizeBackendUrl(url);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    out.push(normalized);
  };

  const withPaths = [];
  appendAuthCandidates(withPaths, config.frontendUrl || '');
  for (const derived of deriveFrontendBases(config.backendUrl || '')) {
    appendAuthCandidates(withPaths, derived);
  }
  appendAuthCandidates(withPaths, config.backendUrl || '');

  for (const candidate of withPaths) pushUnique(candidate);
  return out;
}

async function captureAuthFromWindow(win) {
  if (!win || win.isDestroyed()) return null;
  const script = `(() => {
    try {
      const query = new URLSearchParams(location.search || '');
      const hash = new URLSearchParams(String(location.hash || '').replace(/^#/, ''));
      const jwt =
        localStorage.getItem('jwt') ||
        localStorage.getItem('access_token') ||
        localStorage.getItem('token') ||
        sessionStorage.getItem('jwt') ||
        sessionStorage.getItem('access_token') ||
        sessionStorage.getItem('token') ||
        query.get('token') ||
        query.get('access_token') ||
        hash.get('token') ||
        hash.get('access_token') ||
        '';
      const tenantId =
        localStorage.getItem('currentOrgId') ||
        sessionStorage.getItem('currentOrgId') ||
        query.get('org_id') ||
        '';
      const username =
        localStorage.getItem('username') ||
        sessionStorage.getItem('username') ||
        query.get('username') ||
        '';
      return { jwt, tenantId, username, href: location.href };
    } catch (e) {
      return { jwt: '', tenantId: '', username: '', error: String(e) };
    }
  })();`;
  try {
    const out = await win.webContents.executeJavaScript(script, true);
    if (!out || !out.jwt) return null;
    return out;
  } catch {
    return null;
  }
}

function decodeJwtPayloadUnsafe(token) {
  try {
    const parts = String(token || '').split('.');
    if (parts.length !== 3) return null;
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const json = Buffer.from(padded, 'base64').toString('utf8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function isUsableAuthToken(token) {
  const payload = decodeJwtPayloadUnsafe(token);
  if (!payload) return true;
  if (payload.two_fa_required === true || payload['2fa_required'] === true) return false;
  return true;
}

async function applyAuthToken({ token, backendUrl, tenantId, username }) {
  const current = hostedConfigStore.get();
  const nextBackend = normalizeBackendUrl(backendUrl || current.backendUrl || 'http://localhost:8788');
  let nextTenant = String(tenantId || current.tenantId || '').trim();
  if (!nextTenant) {
    nextTenant = await inferTenantId(nextBackend, token, nextTenant);
  }

  const saved = hostedConfigStore.set({
    backendUrl: nextBackend,
    tenantId: nextTenant,
    jwtToken: String(token || '').trim(),
  });

  safeSend('auth-updated', {
    success: true,
    tenantId: saved.tenantId,
    username: username || '',
    backendUrl: saved.backendUrl,
  });

  return saved;
}

async function openAuthWindow() {
  if (authWindow && !authWindow.isDestroyed()) {
    authWindow.focus();
    return { success: true, message: 'auth_window_focused' };
  }

  const cfg = hostedConfigStore.get();
  const candidates = loginUrlCandidates(cfg);
  const startUrl = candidates[0] || 'http://localhost:8788';
  const authChildren = new Set();

  authWindow = new BrowserWindow({
    width: 1120,
    height: 780,
    parent: barWindow || undefined,
    modal: false,
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      contextIsolation: true,
      sandbox: false,
    },
  });

  const closeAuthWindows = () => {
    for (const child of authChildren) {
      try {
        if (child && !child.isDestroyed()) child.close();
      } catch (_) {
        // no-op
      }
    }
    authChildren.clear();
    try {
      if (authWindow && !authWindow.isDestroyed()) authWindow.close();
    } catch (_) {
      // no-op
    }
  };

  const tryCaptureFrom = async (targetWindow) => {
    const captured = await captureAuthFromWindow(targetWindow);
    if (!captured || !captured.jwt) return false;
    if (!isUsableAuthToken(captured.jwt)) return false;
    await applyAuthToken({
      token: captured.jwt,
      backendUrl: cfg.backendUrl,
      tenantId: captured.tenantId,
      username: captured.username,
    });
    closeAuthWindows();
    return true;
  };

  const tryCapture = async () => {
    if (await tryCaptureFrom(authWindow)) return true;
    for (const child of authChildren) {
      if (await tryCaptureFrom(child)) return true;
    }
    return false;
  };

  const looksLikeMethodNotAllowed = async () => {
    if (!authWindow || authWindow.isDestroyed()) return false;
    try {
      const out = await authWindow.webContents.executeJavaScript(`(() => {
        try {
          const title = String(document.title || '').toLowerCase();
          const body = String((document.body && document.body.innerText) || '').toLowerCase().slice(0, 1200);
          const href = String(location.href || '').toLowerCase();
          return { title, body, href };
        } catch (e) {
          return { title: '', body: '', href: '' };
        }
      })();`, true);
      const hay = `${out?.title || ''} ${out?.body || ''} ${out?.href || ''}`;
      return hay.includes('405') || hay.includes('method not allowed');
    } catch {
      return false;
    }
  };

  let candidateIndex = 0;

  const loadCandidateAt = async (index) => {
    if (!authWindow || authWindow.isDestroyed()) {
      return { success: false, error: 'auth_window_closed' };
    }
    const url = candidates[index];
    if (!url) {
      return { success: false, error: 'no_auth_urls_available' };
    }
    try {
      await authWindow.loadURL(url);
      return { success: true };
    } catch (err) {
      return { success: false, error: String(err?.message || err) };
    }
  };

  const tryNextCandidate = async () => {
    if (!authWindow || authWindow.isDestroyed()) return;
    if (candidateIndex >= candidates.length - 1) return;
    candidateIndex += 1;
    await loadCandidateAt(candidateIndex);
  };

  authWindow.webContents.setWindowOpenHandler(() => ({
    action: 'allow',
    overrideBrowserWindowOptions: {
      parent: authWindow,
      modal: false,
      show: true,
      width: 520,
      height: 720,
      autoHideMenuBar: true,
      webPreferences: {
        contextIsolation: true,
        sandbox: false,
      },
    },
  }));
  authWindow.webContents.on('did-create-window', (childWindow) => {
    try {
      if (!childWindow || childWindow.isDestroyed()) return;
      applyContentProtection(childWindow, 'auth-child');
      authChildren.add(childWindow);
      childWindow.once('ready-to-show', () => {
        try {
          if (!childWindow.isDestroyed()) {
            childWindow.show();
            childWindow.focus();
          }
        } catch (_) {
          // no-op
        }
      });
      childWindow.webContents.on('did-finish-load', () => {
        tryCapture().catch(() => {});
      });
      childWindow.webContents.on('did-navigate', () => {
        tryCapture().catch(() => {});
      });
      childWindow.webContents.on('did-navigate-in-page', () => {
        tryCapture().catch(() => {});
      });
      childWindow.on('closed', () => {
        authChildren.delete(childWindow);
      });
    } catch (_) {
      // no-op
    }
  });

  authWindow.once('ready-to-show', () => authWindow.show());
  authWindow.webContents.on('did-finish-load', async () => {
    try {
      const captured = await tryCapture();
      if (captured) return;
      const is405 = await looksLikeMethodNotAllowed();
      if (is405) {
        await tryNextCandidate();
      }
    } catch (_) {
      // no-op
    }
  });
  authWindow.webContents.on('did-navigate', () => {
    tryCapture().catch(() => {});
  });
  authWindow.webContents.on('did-navigate-in-page', () => {
    tryCapture().catch(() => {});
  });

  authWindow.on('closed', () => {
    for (const child of authChildren) {
      try {
        if (child && !child.isDestroyed()) child.close();
      } catch (_) {
        // no-op
      }
    }
    authChildren.clear();
    authWindow = null;
  });

  const first = await loadCandidateAt(candidateIndex);
  if (!first.success) {
    for (let i = 1; i < candidates.length; i += 1) {
      candidateIndex = i;
      const attempt = await loadCandidateAt(candidateIndex);
      if (attempt.success) return { success: true };
    }
    return { success: false, error: first.error || `failed_to_load_auth_url:${startUrl}` };
  }

  return { success: true };
}

function panelHtml(payload) {
  const title = escapeHtml(payload?.title || 'Insight');
  const subtitle = escapeHtml(payload?.subtitle || '');
  const content = escapeHtml(payload?.content || '').replace(/\n/g, '<br/>');
  const chips = Array.isArray(payload?.chips)
    ? payload.chips.map((c) => `<span class="chip">${escapeHtml(c)}</span>`).join('')
    : '';
  const links = Array.isArray(payload?.links)
    ? payload.links
        .filter((l) => l && l.href)
        .map((l) => `<a class="link" href="${escapeHtml(l.href)}" target="_blank">${escapeHtml(l.label || l.href)}</a>`)
        .join('')
    : '';

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<style>
:root { --bg: rgba(12,14,20,0.93); --line: rgba(122,161,255,0.35); --text: #eef4ff; --muted: #9fb1d5; }
* { box-sizing: border-box; }
body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: transparent; color: var(--text); }
.panel {
  border: 1px solid var(--line); border-radius: 14px; overflow: hidden;
  background: linear-gradient(170deg, rgba(24,30,46,0.96), rgba(8,10,15,0.95));
  box-shadow: 0 16px 44px rgba(0,0,0,0.45); height: 100vh; display: flex; flex-direction: column;
}
.header {
  padding: 10px 12px; display: flex; justify-content: space-between; align-items: flex-start;
  border-bottom: 1px solid rgba(122,161,255,0.25); -webkit-app-region: drag;
}
.title { font-size: 14px; font-weight: 700; line-height: 1.2; }
.subtitle { font-size: 11px; color: var(--muted); margin-top: 2px; }
.close { -webkit-app-region: no-drag; border: none; background: transparent; color: #d7e4ff; font-size: 18px; cursor: pointer; }
.body { padding: 12px; overflow: auto; font-size: 13px; line-height: 1.45; }
.chips { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 8px; }
.chip { font-size: 11px; color: #c9daf9; background: rgba(78,118,208,0.3); border: 1px solid rgba(124,156,233,0.45); border-radius: 999px; padding: 2px 8px; }
.links { margin-top: 12px; display: flex; flex-direction: column; gap: 6px; }
.link { color: #9dc0ff; text-decoration: none; }
.link:hover { text-decoration: underline; }
</style>
</head>
<body>
  <div class="panel">
    <div class="header">
      <div>
        <div class="title">${title}</div>
        <div class="subtitle">${subtitle}</div>
      </div>
      <button class="close" onclick="window.close()">×</button>
    </div>
    <div class="body">
      <div class="chips">${chips}</div>
      <div>${content}</div>
      <div class="links">${links}</div>
    </div>
  </div>
</body>
</html>`;
}

function nextPanelBounds(width, height) {
  const workArea = screen.getPrimaryDisplay().workArea;
  const offset = (panelCounter % 7) * 26;
  const x = Math.max(workArea.x + 24, workArea.x + workArea.width - width - 24 - offset);
  const y = Math.max(workArea.y + 88, workArea.y + 88 + offset);
  panelCounter += 1;
  return { x, y, width, height };
}

function openPanel(payload = {}) {
  const width = Math.max(320, Math.min(Number(payload.width || 430), 760));
  const height = Math.max(220, Math.min(Number(payload.height || 340), 900));
  const key = String(payload.key || `panel_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`);

  const existing = panelWindows.get(key);
  if (existing && !existing.isDestroyed()) {
    existing.focus();
    return { success: true, key, reused: true };
  }

  const bounds = nextPanelBounds(width, height);
  const panel = new BrowserWindow({
    ...bounds,
    frame: false,
    transparent: true,
    resizable: true,
    movable: true,
    minimizable: false,
    maximizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: true,
    webPreferences: {
      contextIsolation: true,
      sandbox: false,
    },
  });
  applyContentProtection(panel, 'panel');

  panel.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(panelHtml(payload))}`);
  panel.on('closed', () => {
    panelWindows.delete(key);
  });

  panelWindows.set(key, panel);
  return { success: true, key, reused: false };
}

function closePanel(key) {
  const panel = panelWindows.get(String(key || ''));
  if (!panel || panel.isDestroyed()) return { success: false, error: 'panel_not_found' };
  panel.close();
  return { success: true };
}

function cleanup() {
  try {
    globalShortcut.unregisterAll();
  } catch (_) {}

  try {
    if (audioTranscriber) audioTranscriber.stop();
  } catch (_) {}
  try {
    if (hostedClient) hostedClient.closeAsrStream();
  } catch (_) {}
  try {
    if (hostedClient) hostedClient.closeAnalysisStream();
  } catch (_) {}

  for (const [, win] of panelWindows) {
    try {
      if (win && !win.isDestroyed()) win.close();
    } catch (_) {}
  }
  panelWindows.clear();

  try {
    if (authWindow && !authWindow.isDestroyed()) authWindow.close();
  } catch (_) {}
}

async function handleAnalyzeRequest(payload, fallbackType = 'full') {
  const cfg = ensureHostedConfigured();
  const prompt = String(payload?.prompt || '').trim();
  const transcriptContext = String(payload?.transcriptContext || '').trim();
  const transcript = String(payload?.transcript || transcriptContext || prompt).trim();
  if (!transcript) throw new Error('Transcript is required for analysis');

  return hostedClient.analyze({
    transcript,
    prompt,
    analysisType: payload?.analysisType || payload?.analysis_type || fallbackType,
    maxCompletionTokens: payload?.maxCompletionTokens || payload?.max_completion_tokens || 12000,
    pipelineId: payload?.pipelineId || payload?.pipeline_id || cfg.defaultPipelineId || undefined,
    eventId: payload?.eventId || payload?.event_id || undefined,
    model: payload?.model || cfg.analysisModel || 'gpt-5-mini',
  });
}

function registerIpc() {
  ipcMain.handle('window-minimize', () => {
    if (barWindow && !barWindow.isDestroyed()) barWindow.minimize();
    return { success: true };
  });

  ipcMain.handle('window-close', () => {
    app.quit();
    return { success: true };
  });

  ipcMain.handle('window-toggle-pin', () => {
    isPinned = !isPinned;
    if (barWindow && !barWindow.isDestroyed()) {
      barWindow.setAlwaysOnTop(isPinned);
    }
    return { success: true, pinned: isPinned };
  });

  ipcMain.handle('overlay-open-panel', async (_e, payload) => openPanel(payload));
  ipcMain.handle('overlay-close-panel', async (_e, payload) => closePanel(payload?.key));
  ipcMain.handle('overlay-list-panels', async () => ({ success: true, keys: [...panelWindows.keys()] }));

  ipcMain.handle('auth-open-login', async () => openAuthWindow());

  ipcMain.handle('auth-login-password', async (_e, payload) => {
    try {
      const cfg = hostedConfigStore.get();
      const backendUrl = normalizeBackendUrl(payload?.backendUrl || cfg.backendUrl || 'http://localhost:8788');
      const username = String(payload?.username || '').trim();
      const password = String(payload?.password || '').trim();
      if (!username || !password) {
        return { success: false, error: 'username_and_password_required' };
      }

      const result = await fetchJson(`${backendUrl}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      const token = result?.access_token || result?.token;
      if (!token) {
        return { success: false, error: result?.message || result?.error || 'login_failed' };
      }

      const saved = await applyAuthToken({
        token,
        backendUrl,
        tenantId: payload?.tenantId || '',
        username: result?.username || username,
      });

      return { success: true, config: saved, username: result?.username || username };
    } catch (err) {
      return { success: false, error: String(err?.message || err) };
    }
  });

  ipcMain.handle('auth-signout', async () => {
    try {
      const cfg = hostedConfigStore.get();
      const saved = hostedConfigStore.set({
        ...cfg,
        jwtToken: '',
      });
      safeSend('auth-updated', { success: true, signedOut: true, tenantId: saved.tenantId });
      return { success: true, config: saved };
    } catch (err) {
      return { success: false, error: String(err?.message || err) };
    }
  });

  ipcMain.handle('auth-status', async () => {
    try {
      const cfg = hostedConfigStore.get();
      const hasToken = Boolean(cfg.jwtToken);
      if (!hasToken) {
        return { success: true, authenticated: false, config: cfg };
      }
      const me = await fetchJson(`${cfg.backendUrl}/user/me`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${cfg.jwtToken}` },
      });
      return {
        success: true,
        authenticated: true,
        user: {
          username: me?.username || '',
          email: me?.email || '',
        },
        config: cfg,
      };
    } catch (err) {
      return { success: true, authenticated: false, error: String(err?.message || err), config: hostedConfigStore.get() };
    }
  });

  ipcMain.handle('auth-list-orgs', async () => {
    try {
      const cfg = hostedConfigStore.get();
      if (!cfg.jwtToken) {
        return { success: true, orgs: [] };
      }
      const orgs = await fetchJson(`${cfg.backendUrl}/me/orgs`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${cfg.jwtToken}` },
      });
      const normalized = Array.isArray(orgs)
        ? orgs
            .map((org) => ({
              org_id: org?.org_id ? String(org.org_id) : '',
              name: org?.name ? String(org.name) : '',
            }))
            .filter((org) => org.org_id)
        : [];
      return { success: true, orgs: normalized };
    } catch (err) {
      return { success: false, error: String(err?.message || err), orgs: [] };
    }
  });

  ipcMain.handle('auth-open-external', async (_e, payload) => {
    try {
      const cfg = hostedConfigStore.get();
      const target = String(payload?.url || `${cfg.backendUrl}/`).trim();
      await shell.openExternal(target);
      return { success: true };
    } catch (err) {
      return { success: false, error: String(err?.message || err) };
    }
  });

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

      const reminders = (result.reminders || []).map((r) => ({ ...r }));
      for (const r of reminders) {
        const eventId = String(r.event_id || '');
        const inMinutes = Number(r.in_minutes || NaN);
        if (eventId && Number.isFinite(inMinutes) && inMinutes >= 0 && inMinutes <= 10 && !meetingAlertedIds.has(eventId)) {
          meetingAlertedIds.add(eventId);
          openPanel({
            key: `meeting_${eventId}`,
            title: 'Upcoming meeting',
            subtitle: `${r.person_name || 'Contact'} • ${r.company_name || 'Account'}`,
            content: `${r.message_preview || 'Meeting starts soon.'}\nTime: ${r.scheduled_at || ''}`,
            chips: [
              `in ${inMinutes}m`,
              r.pipeline_status ? `pipeline: ${r.pipeline_status}` : '',
            ].filter(Boolean),
            width: 440,
            height: 260,
          });
        }
      }

      return { success: true, reminders, count: Number(result.count || reminders.length || 0) };
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
      safeSend('llm-analysis-response', {
        id: payload?.id,
        type: 'analysis-response',
        results: {
          summary: parsed.summary || result?.text || '',
          suggestions: {
            actionItems: parsed.actionItems || parsed.next_best_actions || [],
            questions: parsed.questions || parsed.discovery_questions || [],
            topics: parsed.topics || [],
            activities: parsed.activities || [],
          },
        },
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
        flushIntervalMs: Number(opts?.updateMs || 2600),
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
      await hostedClient.closeAsrStream();
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

  ipcMain.handle('sessions-list', async () => ({
    success: false,
    error: 'Session listing is managed by backend APIs and is not exposed in this desktop build.',
    sessions: [],
  }));

  ipcMain.handle('sessions-search', async () => ({
    success: false,
    error: 'Session search is not available in hosted-only desktop mode.',
    results: [],
  }));
}

function bootstrap() {
  createHostedRuntime();
  createBarWindow();
  registerShortcuts();
  registerIpc();
}

app.whenReady().then(() => {
  try {
    const userData = app.getPath('userData');
    if (!fs.existsSync(userData)) fs.mkdirSync(userData, { recursive: true });
  } catch (_) {}

  bootstrap();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) bootstrap();
  });
});

app.on('window-all-closed', () => {
  cleanup();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  cleanup();
});
