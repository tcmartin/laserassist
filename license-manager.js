const fs = require('fs');
const path = require('path');

class LicenseManager {
  constructor(baseDir) {
    this.baseDir = baseDir;
    this.licensePath = path.join(baseDir, 'license.json');
    this.cache = null;
  }

  load() {
    try {
      if (fs.existsSync(this.licensePath)) {
        this.cache = JSON.parse(fs.readFileSync(this.licensePath, 'utf8'));
      } else {
        this.cache = { key: null, valid: false, tier: 'free' };
      }
    } catch (_) {
      this.cache = { key: null, valid: false, tier: 'free' };
    }
    return this.cache;
  }

  save(lic) {
    this.cache = lic;
    fs.mkdirSync(this.baseDir, { recursive: true });
    fs.writeFileSync(this.licensePath, JSON.stringify(lic, null, 2));
  }

  validateKey(key) {
    // Placeholder offline validation: accept basic pattern INS-XXXXXXXX
    if (!key || typeof key !== 'string') return { valid: false, reason: 'Empty key' };
    const ok = /^INS-[A-Z0-9]{8,}/i.test(key.trim());
    return ok ? { valid: true, tier: 'pro' } : { valid: false, reason: 'Invalid format' };
  }

  getStatus() {
    if (!this.cache) this.load();
    return this.cache;
  }

  setKey(key) {
    const res = this.validateKey(key);
    if (res.valid) {
      const lic = { key, valid: true, tier: res.tier };
      this.save(lic);
      return { success: true, license: lic };
    }
    return { success: false, error: res.reason || 'Invalid key' };
  }

  clear() {
    const lic = { key: null, valid: false, tier: 'free' };
    this.save(lic);
    return lic;
  }
}

module.exports = LicenseManager;

