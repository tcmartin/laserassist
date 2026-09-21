# Standalone synthetic speech fixtures

Generated locally on 2026-09-20 with cached Kokoro v1.0 ONNX, voice `am_michael`. Mono PCM16 WAV, 24 kHz. No customer audio and no synthesis provider calls during tests. These files are excluded from packaged Intelli builds with the rest of `tests/`.

- `standalone-buyer.wav`: 7.659 seconds. “Our biggest problem is following up after a sales call. The notes are scattered, and we often lose track of the next step.” SHA-256 `a764746cf1ffec5d68267b646e94da40e57d4362d3257c28eedb9473f9b0145f`.
- `standalone-buyer-followup.wav`: 8.043 seconds. A follow-up request for a clear owner, summary, and next action. SHA-256 `b31046bfa33030cffef9976fd6ce4804ffd22a192e404abaa0f2108b4a39593d`.

The opt-in test adds distinct marker tones to the speech at runtime to verify each input independently. HTTP/ASR/coaching responses use local deterministic fixtures; this test does not prove provider speech recognition or native OS capture.
