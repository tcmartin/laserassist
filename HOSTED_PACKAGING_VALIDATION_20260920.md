# Hosted Intelli packaging validation — 2026-09-20

This record covers the hosted-only Intelli desktop package. The validation worktree is:

`/Users/trevormartin/.codex/worktrees/laserreach-visibility-calling/intelli`

Branch: `codex/intelli-calling-20260920`

## Changes

- The start script invokes the project-local Electron binary directly, which prevents an implicit dependency download and uses the lockfile-pinned Electron package after `npm ci`.
- Electron-builder excludes tests, documentation, local model/ASR assets, legacy local workers, MCP sources, and build helpers from the shipped application.
- Auth contract tests no longer assume a sibling `laserreach_front` checkout. They verify the Electron browser capture and hosted configuration contract from Intelli itself.
- The Electron smoke test launches the real binary when the installed dependency is available, waits for the hosted renderer-ready marker, and uses a disposable user-data directory.
- Hosted audio startup/stop now waits for stream readiness before the final partial flush and ignores callbacks from superseded recording sessions.
- Hosted ASR and analysis WebSocket connections now carry an auth/org URL key and generation guard. Reconnects close the old channel, reject pending requests, and ignore late events from replaced or cancelled sockets.
- The unsigned macOS app bundle was inspected with `asar`; it contains only the hosted entrypoints, hosted source modules, `ws`, and required assets.

## Hosted runtime contract

The packaged app uses `src/hosted-client.js`, `src/hosted-audio.js`, and `src/hosted-config.js`. Browser sign-in, organization selection, content protection, hosted Deepgram transcription, GPT-5-mini analysis, and session event teardown remain in the active runtime. Local model and local ASR paths are excluded from the production package. Website dialer behavior is outside this standalone desktop runtime.

Fresh installations default to `https://api.laserreach.com` for the backend and `https://laserreach.com` for browser authentication. Explicit local URLs remain valid configuration overrides. Hosted settings are written with private directory (`0700`) and file (`0600`) permissions because they contain the bearer token.

Changing the hosted identity or organization drains the current audio stream and closes both WebSocket channels before saving the new configuration. The renderer clears its local session without sending a session-end event through the replacement tenant, which prevents pending audio or session events from crossing an organization boundary.

## Verification

| Check | Result |
| --- | --- |
| `node --check main.js` | Passed |
| Hosted config/auth lifecycle tests | Production defaults, explicit local overrides, `0600` settings-file permissions, identity teardown, and tenant-scoped session guards are covered; focused config behavior passed in the full suite. |
| `node --test tests/hosted-lifecycle.test.js` | 6 real loopback lifecycle tests passed, covering audio startup/stop, reentrant sessions, ASR reconnect/close, and analysis session reconnect. |
| `npm test` | 27 tests: all passed with Electron installed from the existing lockfile. |
| `npm run test:electron` | 2 tests passed, including the real source Electron startup smoke. |
| `npm run build-check` | Packaging succeeds with `CSC_IDENTITY_AUTO_DISCOVERY=false`; default signing fails on this host with `errSecInternalComponent` for the configured identity. |
| Built app smoke | After the lifecycle changes, the rebuilt `dist/mac-arm64/Laserreach Intelli.app/Contents/MacOS/Laserreach Intelli` reached `[intelli] startup smoke ready` and exited 0 with a disposable user-data directory. |

The real Electron launch path is covered by `tests/electron-startup.test.js` and was run here with the lockfile-installed dependency. The loopback lifecycle tests use a local `ws` server and do not call production services. The Electron smoke test does not perform network login or call production services; its auth assertions are source-level contract checks rather than an end-to-end provider login.
