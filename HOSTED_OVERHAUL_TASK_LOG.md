# Hosted-Only Intelli Overhaul Task Log

## Goal
Replace Intelli local runtime with a strict hosted runtime:
- No local ASR models.
- No local LLM models.
- All transcription and analysis requests go through Laserreach backend APIs.
- Backend URL configurable, defaulting to `http://localhost:8788`.

## Task List
- [x] Task 1: Remove local runtime dependencies and design hosted-only runtime modules.
- [x] Task 2: Rewrite Electron main process to hosted-only IPC + audio streaming.
- [x] Task 3: Rewrite renderer UX to clean bubble-based call intelligence layout.
- [x] Task 4: Build thorough automated tests (unit + integration with mock backend).
- [x] Task 5: Validate desktop packaging and runtime launch behavior.
- [x] Task 6: Run UI smoke checks via Playwright on the new interface.

## Task 1: Hosted Runtime Modules
### Changes
- Added `src/hosted-config.js`.
- Added `src/hosted-client.js`.
- Added `src/hosted-audio.js`.

### Notes
- Config now defaults to hosted backend local URL.
- Audio transcriber streams PCM chunks, builds WAV payloads, and calls backend transcription endpoint.

### Result
- PASS

## Task 2: Main Process Rewrite
### Changes
- Replaced `main.js` with hosted-only runtime:
- No `llm-worker`, no local model downloader/runtime, no local ASR bridge.
- IPC handlers for hosted config, reminders, analyze, transcript, and session endpoints.
- Audio pipeline wired to backend `/api/abm/intelli/transcribe`.

### Result
- PASS

## Task 3: Renderer UX Rewrite
### Changes
- Replaced `index.html` with a clean, professional, bubble-oriented UI:
- Conversation Timeline panel.
- Insight Bubbles panel with reusable cards.
- Reminder strip for upcoming meetings.
- Hosted settings modal for backend URL / tenant / JWT / model.
- Added browser fallback shim for testability when `window.electronAPI` is absent.
- Added favicon reference to avoid unnecessary UI console errors.

### Result
- PASS

## Task 4: Automated Tests
### Added tests
- `tests/hosted-config.test.js`
- `tests/hosted-client.test.js`
- `tests/hosted-audio.test.js`
- `tests/hosted-runtime.integration.test.js`

### Test command
- `npm test`

### Coverage focus
- Config normalization/persistence/validation.
- Hosted API contract (headers, endpoints, payloads).
- Audio conversion/resampling/WAV packaging.
- End-to-end hosted flow with mock backend: reminders + live transcription + analysis + session writes.

### Result
- PASS (7/7 tests)

## Task 5: Packaging + Runtime Validation
### Commands
- `node --check main.js`
- `node --check preload.js`
- `npm run build-check-all`
- `npm start` (manual smoke launch)

### Result
- PASS

## Task 6: UI Smoke via Playwright
### Steps executed
- Served app over HTTP for browser-driven smoke checks.
- Opened UI, verified reminders rendered.
- Triggered prompt path and confirmed bubble creation.
- Opened settings modal and saved config.

### Result
- PASS

## Known Constraints
- Browser fallback shim in `index.html` is for automated UI smoke tests only. In real Electron runtime, IPC-backed `window.electronAPI` is used.
- `npm start` exits with SIGINT in logs because test runner intentionally terminated the process after smoke verification.
