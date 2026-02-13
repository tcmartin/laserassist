const WebSocket = require('ws');

function sanitizeErrorText(text, status) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return `HTTP ${status}`;
  return `HTTP ${status}: ${trimmed.slice(0, 800)}`;
}

function buildFallbackUrls(url) {
  const out = [];
  const seen = new Set();
  const pushUnique = (value) => {
    const key = String(value || '');
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(key);
  };

  pushUnique(url);

  try {
    const parsed = new URL(url);
    const host = String(parsed.hostname || '');
    const hostNormalized = host.replace(/^\[|\]$/g, '');
    const isLocal = hostNormalized === 'localhost' || hostNormalized === '127.0.0.1' || hostNormalized === '::1';
    if (!isLocal) return out;

    if (hostNormalized === 'localhost') {
      const alt = new URL(parsed.toString());
      alt.hostname = '127.0.0.1';
      pushUnique(alt.toString());
    } else if (hostNormalized === '127.0.0.1') {
      const alt = new URL(parsed.toString());
      alt.hostname = 'localhost';
      pushUnique(alt.toString());
    } else if (hostNormalized === '::1') {
      const altV4 = new URL(parsed.toString());
      altV4.hostname = '127.0.0.1';
      pushUnique(altV4.toString());
      const altLocalhost = new URL(parsed.toString());
      altLocalhost.hostname = 'localhost';
      pushUnique(altLocalhost.toString());
    }

    if (parsed.protocol === 'https:') {
      const alt = new URL(parsed.toString());
      alt.protocol = 'http:';
      pushUnique(alt.toString());
    } else if (parsed.protocol === 'wss:') {
      const alt = new URL(parsed.toString());
      alt.protocol = 'ws:';
      pushUnique(alt.toString());
    }
  } catch (_) {
    // no-op
  }

  return out;
}

