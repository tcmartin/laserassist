# Standalone Intelli verified source increment — 2026-09-20

## Scope

Intelli remains the standalone desktop assistant. The website owns telephone dialing and has its own live transcription and coaching. This increment removes desktop dialer UI/IPC and packages only the assistant runtime. It adds microphone/system audio capture, an explicit microphone-only setting, accessible Settings, and guards against late coaching crossing listening sessions.

Source commit: `096f01da73d4f4d63f55648c7023a4daffd401f6`.
Source tree: `20a1cf98855f4aa0c0dc3359a737bdc56f63a271`.
Electron: `44.4.3`; host validation uses Node `22.23.2` and macOS arm64.

## Validation matrix

| Category | Evidence | Result |
| --- | --- | --- |
| Unit and regression | `RUN_INTELLI_STANDALONE_AUDIO_E2E=1 npm test` on source commit | Exit 0; 67 passed, 7 skipped, 0 failed; 5.74 seconds |
| Integration | Real Electron Start/Stop, two generated speech inputs with independent marker tones, real AudioContext/PCM/IPC and local HTTP/WebSocket fixtures | One ASR/session start/end, 15 PCM chunks, one rendered coaching result; no provider calls |
| Live dev smoke | Electron startup plus Start/Stop and Settings open/close within full test run | Passed; capture tracks released, Settings controls within viewport, compact size restored |
| Packaged smoke | `RUN_INTELLI_STANDALONE_AUDIO_E2E=1 INTELLI_PACKAGED_BIN='<built app executable>' node --test tests/electron-standalone-audio.test.js` | Exit 0; 1 passed; 8.60 seconds; renderer URL asserted inside `app.asar` |
| Packaging | `CSC_IDENTITY_AUTO_DISCOVERY=false npm run build-check-mac` | Exit 0; unsigned arm64 application built |
| Package contents | Eight runtime source files byte-matched `app.asar`; package name/version/main/dependencies matched; calling-only modules absent | Passed; builder intentionally strips development package metadata |
| Static | `node --check` for main/preload and new helpers; compile inline renderer with `vm.Script`; `git diff --check` | Passed |
| Visual | Original-resolution packaged Settings screenshot and DOM bounds assertions | 94/100; no clipped fields or dialer surface |
| Full backend suite | No backend changes in this increment | Not rerun; separate backend increment `cd24d46` has 3,438 passed / 4 skipped |

Seven skipped tests are opt-in or historical desktop-dialer diagnostics; they are not counted as passes. The portable synthetic WAV fixtures are included under `tests/fixtures/` and excluded from the app package.

Compact logs, runtime SHA-256 hashes, and screenshots are retained under the root repository's `output/calling-validation-20260920/standalone*` paths. The source hash list covers entrypoints, configuration, capture, hosted transport, and lockfiles.

## Release limits

The generated system stream is injected at the browser capture API. It proves both inputs independently reach the real renderer/ASR/coaching path; it does not establish native macOS CoreAudio capture or OS permission behavior. Native capture, Developer ID signing, notarization, and distribution remain open. Existing private-key access fails with `errSecInternalComponent`; no usable notarization credentials/profile were found. No live telephony, Stripe checkout, number purchase, or deployment occurred in this desktop increment.

GitHub Actions was queried for the source commit; no run was returned. This is not a CI pass. Default-branch reachability is recorded separately after synchronization.
