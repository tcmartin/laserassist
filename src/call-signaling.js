'use strict';
const WebSocket = require('ws');

const CALL_ID = /^call_[0-9a-f]{64}$/;
const TERMINAL = new Set(['ended', 'failed', 'cancelled']);

class CallSignaling {
  constructor({ callId, getConfig, onUpdate = () => {}, onClose = () => {}, timeoutMs = 45000, pollMs = 500 }) {
    if (!CALL_ID.test(callId) || typeof getConfig !== 'function') throw new Error('call_signaling_invalid_config');
    this.callId = callId;
    this.getConfig = getConfig;
    this.onUpdate = onUpdate;
    this.onClose = onClose;
    this.lastState = 'prepared';
    this.timeoutMs = Math.max(100, Math.min(45000, timeoutMs));
    this.pollMs = Math.max(50, pollMs);
    this.socket = null;
    this.pending = null;
    this.closed = false;
    this.started = false;
    this.sequence = 0;
    this.queued = 0;
    this.chain = Promise.resolve();
    this.pollTimer = null;
    this.connectCancel = null;
    this.identity = this._identity();
  }

  _identity() {
    const config = this.getConfig() || {};
    if (!config.backendUrl || !config.tenantId || !config.jwtToken) throw new Error('call_signaling_auth_required');
    return JSON.stringify([config.backendUrl, config.tenantId, config.jwtToken]);
  }

  _check() {
    if (this.closed) throw new Error('call_signaling_closed');
    let current;
    try { current = this._identity(); } catch (_) { current = null; }
    if (current !== this.identity) {
      this.close();
      throw new Error('call_signaling_identity_changed');
    }
  }

  async _connect() {
    this._check();
    const [backendUrl, tenantId, jwtToken] = JSON.parse(this.identity);
    const url = new URL(backendUrl);
    if (!['https:', 'http:'].includes(url.protocol)) throw new Error('call_signaling_invalid_backend');
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.pathname = `/api/abm/intelli/calls/${this.callId}/media/ws`;
    url.search = '';
    url.hash = '';
    url.searchParams.set('tenant_id', tenantId);
    url.searchParams.set('token', jwtToken);
    const socket = this.socket = new WebSocket(url, { handshakeTimeout: 10000, maxPayload: 256 * 1024 });
    await new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error) => {
        if (settled) return;
        settled = true;
        this.connectCancel = null;
        if (error) reject(error); else resolve();
      };
      this.connectCancel = () => finish(new Error('call_signaling_closed'));
      socket.once('open', () => {
        try { this._check(); finish(); } catch (error) { finish(error); }
      });
      socket.on('message', (raw) => this._message(raw));
      socket.on('error', () => { finish(new Error('call_signaling_transport_failed')); this.close(); });
      socket.on('close', () => { finish(new Error('call_signaling_closed')); this.close(); });
    });
  }

  _message(raw) {
    try { this._check(); } catch (_) { return; }
    let result;
    try { result = JSON.parse(String(raw)); } catch (_) { this.close(); return; }
    if (!result || typeof result !== 'object') { this.close(); return; }
    if (!result.request_id && result.success === false) { this.close(); return; }
    if (!this.pending || result.request_id !== this.pending.id) return;
    const pending = this.pending;
    this.pending = null;
    clearTimeout(pending.timer);
    if (result.success === true && result.call_id !== this.callId) {
      pending.reject(new Error('call_signaling_scope_mismatch'));
      this.close();
      return;
    }
    if (result.success !== true) {
      const code = /^[a-z0-9_]{1,64}$/.test(result.error || '') ? result.error : 'request_failed';
      pending.reject(new Error(`call_signaling_${code}`));
      return;
    }
    pending.resolve(result);
    this.lastState = result.state;
    this.onUpdate(result);
    if (TERMINAL.has(result.state)) this.close();
  }

  _request(op, fields = {}) {
    try { this._check(); } catch (error) { return Promise.reject(error); }
    if (this.queued >= 128) return Promise.reject(new Error('call_signaling_queue_full'));
    const payload = JSON.stringify({ ...fields, op, call_id: this.callId, request_id: `media_${++this.sequence}` });
    if (Buffer.byteLength(payload) > 160 * 1024) return Promise.reject(new Error('call_signaling_payload_too_large'));
    this.queued += 1;
    const task = this.chain.then(() => {
      this._check();
      if (!this.socket || this.socket.readyState !== WebSocket.OPEN) throw new Error('call_signaling_not_open');
      return new Promise((resolve, reject) => {
        const id = JSON.parse(payload).request_id;
        const timer = setTimeout(() => {
          this.pending = null;
          reject(new Error('call_signaling_timeout'));
          this.close();
        }, this.timeoutMs);
        this.pending = { id, timer, resolve, reject };
        this.socket.send(payload, (error) => { if (error) this.close(); });
      });
    }).finally(() => { this.queued -= 1; });
    this.chain = task.catch(() => {});
    return task;
  }

  async start(offer) {
    this._check();
    if (this.started) throw new Error('call_signaling_already_started');
    this.started = true;
    try {
      await this._connect();
      const result = await this._request('start', { offer });
      this._schedulePoll();
      return result;
    } catch (error) { this.close(); throw error; }
  }

  trickle(candidate) { return this._request('trickle', { candidate }); }

  _schedulePoll() {
    if (this.closed) return;
    this.pollTimer = setTimeout(async () => {
      try {
        await this._request('poll', { timeout: 0.2 });
        this._schedulePoll();
      } catch (_) { this.close(); }
    }, this.pollMs);
  }

  async end() {
    clearTimeout(this.pollTimer);
    try { return await this._request('end'); } finally { this.close(); }
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.pollTimer);
    if (this.connectCancel) this.connectCancel();
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.reject(new Error('call_signaling_closed'));
      this.pending = null;
    }
    const socket = this.socket;
    this.socket = null;
    if (socket && socket.readyState !== WebSocket.CLOSED) socket.terminate();
    this.onClose({ call_id: this.callId, state: this.lastState });
  }
}

module.exports = { CallSignaling };
