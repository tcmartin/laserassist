const test = require('node:test');
const assert = require('node:assert/strict');

const {
  clampFloatToInt16,
  float32ToPcm16Buffer,
  buildWavBufferFromPcm16,
  resampleTo16k,
  HostedAudioTranscriber,
} = require('../src/hosted-audio');

test('PCM conversion helpers produce expected sizes and headers', () => {
  assert.equal(clampFloatToInt16(2), 32767);
  assert.equal(clampFloatToInt16(-2), -32768);

  const pcm = float32ToPcm16Buffer(new Float32Array([0, 0.5, -0.5]));
  assert.equal(pcm.length, 6);

  const wav = buildWavBufferFromPcm16(pcm, 16000, 1, 16);
  assert.equal(wav.slice(0, 4).toString('ascii'), 'RIFF');
  assert.equal(wav.slice(8, 12).toString('ascii'), 'WAVE');
  assert.equal(wav.length, 44 + 6);
});

test('resampleTo16k downsamples from 48k', () => {
  const src = new Float32Array(4800);
  for (let i = 0; i < src.length; i += 1) src[i] = Math.sin(i / 30);
  const { data } = resampleTo16k(src, 48000, { phase: 0 });
  assert.ok(data.length > 0);
  assert.ok(data.length < src.length);
});

test('HostedAudioTranscriber emits transcript and no ASR errors in happy path', async () => {
  const transcripts = [];
  const ops = [];
  const errors = [];

  const transcriber = new HostedAudioTranscriber({
    transcribeFn: async () => ({ transcript: 'captured sentence' }),
    onTranscript: (msg) => {
      ops.push(msg.op);
      transcripts.push(msg.text);
    },
    onError: (msg) => errors.push(msg.message),
    flushIntervalMs: 50,
    minBytes: 4000,
  });

  transcriber.start({ sampleRate: 16000, flushIntervalMs: 50 });

  for (let i = 0; i < 8; i += 1) {
    const chunk = new Float32Array(4096);
    for (let j = 0; j < chunk.length; j += 1) {
      chunk[j] = Math.sin((i * chunk.length + j) / 20);
    }
    transcriber.addFloat32Chunk(chunk);
  }

  await new Promise((resolve) => setTimeout(resolve, 150));
  await transcriber.stop();

  assert.equal(errors.length, 0);
  assert.ok(transcripts.length >= 1);
  assert.equal(ops[0], 'transcript');
  assert.equal(transcripts[0], 'captured sentence');
});
