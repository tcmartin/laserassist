const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
test('standalone main has no desktop calling media IPC surface', () => {
  const source = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
  assert.doesNotMatch(source, /function\s+(?:mediaPayload|startCallingMedia|currentCallingMedia)\b/);
  assert.doesNotMatch(source, /CallSignaling|calling-media-(?:start|trickle|end|close)/);
});
