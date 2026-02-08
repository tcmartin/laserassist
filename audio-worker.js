const { parentPort } = require('worker_threads');

parentPort.on('message', (f32) => {
  // Use setImmediate to yield control and prevent blocking
  setImmediate(() => {
    try {
      // Convert Float32 [-1,1] to Int16 LE bytes
      const len = f32.length;
      const i16 = new Int16Array(len);
      for (let i = 0; i < len; i++) {
        const s = Math.max(-1, Math.min(1, f32[i] || 0));
        i16[i] = s < 0 ? (s * 32768) : (s * 32767);
      }
      const bytes = Buffer.from(i16.buffer, i16.byteOffset, i16.byteLength);
      const b64 = bytes.toString('base64');
      parentPort.postMessage(b64);
    } catch (err) {
      console.error('Audio worker processing error:', err);
    }
  });
});
