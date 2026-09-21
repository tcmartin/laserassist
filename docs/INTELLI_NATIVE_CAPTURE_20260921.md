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

## Source synchronization evidence

Verified source commit `8eaa31ebd759deef06333914fb77369c56830788`, tree `ccfc5261fa58e5d293ebf9b1b292b17374015d97`, was pushed normally to `origin/codex/intelli-calling-20260920` and `origin/master`. A fresh fetch returned that exact remote default and `git merge-base --is-ancestor HEAD origin/master` exited0. GitHub Actions query for the full commit SHA returned `total_count:0`; remote CI is unverified. Packaged generated-voice check passed1/1 in5.41s. Native packaged denial has no callback exceptions, but still returns AbortError because screen sources are empty.

## Follow-up: display sleep isolated; startup deadline added

A native Swift diagnostic using CoreGraphics and ScreenCaptureKit isolated the empty-source condition. Before waking the display, screen permission preflight was true, the one online display was asleep/inactive, CoreGraphics reported zero active displays, and ScreenCaptureKit reported zero shareable displays. A bounded20-second `caffeinate -u` assertion woke the display without changing settings: both APIs then reported one active/shareable display. The original Intelli handler subsequently found `screen:1:0` and granted video plus loopback audio. This is evidence of a host display-sleep condition, not evidence that Electron's source enumeration needs replacement.

An isolated `useSystemPicker:true` experiment while the display was asleep failed with `Timeout starting video source`; no picker change was adopted. After waking the display, capture remained pending. Native UI control independently reported that the Mac was locked and could not be automatically unlocked. A manual unlock was requested from the user; no unlock or permission bypass was attempted. Successful native system-audio capture still requires verification.

The pending request exposed a separate application bug: `DesktopAudioCapture.start()` waited indefinitely for OS media promises, leaving the Start button disabled. Startup now has a30-second deadline. Closing capture immediately rejects a pending start. Acquired and late-arriving streams retain the existing track cleanup; successful startup clears its deadline. The UI reports the timeout and allows retry. No ASR/session starts on timeout, and the app does not silently fall back to microphone-only mode.

Changed files: `src/desktop-audio.js`, `tests/desktop-audio.test.js`, `tests/electron-standalone-audio.test.js`, and this record. The existing ownership/cleanup path is reused; no new dependency or capture backend was added.

Validation for this follow-up:

- RED: the new stalled-permission test never settled; Node exited1 with11 pass and3 cancelled tests before the fix.
- Unit/regression:14 pass after the fix, including timeout, late-stream cleanup, cancellation without an OS response, and deadline removal after success.
- Integration/UI: actual Electron renderer waits the production30-second deadline, re-enables Start, displays the timeout, keeps ASR/session counters at zero, stops late tracks, then completes the generated-voice coaching test.
- Complete desktop suite: `RUN_INTELLI_STANDALONE_AUDIO_E2E=1 npm test` exited0;74 pass,7 existing opt-in skips,0 fail,35.81s. Node MockTimers emits its experimental warning.
- Build: `CSC_IDENTITY_AUTO_DISCOVERY=false npm run build-check-mac` exited0; unsigned arm64.
- Static checks: changed JavaScript syntax and `git diff --check` pass. No standalone lint/typecheck script is configured.
- Backend unit/integration/full suite not rerun: backend source is unchanged. No DynamoDB endpoint was used for these desktop checks.

Additional evidence: `native-display-sleep-evidence.json`, `native-source-probe.swift`, `native-capture-display-awake.json`, `native-capture-system-picker-filtered.json` under the root evidence directory; `/tmp/intelli-capture-timeout-{red,suite,build}.log`. The underlying native capture remains unverified; generated/injected audio evidence is explicitly separate.

Live packaged startup check used the real microphone/display APIs and the actual capture class: the deadline rejected at30004ms, the isolated app closed, and its temporary profile was removed. It granted `screen:1:0` plus loopback but did not establish successful audio. Chromium also logged `Can't wrap SharedImage as VideoFrame` with the production one-pixel video constraints; the significance of that error remains unresolved and must be checked after manual unlock. No speculative renderer-constraint change was made.

Packaged integration regression: `RUN_INTELLI_STANDALONE_AUDIO_E2E=1 INTELLI_PACKAGED_BIN=<arm64 app executable> node --test tests/electron-standalone-audio.test.js` exited0,1 passed in35.81s. This validates timeout/retry and generated-voice coaching inside the rebuilt ASAR. Its media/provider inputs are injected. Runtime source was frozen before the full suite and build; later changes were this Markdown evidence only.
