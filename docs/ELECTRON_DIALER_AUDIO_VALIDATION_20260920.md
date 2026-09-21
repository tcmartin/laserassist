# Electron dialer audio validation — 2026-09-20

This diagnostic exercises the actual `index.html` dialer path with the local
generated `buyer.wav` fixture. A renderer override supplies the fixture through
`getUserMedia`, creates a second real Chromium `RTCPeerConnection`, and posts
its SDP answer to a local test mailbox. The backend route, durable call store,
native serialization boundary, Electron IPC, `CallMedia`, ASR hook, and
coaching panel hook remain in the execution path.

The test proxy forwards HTTP and the media WebSocket to the local Gunicorn
server. It supplies deterministic ASR and analysis WebSocket responses. The
backend adapter is a test-only local fake; no Janus, SIP, phone, payment, ASR,
or completion provider is contacted. Only counts, states, and bounded audio
metrics are written to
`output/calling-validation-20260920/dialer-audio/result.json` and
`stdout.log`; tokens and SDP are excluded.

## Validation commands

```sh
node --check tests/electron-dialer-audio.test.js
node --test tests/electron-dialer-audio.test.js
RUN_INTELLI_DIALER_AUDIO_E2E=1 DDB_LOCAL_ENDPOINT=http://127.0.0.1:8000 \
  node --test tests/electron-dialer-audio.test.js
```

The final opt-in run passed in **30.97 seconds** (31.08 seconds including the
Node runner). It used local DynamoDB at `http://127.0.0.1:8000`; the harness
provisioned required tables and deleted its unique tenant's calling records
and people/user fixtures during teardown. Redis used a disposable local port.

Observed evidence:

- Actual contact selection, script review, call start and end in `index.html`.
- One fake-provider start, end and close; durable call state `ended`.
- A second Chromium peer accepted the browser offer and returned its answer
  through the real backend media WebSocket and unchanged Electron IPC.
- The peer reached `connected` with actual bidirectional RTP: 964 received
  audio bytes and 925 sent audio bytes at the assertion checkpoint.
- Generated speech reached ASR transport in 14 PCM chunks; maximum absolute
  normalized sample amplitude was 0.36768.
- One automatic coaching request completed. The test inspected the overlay
  renderer and asserted the expected summary text, beyond panel creation.
- ASR start/end each occurred once; generated audio resources were closed.
- Zero external provider, Janus, SIP, or purchase calls.

The proxy supplies the transcript and coaching response. This proves the
combined application path, not speech-recognition accuracy, model quality,
real telephone interoperability, signing, or distribution. Independent
provider and isolated two-way-media checks are documented separately.

Earlier fixture failures were corrected before this run:

1. The first fixture returned 403 for people/scripts/numbers because the test
   bootstrap patched `authorize` after decorators had already been imported.
2. The second reached authenticated people and options requests, but scripts
   returned 400, numbers returned 503, and call-context returned 422. These
   failures were caused by missing test-only authorized-org propagation and by
   patching only `intelli_session_routes.resolve_call_context`; the calling
   blueprint owns the active resolver. The fixture now installs a bounded
   no-op RBAC decorator that sets the authorized org from the authenticated
   header and patches both calling/session context resolvers before app import.

3. The panel lookup omitted CDP's `awaitPromise`, causing a timeout despite
   successful audio transport. The assertion now awaits the IPC result and
   additionally checks rendered coaching content. End-state verification uses
   the call created by the UI rather than an unrelated preseeded call.

No application runtime code was changed for this diagnostic. The test does
not replace frozen contextBridge methods. It supplies only microphone media,
test authorization/context fixtures, provider signaling and AI responses.
