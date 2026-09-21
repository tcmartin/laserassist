# Electron dialer signaling validation — 2026-09-20

The opt-in test `tests/electron-dialer-signaling.test.js` exercises the real
Electron IPC and signaling path against a local backend. It starts the actual
Gunicorn/Flask-Sockets application, registered media WebSocket route,
`CallMediaController`, durable call store, and native worker. The bootstrap
replaces only the trusted Janus adapter factory with an in-process fake;
Janus, SIP, payment, ASR, and completion providers are never contacted.

Run with the pinned local dependencies:

```sh
DDB_LOCAL_ENDPOINT=http://127.0.0.1:8000 \
RUN_INTELLI_DIALER_E2E=1 \
node --test tests/electron-dialer-signaling.test.js
```

The fixture provisions two prepared local-test calls and an owned local caller
asset, then verifies Electron `callingMediaStart`, ICE trickle, explicit end,
disconnect cleanup, durable `ended` state, and rejection of a foreign actor
before fake-provider start. It asserts that both authorized calls produce one
fake start/end and that the foreign attempt produces no provider start.

The backend route constructs the DynamoDB-backed controller inside a dedicated
serialized native worker. This keeps gevent-patched DynamoDB clients on one
native thread while preserving bounded operation deadlines and cleanup.

The test is skipped by default in `npm test` because it requires a local
DynamoDB-compatible endpoint, Redis, the pinned Python backend environment,
and an Electron binary. It has a 120-second test deadline and removes the
temporary backend bootstrap, profile, state file, and DynamoDB fixtures in
`finally` cleanup.

The test reads the final call snapshots directly from the local DynamoDB table
because the fixture does not provision production RBAC grants for the separate
authenticated HTTP read endpoint. This is a signaling/control-plane check. It
does not prove Janus protocol interoperability, media RTP, microphone capture,
or real provider billing.
