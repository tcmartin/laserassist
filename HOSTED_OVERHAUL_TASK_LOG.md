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
- Intelli tests: `npm test` -> PASS (`9/9`).
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
