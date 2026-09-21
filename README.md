# Laserreach Intelli

Laserreach Intelli is the hosted desktop overlay for live call context. It runs as an Electron bar that stays available above the call window and sends audio and transcript context to the Laserreach backend.

The packaged runtime uses hosted services:

- Deepgram handles live speech recognition through the hosted HTTP and WebSocket endpoints.
- The configured backend model handles call analysis and coaching responses.
- Browser sign-in captures the authenticated token inside the Electron login window. The selected organization is stored with the hosted configuration.
- Session start, transcript events, analysis events, and session end are sent to the hosted session API.

No local model, model download, MCP server, or local ASR process is required by the packaged app. Legacy source files remain in the repository for historical reference and are excluded from Electron packages.

**Call** opens the contact search, caller number and script workspace. Review prepares a frozen contact/script snapshot; **Start call** begins audio and signaling. User and local-agent templates can be selected and edited. The call mixes microphone and received audio for transcription. Number checkout displays server-configured availability and pricing.

This is a validated development increment. Live calling requires the matching backend and provider configuration; live number purchases remain disabled pending billing lifecycle and pricing setup. Signing, notarization and production release are not complete. See `docs/DIALER_UI_DESIGN_20260920.md` for validation and remaining work.

## Run locally

Requirements: Node.js 18 or newer and npm.

```bash
npm ci
npm start
```

`npm start` uses the Electron version from the lockfile and refuses to download a replacement at runtime. It uses a temporary project-local user-data directory for development. Installed builds default to `https://api.laserreach.com` and `https://laserreach.com`; explicit local backend/frontend URLs remain supported through the overlay configuration.

The overlay opens with:

- macOS: `Cmd+Shift+Space`
- Windows/Linux: `Ctrl+Shift+Space`

Select **Sign in** in the bar. The browser window handles login and organization selection. The bar never asks users to paste a JWT. Sign out clears the stored hosted credentials and the active call state.

## Validate

```bash
npm test
npm run test:electron
npm run build-check
```

The Electron startup test launches the real Electron binary with a disposable user-data directory, waits for the renderer to finish loading, and then terminates the smoke process. It is skipped with an explicit reason when dependencies have not been installed. `npm test` contains the hosted client, hosted audio, session lifecycle, auth, and overlay contract tests.

## Package

```bash
npm run build-mac
npm run build-check-linux
npm run build-check-win
```

The builder includes the hosted runtime, dialer UI, assets, and `src/` modules. Tests, documentation, local model/ASR files, old MCP/local-worker sources, and build helpers are excluded from the application package. `npm run build` and `npm run build-dmg` use this same configuration and never install dependencies during the build.

## Runtime layout

```text
main.js                 Electron lifecycle, auth window, overlay and hosted IPC
preload.js              Context-isolated renderer API
index.html              Overlay UI and hosted auth/org/session controls
src/hosted-config.js    Persisted hosted backend/org configuration
src/hosted-client.js    HTTP/WebSocket client for hosted ASR, analysis and sessions
src/hosted-audio.js     PCM buffering and hosted transcription adapter
src/calling-client.js   Named authenticated calling HTTP operations
src/call-signaling.js   One-call WebSocket lifecycle and bounded signaling
src/call-media.js       WebRTC microphone/remote audio and transcription mix
src/dialer-ui.js        Contact, script, review, call and purchase controls
tests/                  Node test suite and real Electron startup smoke
```

The backend contract and rollout decisions are documented in `../backend/docs/CALLING_RELEASE_DESIGN_20260920.md` in the coordinated release worktree.
