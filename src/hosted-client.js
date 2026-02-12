function sanitizeErrorText(text, status) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return `HTTP ${status}`;
  return `HTTP ${status}: ${trimmed.slice(0, 800)}`;
}

class HostedApiClient {
  constructor({ fetchImpl, getConfig }) {
    this.fetchImpl = fetchImpl || fetch;
    this.getConfig = getConfig;
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

  async _request(path, options = {}) {
    const cfg = this._config();
    const url = `${cfg.backendUrl}${path}`;
    const response = await this.fetchImpl(url, options);
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
    return this._request('/api/abm/intelli/transcribe', {
      method: 'POST',
      headers: this._headers({ 'Content-Type': 'audio/wav' }),
      body: wavBuffer,
    });
  }

  async analyze({ transcript, prompt, analysisType, maxCompletionTokens, pipelineId, eventId, model }) {
    return this._request('/api/abm/intelli/analyze', {
      method: 'POST',
      headers: this._headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        transcript,
        prompt,
        analysis_type: analysisType || 'full',
        max_completion_tokens: maxCompletionTokens,
        pipeline_id: pipelineId || undefined,
        event_id: eventId || undefined,
        model: model || undefined,
      }),
    });
  }

  async sessionStart({ sessionId, metadata }) {
    return this._request('/api/abm/intelli/sessions/start', {
      method: 'POST',
      headers: this._headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ session_id: sessionId, metadata: metadata || {} }),
    });
  }

  async sessionAppendEvent({ sessionId, type, payload, ts }) {
    return this._request(`/api/abm/intelli/sessions/${encodeURIComponent(sessionId)}/events`, {
      method: 'POST',
      headers: this._headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ type, payload: payload || {}, ts: ts || undefined }),
    });
  }

  async sessionEnd({ sessionId, metadata }) {
    return this._request(`/api/abm/intelli/sessions/${encodeURIComponent(sessionId)}/end`, {
      method: 'POST',
      headers: this._headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ metadata: metadata || {} }),
    });
  }

  async sessionGet(sessionId) {
    return this._request(`/api/abm/intelli/sessions/${encodeURIComponent(sessionId)}`, {
      method: 'GET',
      headers: this._headers(),
    });
  }
}

module.exports = {
  HostedApiClient,
};
