const fs = require('fs');
const path = require('path');

const DEFAULT_HOSTED_CONFIG = Object.freeze({
  backendUrl: 'https://api.laserreach.com',
  frontendUrl: 'https://laserreach.com',
  tenantId: '',
  jwtToken: '',
  analysisModel: 'gpt-5-mini',
  lookaheadMinutes: 30,
  defaultPipelineId: '',
});

function normalizeConfig(input = {}) {
  const lookaheadRaw = Number(input.lookaheadMinutes);
  const lookaheadMinutes = Number.isFinite(lookaheadRaw)
    ? Math.max(5, Math.min(240, Math.round(lookaheadRaw)))
    : DEFAULT_HOSTED_CONFIG.lookaheadMinutes;

  return {
    backendUrl: String(input.backendUrl || DEFAULT_HOSTED_CONFIG.backendUrl).trim().replace(/\/+$/, ''),
    frontendUrl: String(input.frontendUrl || DEFAULT_HOSTED_CONFIG.frontendUrl).trim().replace(/\/+$/, ''),
    tenantId: String(input.tenantId || '').trim(),
    jwtToken: String(input.jwtToken || '').trim(),
    analysisModel: String(input.analysisModel || DEFAULT_HOSTED_CONFIG.analysisModel).trim() || DEFAULT_HOSTED_CONFIG.analysisModel,
    lookaheadMinutes,
    defaultPipelineId: String(input.defaultPipelineId || '').trim(),
  };
}

class HostedConfigStore {
  constructor({ app, settingsPath } = {}) {
    this.app = app;
    this.settingsPath = settingsPath || null;
  }

  _getSettingsPath() {
    if (this.settingsPath) return this.settingsPath;
    if (this.app && typeof this.app.getPath === 'function') {
      return path.join(this.app.getPath('userData'), 'settings.json');
    }
    return path.join(process.cwd(), 'settings.json');
  }

  _readRoot() {
    const p = this._getSettingsPath();
    if (!fs.existsSync(p)) return {};
    try {
      return JSON.parse(fs.readFileSync(p, 'utf8')) || {};
    } catch {
      return {};
    }
  }

  _writeRoot(root) {
    const p = this._getSettingsPath();
    const dir = path.dirname(p);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    // The hosted settings file contains a bearer token. Keep both the
    // containing directory and file private even when the process umask is
    // permissive or an existing path was created with broader permissions.
    try { fs.chmodSync(dir, 0o700); } catch (_) {}
    try { fs.chmodSync(p, 0o600); } catch (_) {}
    fs.writeFileSync(p, JSON.stringify(root || {}, null, 2), { mode: 0o600 });
    try { fs.chmodSync(p, 0o600); } catch (_) {}
  }

  get() {
    const root = this._readRoot();
    return normalizeConfig(root.hosted || {});
  }

  set(next) {
    const merged = normalizeConfig({ ...this.get(), ...(next || {}) });
    const root = this._readRoot();
    root.hosted = merged;
    this._writeRoot(root);
    return merged;
  }

  validate(config = this.get()) {
    const errors = [];
    if (!config.backendUrl) errors.push('backendUrl is required');
    if (!config.tenantId) errors.push('tenantId is required');
    if (!config.jwtToken) errors.push('jwtToken is required');
    return {
      ok: errors.length === 0,
      errors,
      config,
    };
  }
}

module.exports = {
  DEFAULT_HOSTED_CONFIG,
  normalizeConfig,
  HostedConfigStore,
};
