# Standalone Intelli audio validation

`tests/electron-standalone-audio.test.js` is an opt-in Electron boundary test
for the standalone Intelli `Start`/`Stop` path. It does not modify the runtime
capture implementation and does not contact Deepgram, OpenAI, or another
provider.

The test starts the real Electron app and a local HTTP/WebSocket fixture. CDP
injects two generated `AudioContext` streams into the renderer capture APIs:

- `getUserMedia()` receives `buyer.wav` with a 220 Hz marker tone.
- `getDisplayMedia()` receives `buyer-followup.wav` with an 880 Hz marker tone
  and a synthetic canvas video track to match display-capture requests.

The fixture records streamed PCM and returns deterministic transcript and
analysis messages. During one listening session the test measures three
independent phases: both sources enabled, microphone muted, and display audio
muted. Each phase must deliver non-silent PCM, and the 220 Hz microphone marker
or 880 Hz display marker must dominate its corresponding single-source phase.
It then verifies automatic coaching, the `ai_coach_live` overlay, one ASR
start/end pair, one session start/end pair, and ended capture tracks after
`Stop`.

Run it only after the Electron runtime capture work is present:

```sh
RUN_INTELLI_STANDALONE_AUDIO_E2E=1 node --test tests/electron-standalone-audio.test.js
```

The injected display stream proves browser boundary wiring and mixed-source
behavior. It does not prove that macOS supplies real system audio or that the
OS capture permission path works; those require a separate signed/native smoke
test.

The default test run skips this diagnostic because it launches Electron and
uses the cached generated audio corpus.

## Validation result

On 2026-09-20, the opt-in run passed against Electron `44.4.3`:

```text
[standalone-audio-e2e] asr_starts=1 asr_ends=1 chunks=15 analyses=1 mic_capture=1 display_capture=1 provider_calls=0 os_system_capture=false
1 passed, 0 failed
```

The same session delivered non-silent PCM with both sources enabled, after
muting the microphone while display audio remained active, and after muting
display audio while the microphone remained active. Stop ended all injected
tracks and the single ASR/session lifecycle. The run used a local fixture and
CDP-injected streams; it did not make provider calls or prove OS-level system
capture.
