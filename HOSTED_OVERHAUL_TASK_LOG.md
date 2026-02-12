# Hosted-Only Intelli Overhaul Task Log

## Goal
Deliver Intelli as a hosted-only in-call sales intelligence overlay:
- No local ASR model path.
- No local LLM model path.
- Backend-driven Deepgram transcription.
- Backend-driven GPT-5-mini analysis.
- Compact control-bar UX with dynamic floating intelligence panels.
- Non-technical sign-in flow (browser login, automatic token capture).

## Current State
- Hosted-only runtime modules are active (`src/hosted-config.js`, `src/hosted-client.js`, `src/hosted-audio.js`).
- `main.js` and `preload.js` use hosted IPC contract (auth/reminders/asr/analyze/sessions/panels).
- `index.html` provides compact transparent bar UI with dynamic panel actions.
- Workspace/org selection is available in settings via `/me/orgs` (`auth-list-orgs`).
- No manual JWT entry is required in UI.

## Validation
- Intelli tests: `npm test` -> PASS (`12/12`).
- Packaging checks: `npm run build-check-all` -> PASS (mac/linux/win unpacked targets).
- Smoke launch: `npm start` -> PASS (startup without captured errors during smoke interval).
- Backend regression set (run from `laserreach/`):
- `conda run -n py311 pytest -q tests/test_intelli_service.py tests/test_intelli_routes.py tests/test_abm_agent_linkedin_tools.py tests/test_slack_events.py tests/test_slack_sensitive_actions_settings.py` -> PASS (`32/32`).

## Added/Updated Tests
- `tests/hosted-client.test.js` (added `getUser()` + `getOrgs()` coverage).
- `tests/overlay-shell.test.js` (overlay UX contract + hosted-only main contract + no token input invariant).

## Notes
- Legacy local-mode files may still exist historically in repo, but active runtime path is hosted-only.
- Default backend remains `http://localhost:8788` for local development against Laserreach backend.

## 2026-02-12 UI Accessibility Patch
- Fixed initial overlay control accessibility by making toolbar responsive and wrap-safe.
- `index.html`:
- Converted bar layout to CSS grid with responsive breakpoints.
- Enabled control wrapping and left-align fallback on narrow widths.
- Added keyboard focus-visible outline for all buttons.
- `main.js`:
- Increased bar window startup size and relaxed bounds (`minWidth=720`, `maxHeight=220`) so wrapped controls remain visible/clickable.
- Regression assertions added in `tests/overlay-shell.test.js`.

## 2026-02-12 Screen Protection Patch
- Enabled Electron OS-level content protection on Intelli windows:
- Bar overlay window (`setContentProtection(true)`).
- Floating insight panel windows (`setContentProtection(true)`).
- Added regression assertion in `tests/overlay-shell.test.js`.

## 2026-02-12 OAuth Reliability Patch
- Improved Intelli auth-window token capture for Google OAuth and popup flows:
- Capture now checks `localStorage`, `sessionStorage`, and URL query/hash token fields.
- Added JWT claim guard to ignore temporary 2FA tokens (`2fa_required=true`) and wait for final auth token.
- Added child-window capture path via `did-create-window` so popup OAuth flows can complete.
- Explicitly allowed auth popup windows in Electron (`setWindowOpenHandler`).
- Added regression assertions in `tests/overlay-shell.test.js`.

## 2026-02-12 OAuth + ASR Stability Patch (Round 2)
- Frontend OAuth bridge now persists successful auth into browser storage before postMessage redirect:
- `localStorage.jwt`, `localStorage.access_token`, `localStorage.refresh_token`, `localStorage.username`.
- Intelli auth URL candidate order now prioritizes `/oauth-bridge` before `/login`.
- Intelli auth child popup windows now force show/focus and content protection.
- Removed periodic auth polling timer to reduce repeated load churn and listener pressure.
- Hosted client now retries localhost network failures by falling back to `127.0.0.1` (and local `https -> http` fallback).
- Hosted client network errors now include failing API path and backend URL for direct diagnosis.
- Added tests:
- `tests/hosted-client.test.js`: localhost fallback + network error shape assertions.
- `tests/overlay-shell.test.js`: OAuth candidate ordering + bridge persistence contract checks.
- Live integration probe against running local backend/token:
- `getUser`, `getOrgs`, `getReminders`, and `transcribeWav` all executed successfully from Intelli runtime client.

## 2026-02-12 WebSocket ASR + Transcript Delivery Patch
- Added backend Intelli WS transcription endpoint:
- `laserreach/app.py`: `@sockets.route('/api/abm/intelli/transcribe/ws')`
- JWT decode from query token, org resolution from `tenant_id` / `X-Org-ID`, RBAC check (`abm:write`), Deepgram transcription per audio frame.
- Added per-frame structured WS responses with `request_id` correlation (`op: transcript` or `op: error`).
- Fixed transcript delivery contract mismatch:
- `src/hosted-audio.js` now emits `op: 'transcript'` (was `final`).
- `index.html` now accepts both `transcript` and `final` for backward compatibility.
- Improved ASR connection lifecycle:
- `main.js` now closes hosted ASR socket on `asr-stop` and cleanup (`hostedClient.closeAsrStream()`).
- Added rigorous tests:
- `intelli/tests/hosted-client.test.js`: verifies WS transport preference and zero HTTP transcribe calls when WS is healthy.
- `intelli/tests/hosted-audio.test.js`: asserts emitted transcript op contract.
- `laserreach/tests/test_intelli_routes.py`: direct WS handler tests for missing token and successful audio transcription path.
- Validation:
- `cd intelli && npm test -- --runInBand` -> PASS (`13/13`).
- `cd laserreach && conda run -n py311 pytest -q tests/test_intelli_routes.py tests/test_intelli_service.py` -> PASS (`12/12`).

## 2026-02-12 Burn-Ship WebSocket Patch (ASR + Analysis)
- Removed silent HTTP fallback for Intelli real-time paths:
- `src/hosted-client.js`: `transcribeWav()` and `analyze()` are now WebSocket-only.
- Added dedicated analysis WebSocket channel:
- Backend route: `/api/abm/intelli/analyze/ws` in `laserreach/app.py`.
- Client opens/maintains two sockets:
- ASR socket (`/api/abm/intelli/transcribe/ws`) for continuous transcription.
- Analysis socket (`/api/abm/intelli/analyze/ws`) for LLM calls and progress updates.
- Added live LLM status events over WebSocket:
- Backend sends `analysis_status` (`running` / `done`) and `analysis_result`.
- Client forwards these to renderer via `llm-status`.
- Improved WS auth robustness:
- If `tenant_id` is absent, backend infers tenant from the user's org memberships (instead of defaulting incorrectly).
- Added cleanup hardening:
- `main.js` now closes both ASR and analysis sockets during stop/quit.
- Added/updated tests:
- `intelli/tests/hosted-client.test.js`: WS-only client path + analysis status events.
- `intelli/tests/hosted-runtime.integration.test.js`: verifies transcribe/analyze over WS with HTTP counts at zero.
- `laserreach/tests/test_intelli_routes.py`: coverage for `/intelli/analyze/ws` status/result flow.
- Validation:
- `cd intelli && npm test -- --runInBand` -> PASS (`14/14`).
- `cd laserreach && conda run -n py311 pytest -q tests/test_intelli_routes.py tests/test_intelli_service.py` -> PASS (`13/13`).
