const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

class SessionStorageManager {
  constructor(baseDir) {
    this.baseDir = baseDir;
    this.sessionsDir = path.join(baseDir, 'sessions');
    this._ensureDirSync(this.sessionsDir);
  }

  _ensureDirSync(dir) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  _sessionDir(sessionId) {
    return path.join(this.sessionsDir, sessionId);
  }

  async startSession(sessionId, metadata = {}) {
    const dir = this._sessionDir(sessionId);
    await fsp.mkdir(dir, { recursive: true });
    const meta = {
      id: sessionId,
      createdAt: new Date().toISOString(),
      ...metadata
    };
    await fsp.writeFile(path.join(dir, 'metadata.json'), JSON.stringify(meta, null, 2));
    // Touch log files so they exist early
    await fsp.appendFile(path.join(dir, 'transcript.ndjson'), '');
    await fsp.appendFile(path.join(dir, 'analysis.ndjson'), '');
  }

  async appendTranscript(sessionId, segment) {
    const dir = this._sessionDir(sessionId);
    const line = JSON.stringify({ type: 'transcript', ts: new Date().toISOString(), ...segment }) + '\n';
    await fsp.appendFile(path.join(dir, 'transcript.ndjson'), line);
  }

  async appendAnalysis(sessionId, entry) {
    const dir = this._sessionDir(sessionId);
    const line = JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n';
    await fsp.appendFile(path.join(dir, 'analysis.ndjson'), line);
  }

  async endSession(sessionId, extra = {}) {
    const dir = this._sessionDir(sessionId);
    const metaPath = path.join(dir, 'metadata.json');
    try {
      const current = JSON.parse(await fsp.readFile(metaPath, 'utf8'));
      current.endedAt = new Date().toISOString();
      Object.assign(current, extra);
      await fsp.writeFile(metaPath, JSON.stringify(current, null, 2));
    } catch {
      // If metadata missing, write minimal
      const meta = { id: sessionId, endedAt: new Date().toISOString(), ...extra };
      await fsp.writeFile(metaPath, JSON.stringify(meta, null, 2));
    }
  }
}

module.exports = SessionStorageManager;