function parseSocketMessage(raw) {
  try {
    return JSON.parse(String(raw || ''));
  } catch (_) {
    return null;
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

class HostedApiClient {
  constructor({ fetchImpl, getConfig, onStatus, onAsrMessage }) {
    this.fetchImpl = fetchImpl || fetch;
    this.getConfig = getConfig;
    this.onStatus = typeof onStatus === 'function' ? onStatus : () => {};
    this.onAsrMessage = typeof onAsrMessage === 'function' ? onAsrMessage : () => {};

    this._asrSocket = null;
    this._asrSocketReady = null;
    this._asrSocketReqSeq = 0;
    this._asrSocketPending = new Map();
    this._asrSocketDisabledUntil = 0;

    this._analysisSocket = null;
    this._analysisSocketReady = null;
    this._analysisSocketReqSeq = 0;
    this._analysisSocketPending = new Map();
    this._analysisSocketDisabledUntil = 0;
  }

  _config() {
    const cfg = this.getConfig();
    if (!cfg || !cfg.backendUrl) {
      throw new Error('Hosted backend configuration missing');
    }
    return cfg;
  }

  _headers(extra = {}) {
    const cfg = this._config();
    return {
      Authorization: `Bearer ${cfg.jwtToken || ''}`,
      'X-Org-ID': cfg.tenantId || '',
      ...extra,
    };
  }

  _buildSocketUrl(path) {
    const cfg = this._config();
    const backend = String(cfg.backendUrl || '').trim().replace(/\/+$/, '');
    const wsBase = backend.replace(/^http:/i, 'ws:').replace(/^https:/i, 'wss:');
    const token = encodeURIComponent(String(cfg.jwtToken || ''));
    const params = [`token=${token}`];
    const tenantId = String(cfg.tenantId || '').trim();
    if (tenantId) params.push(`tenant_id=${encodeURIComponent(tenantId)}`);
    return `${wsBase}${path}?${params.join('&')}`;
  }

  _socketState(kind) {
    const self = this;
    if (kind === 'analysis') {
      return {
        get socket() { return self._analysisSocket; },
        set socket(v) { self._analysisSocket = v; },
        get ready() { return self._analysisSocketReady; },
        set ready(v) { self._analysisSocketReady = v; },
        get pending() { return self._analysisSocketPending; },
        get reqSeq() { return self._analysisSocketReqSeq; },
        set reqSeq(v) { self._analysisSocketReqSeq = v; },
        get disabledUntil() { return self._analysisSocketDisabledUntil; },
        set disabledUntil(v) { self._analysisSocketDisabledUntil = v; },
      };
    }
    return {
      get socket() { return self._asrSocket; },
      set socket(v) { self._asrSocket = v; },
      get ready() { return self._asrSocketReady; },
      set ready(v) { self._asrSocketReady = v; },
      get pending() { return self._asrSocketPending; },
      get reqSeq() { return self._asrSocketReqSeq; },
      set reqSeq(v) { self._asrSocketReqSeq = v; },
      get disabledUntil() { return self._asrSocketDisabledUntil; },
      set disabledUntil(v) { self._asrSocketDisabledUntil = v; },
    };
  }

  async _ensureSocket(kind, path) {
    const state = this._socketState(kind);
    if (state.socket && state.socket.readyState === WebSocket.OPEN) return;
    if (state.ready) return state.ready;
    if (Date.now() < state.disabledUntil) {
      // Backoff should throttle reconnect attempts, not hard-fail live audio.
      await delay(state.disabledUntil - Date.now());
      if (state.socket && state.socket.readyState === WebSocket.OPEN) return;
      if (state.ready) return state.ready;
    }

    const urls = buildFallbackUrls(this._buildSocketUrl(path));
    const connectOne = (url) => new Promise((resolve, reject) => {
      let done = false;
      let opened = false;
      const finish = (fn, value) => {
        if (done) return;
        done = true;
        fn(value);
      };

      const ws = new WebSocket(url, { handshakeTimeout: 10000 });
      state.socket = ws;

      const clearPending = (reason) => {
        for (const [, pending] of state.pending) {
          clearTimeout(pending.timer);
          pending.reject(new Error(reason));
        }
        state.pending.clear();
      };

      ws.on('open', () => {
        opened = true;
        finish(resolve, undefined);
      });

      ws.on('message', (raw) => {
        const parsed = parseSocketMessage(raw);
        if (!parsed) return;
        const reqId = String(parsed?.request_id || '').trim();

        if (kind === 'asr') {
          const op = String(parsed?.op || '').toLowerCase();
          if (op === 'transcript_event') {
            this.onAsrMessage({
              op: 'transcript',
              text: String(parsed?.text || '').trim(),
              isFinal: Boolean(parsed?.is_final),
              speechFinal: Boolean(parsed?.speech_final),
              confidence: parsed?.confidence,
              provider: String(parsed?.provider || 'deepgram'),
            });
            return;
          }
          if (op === 'asr_status') {
            this.onAsrMessage({
              op: 'status',
              message: String(parsed?.message || ''),
            });
            return;
          }
          if (!reqId && (op === 'error' || parsed?.success === false)) {
            this.onAsrMessage({
              op: 'error',
              message: String(parsed?.error || 'asr_ws_error'),
            });
            return;
          }
        }

        if (kind === 'analysis' && parsed?.op === 'analysis_status') {
          this.onStatus({
            type: 'analysis-status',
            requestId: reqId || null,
            status: String(parsed?.status || ''),
            message: String(parsed?.message || ''),
          });
          return;
        }

        if (!reqId) return;
        const pending = state.pending.get(reqId);
        if (!pending) return;
        clearTimeout(pending.timer);
        state.pending.delete(reqId);
        if (parsed?.success === false || parsed?.op === 'error') {
          pending.reject(new Error(String(parsed?.error || `${kind}_ws_error`)));
          return;
        }
        pending.resolve(parsed);
      });

      ws.on('error', (err) => {
        const reason = `${kind}_ws_error:${String(err?.message || err)}`;
        state.socket = null;
        if (opened) {
          clearPending(reason);
          state.ready = null;
          state.disabledUntil = Date.now() + 10000;
        } else {
          try {
            ws.close();
          } catch (_) {
            // no-op
          }
        }
        finish(reject, new Error(reason));
      });

      ws.on('close', () => {
        state.socket = null;
        if (opened) {
          clearPending(`${kind}_ws_closed`);
          state.ready = null;
        } else {
          finish(reject, new Error(`${kind}_ws_closed_during_connect`));
        }
      });
    });

    state.ready = (async () => {
      let lastError = null;
      for (const url of urls) {
        try {
          await connectOne(url);
          state.disabledUntil = 0;
          return;
        } catch (err) {
          lastError = err;
        }
      }
      state.disabledUntil = Date.now() + 10000;
      throw lastError || new Error(`${kind}_ws_error:connect_failed`);
    })();

    try {
      await state.ready;
    } catch (err) {
      state.ready = null;
      throw err;
    }
  }

  async ensureAsrStream() {
    return this._ensureSocket('asr', '/api/abm/intelli/transcribe/ws');
  }

  async ensureAnalysisStream() {
    return this._ensureSocket('analysis', '/api/abm/intelli/analyze/ws');
  }

  async _closeSocket(kind) {
    const state = this._socketState(kind);
    if (state.socket) {
      try {
        state.socket.close();
      } catch (_) {
        // no-op
      }
    }
    state.socket = null;
    state.ready = null;
    for (const [, pending] of state.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error(`${kind}_ws_closed`));
    }
    state.pending.clear();
  }

  async closeAsrStream() {
    await this._closeSocket('asr');
  }

  async closeAnalysisStream() {
    await this._closeSocket('analysis');
  }

  async _sendSocketRequest(kind, payload, timeoutMs) {
    const state = this._socketState(kind);
    if (kind === 'analysis') {
      await this.ensureAnalysisStream();
    } else {
      await this.ensureAsrStream();
    }
    if (!state.socket || state.socket.readyState !== WebSocket.OPEN) {
      throw new Error(`${kind}_ws_not_open`);
    }
    const reqId = String(payload?.request_id || `${kind}_${Date.now()}_${state.reqSeq + 1}`);
    state.reqSeq += 1;
    const fullPayload = { ...payload, request_id: reqId };

    const resultPromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        state.pending.delete(reqId);
        reject(new Error(`${kind}_ws_timeout`));
      }, timeoutMs);
      state.pending.set(reqId, { resolve, reject, timer });
    });

    state.socket.send(JSON.stringify(fullPayload));
    return resultPromise;
  }

  async _sendSocketMessage(kind, payload) {
    const state = this._socketState(kind);
    if (kind === 'analysis') {
      await this.ensureAnalysisStream();
    } else {
      await this.ensureAsrStream();
    }
    if (!state.socket || state.socket.readyState !== WebSocket.OPEN) {
      throw new Error(`${kind}_ws_not_open`);
    }
    state.socket.send(JSON.stringify(payload || {}));
  }

  async _transcribeWavViaSocket(wavBuffer) {
    const out = await this._sendSocketRequest(
      'asr',
      {
        op: 'audio',
        content_type: 'audio/wav',
        audio_b64: Buffer.from(wavBuffer).toString('base64'),
      },
      20000,
    );
    return {
      success: Boolean(out?.success),
      transcript: String(out?.transcript || ''),
      confidence: out?.confidence,
      provider: String(out?.provider || 'deepgram'),
    };
  }

  async startAsrStream({
    model = 'nova-3',
    language = 'multi',
    encoding = 'linear16',
    sampleRate = 16000,
    channels = 1,
    interimResults = true,
    punctuate = true,
    smartFormat = true,
  } = {}) {
    const out = await this._sendSocketRequest(
      'asr',
      {
        op: 'stream_start',
        model,
        language,
        encoding,
        sample_rate: Number(sampleRate) || 16000,
        channels: Number(channels) || 1,
        interim_results: Boolean(interimResults),
        punctuate: Boolean(punctuate),
        smart_format: Boolean(smartFormat),
      },
      10000,
    );
    return {
      success: Boolean(out?.success),
      streamId: String(out?.stream_id || ''),
    };
  }

  async sendAsrPcmChunk(pcmBuffer) {
    const audio = Buffer.from(pcmBuffer || Buffer.alloc(0));
    if (!audio.length) return { success: true };
    await this._sendSocketMessage('asr', {
      op: 'audio_chunk',
      encoding: 'linear16',
      sample_rate: 16000,
      channels: 1,
      audio_b64: audio.toString('base64'),
    });
    return { success: true, bytes: audio.length };
  }

  async endAsrStream() {
    const out = await this._sendSocketRequest(
      'asr',
      {
        op: 'stream_end',
      },
      10000,
    );
    return {
      success: Boolean(out?.success),
    };
  }

  async _analyzeViaSocket({
    transcript,
    prompt,
    analysisType,
    maxCompletionTokens,
    pipelineId,
    eventId,
    model,
  }) {
    const out = await this._sendSocketRequest(
      'analysis',
      {
        op: 'analyze',
        transcript,
        prompt,
        analysis_type: analysisType || 'full',
        max_completion_tokens: maxCompletionTokens,
        pipeline_id: pipelineId || undefined,
        event_id: eventId || undefined,
        model: model || undefined,
      },
      180000,
    );
    return {
      success: Boolean(out?.success),
      analysis_type: out?.analysis_type || analysisType || 'full',
      model: out?.model || model || 'gpt-5-mini',
      parsed: out?.parsed || {},
      text: String(out?.text || ''),
      usage: out?.usage || {},
      context: out?.context || undefined,
    };
  }

  async _request(path, options = {}) {
    const cfg = this._config();
    const url = `${cfg.backendUrl}${path}`;
    const candidates = buildFallbackUrls(url);
    let response = null;
    let networkErr = null;
    for (const candidate of candidates) {
      try {
        response = await this.fetchImpl(candidate, options);
        networkErr = null;
        break;
      } catch (err) {
        networkErr = err;
      }
    }
    if (networkErr) {
      const message = String(networkErr?.message || networkErr || 'fetch failed');
      throw new Error(`Network error for ${path} via ${cfg.backendUrl}: ${message}`);
    }
    if (!response) {
      throw new Error(`Network error for ${path} via ${cfg.backendUrl}: empty response`);
    }
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(sanitizeErrorText(text, response.status));
    }
    const contentType = String(response.headers?.get?.('content-type') || '').toLowerCase();
    if (contentType.includes('application/json')) {
      return response.json();
    }
    return response.text();
  }

  async getReminders() {
    const cfg = this._config();
    const lookahead = Number(cfg.lookaheadMinutes || 30);
    return this._request(`/api/abm/intelli/reminders?lookahead_minutes=${encodeURIComponent(String(lookahead))}`, {
      method: 'GET',
      headers: this._headers(),
    });
  }

  async getUser() {
    return this._request('/user/me', {
      method: 'GET',
      headers: this._headers(),
    });
  }

  async getOrgs() {
    return this._request('/me/orgs', {
      method: 'GET',
      headers: this._headers(),
    });
  }

  async transcribeWav(wavBuffer) {
    return this._transcribeWavViaSocket(wavBuffer);
  }

  async analyze({ transcript, prompt, analysisType, maxCompletionTokens, pipelineId, eventId, model }) {
    return this._analyzeViaSocket({
      transcript,
      prompt,
      analysisType,
      maxCompletionTokens,
      pipelineId,
      eventId,
      model,
    });
  }

  async sessionStart({ sessionId, metadata }) {
    const out = await this._sendSocketRequest(
      'analysis',
      {
        op: 'session_start',
        session_id: sessionId,
        metadata: metadata || {},
      },
      20000,
    );
    return {
      success: Boolean(out?.success),
      session: out?.session || null,
    };
  }

  async sessionAppendEvent({ sessionId, type, payload, ts }) {
    const out = await this._sendSocketRequest(
      'analysis',
      {
        op: 'session_append',
        session_id: sessionId,
        event_type: type,
        payload: payload || {},
        ts: ts || undefined,
      },
      20000,
    );
    return {
      success: Boolean(out?.success),
      event_count: Number(out?.event_count || 0),
    };
  }

  async sessionEnd({ sessionId, metadata }) {
    const out = await this._sendSocketRequest(
      'analysis',
      {
        op: 'session_end',
        session_id: sessionId,
        metadata: metadata || {},
      },
      20000,
    );
    return {
      success: Boolean(out?.success),
      session: out?.session || null,
    };
  }

  async sessionGet(sessionId) {
    const out = await this._sendSocketRequest(
      'analysis',
      {
        op: 'session_get',
        session_id: sessionId,
      },
      20000,
    );
    return {
      success: Boolean(out?.success),
      session: out?.session || null,
    };
  }
}

module.exports = {
  HostedApiClient,
};
