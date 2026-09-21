# Laserreach Intelli

Laserreach Intelli is a hosted standalone desktop assistant. It runs as an Electron bar that stays available above other windows and sends captured audio and transcript context to the Laserreach backend.

The packaged runtime uses hosted services:

- Deepgram handles live speech recognition through the hosted HTTP and WebSocket endpoints.
- The configured backend model handles live coaching and analysis responses.
- Browser sign-in captures the authenticated token inside the Electron login window. The selected organization is stored with the hosted configuration.
- Session start, transcript events, analysis events, and session end are sent to the hosted session API.

No local model, model download, MCP server, or local ASR process is required by the packaged app. Legacy source files remain in the repository for historical reference and are excluded from Electron packages.

**Start** requests microphone and system audio for live transcription and coaching.
Settings also offers **Microphone only**. System capture requires OS permission;
if no system audio track is supplied, Intelli reports the failure. Summary,
meeting, transcript, and Ask panels expose the hosted analysis and session
history. Website calling and number management are separate product surfaces.

This is a validated development increment. Website calling and number
management require their matching backend and provider configuration. Signing,
notarization and production release are not complete. See
`docs/INTELLI_STANDALONE_SCOPE_20260920.md` for the desktop boundary.

## Run locally

Requirements: Node.js 22.12 or newer and npm.

```bash
npm ci
npm start
```

`npm start` uses the Electron version from the lockfile and refuses to download a replacement at runtime. It uses a temporary project-local user-data directory for development. Installed builds default to `https://api.laserreach.com` and `https://laserreach.com`; explicit local backend/frontend URLs remain supported through the overlay configuration.

The overlay opens with:

- macOS: `Cmd+Shift+Space`
- Windows/Linux: `Ctrl+Shift+Space`

Select **Sign in** in the bar. The browser window handles login and organization selection. The bar never asks users to paste a JWT. Sign out clears the stored hosted credentials and the active assistant session.

## Validate

```bash
npm test
npm run test:electron
RUN_INTELLI_STANDALONE_AUDIO_E2E=1 node --test tests/electron-standalone-audio.test.js
npm run build-check
```

The Electron startup test launches the real Electron binary with a disposable user-data directory, waits for the renderer to finish loading, and then terminates the smoke process. It is skipped with an explicit reason when dependencies have not been installed. `npm test` contains the hosted client, hosted audio, session lifecycle, auth, and overlay contract tests.

## Package

```bash
npm run build-mac
npm run build-check-linux
npm run build-check-win
```

The builder includes the hosted runtime, assistant assets, and `src/` modules. Tests, documentation, local model/ASR files, old MCP/local-worker sources, and build helpers are excluded from the application package. `npm run build` and `npm run build-dmg` use this same configuration and never install dependencies during the build.

## Runtime layout

```text
main.js                 Electron lifecycle, auth window, overlay and hosted IPC
preload.js              Context-isolated renderer API
index.html              Overlay UI and hosted auth/org/session controls
src/hosted-config.js    Persisted hosted backend/org configuration
src/hosted-client.js    HTTP/WebSocket client for hosted ASR, analysis and sessions
src/hosted-audio.js     PCM buffering and hosted transcription adapter
src/desktop-audio.js    Microphone/system capture ownership and audio mixing
src/display-capture.js  Trusted-window system capture permission handler
src/calling-client.js   Website migration module retained outside Intelli runtime
src/call-signaling.js   Website migration signaling module retained outside Intelli runtime
src/call-media.js       Website migration media module retained outside Intelli runtime
src/dialer-ui.js        Website migration UI retained outside Intelli runtime
tests/                  Node test suite and real Electron startup smoke
```

The backend contract and rollout decisions are documented in `../backend/docs/CALLING_RELEASE_DESIGN_20260920.md` in the coordinated release worktree.
