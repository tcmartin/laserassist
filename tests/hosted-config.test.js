const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { normalizeConfig, HostedConfigStore } = require('../src/hosted-config');

test('normalizeConfig enforces defaults and bounds', () => {
  const cfg = normalizeConfig({
    backendUrl: 'http://127.0.0.1:8788///',
    frontendUrl: 'http://localhost:3100///',
    lookaheadMinutes: 999,
    analysisModel: '',
  });
  assert.equal(cfg.backendUrl, 'http://127.0.0.1:8788');
  assert.equal(cfg.frontendUrl, 'http://localhost:3100');
  assert.equal(cfg.lookaheadMinutes, 240);
  assert.equal(cfg.analysisModel, 'gpt-5-mini');
});

test('HostedConfigStore persists and validates config', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'intelli-cfg-'));
  const settingsPath = path.join(tempDir, 'settings.json');

  const store = new HostedConfigStore({ settingsPath });
  let cfg = store.get();
  assert.equal(cfg.backendUrl, 'http://127.0.0.1:8788');

  cfg = store.set({
    backendUrl: 'http://example.test/',
    frontendUrl: 'http://app.example.test/',
    tenantId: 'orgl',
    jwtToken: 'jwt',
    lookaheadMinutes: 15,
    analysisModel: 'gpt-5-nano',
  });

  assert.equal(cfg.backendUrl, 'http://example.test');
  assert.equal(cfg.frontendUrl, 'http://app.example.test');
  assert.equal(cfg.tenantId, 'orgl');
  assert.equal(cfg.jwtToken, 'jwt');
  assert.equal(cfg.lookaheadMinutes, 15);

  const reloaded = new HostedConfigStore({ settingsPath }).get();
  assert.equal(reloaded.backendUrl, 'http://example.test');
  assert.equal(reloaded.tenantId, 'orgl');

  const validation = new HostedConfigStore({ settingsPath }).validate();
  assert.equal(validation.ok, true);

  const bad = store.set({ tenantId: '', jwtToken: '' });
  const badValidation = store.validate(bad);
  assert.equal(badValidation.ok, false);
  assert.match(badValidation.errors.join(','), /tenantId/);
  assert.match(badValidation.errors.join(','), /jwtToken/);
});
