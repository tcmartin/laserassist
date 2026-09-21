# Native capture investigation, 2026-09-21

Intelli remains a standalone desktop assistant. The website owns the dialer and independently provides contextual coaching.

## Confirmed failure and correction

On macOS26.5/Electron44.4.3, the native capture diagnostic reports microphone and screen permission granted. `screen.getAllDisplays()` returns one internal display, but `desktopCapturer.getSources({types:['screen']})` returns no sources. Window enumeration returns sources. This reproduces in both the development runtime and packaged app. Default, zero, and one-pixel thumbnail sizes do not resolve it. Replacing the renderer's one-pixel video constraints with `video:true` also does not resolve it.

The trusted frame, exact local URL, user gesture, and audio-request checks all pass. Empty source discovery causes capture denial. Previously Intelli called `callback({})`, which Electron rejects with `Video was requested, but no video stream was provided`. The broad catch then called the consumed callback again, producing an unhandled `One-time callback was called more than once` error.

`src/display-capture.js` now denies with `callback(null)`, matching the [Electron session API example](https://github.com/electron/electron/blob/v44.4.3/docs/api/session.md#sessetdisplaymediarequesthandlerhandler-opts). The lookup catch covers source discovery only. Callback delivery is outside that catch, preventing a second invocation if delivery throws. Frame and gesture checks remain intact. This fixes denial handling; it does not fix native source discovery or establish successful system-audio capture.

## Validation

Node22.23.2, local macOS26.5, Electron44.4.3. No providers, paid purchases, or remote database calls.

| Category | Command/evidence | Result |
| --- | --- | --- |
| Unit/regression RED | `node --test tests/desktop-audio.test.js` before fix | 7 pass, 4 fail; includes null denial and repeated callback |
| Unit/regression GREEN | same command after fix | 11 pass |
| Electron integration | `node --test tests/electron-display-capture.test.js` | 1 pass; real Chromium request and native callback, injected empty/failing discovery; no media captured |
| Complete desktop suite | `RUN_INTELLI_STANDALONE_AUDIO_E2E=1 npm test` | 71 pass, 7 opt-in diagnostics skipped, 0 fail; 5.91s |
| Native live dev smoke | isolated-profile diagnostic through real `getDisplayMedia` and real source discovery | denial now has no callback exceptions; screen capture still fails |
| Packaging | `CSC_IDENTITY_AUTO_DISCOVERY=false npm run build-check-mac` | exit0; unsigned arm64 app |
| Packaged generated voice | `RUN_INTELLI_STANDALONE_AUDIO_E2E=1 INTELLI_PACKAGED_BIN=<app executable> node --test tests/electron-standalone-audio.test.js` | 1 pass; injected streams/providers |
| Static checks | `node --check` changed JavaScript; `git diff --check` | pass |
| Backend full suite | not rerun | No backend changes; desktop checks do not establish backend behavior |

Seven opt-in skips cover historical desktop dialer/media and provider/offline backend diagnostics. Generated-voice standalone test is enabled; its capture streams and hosted providers are injected. It verifies mixing, PCM, transcript/coaching, and session lifecycle, not macOS source discovery.

Evidence: root workspace `output/calling-validation-20260920/standalone/native-capture-*.json`; `/tmp/intelli-capture-denial-{red,final-suite,build,packaged-audio}.log`. Diagnostics stop tracks, close their app, and remove their isolated temporary profiles. No OS permission settings were changed and no screen frames were recorded or sent to providers.

## Remaining release gates

Native system-audio capture remains unverified and currently fails on this host. Investigate native macOS picker/capture behavior next, preserving explicit permission and trusted-origin checks. Developer ID signing/notarization and live telephony configuration remain separate outstanding gates. Do not present this unsigned build as a shipped release.

The existing Intelli worktree is retained by task01a0c0ac-2d06-71a0-b71c-7e24530d4878 for native capture investigation and signing. Review date2026-09-22. No new worktree or dependency installation was created for this correction.
