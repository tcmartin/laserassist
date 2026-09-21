# Intelli dialer interface

Validated source commit: `3a0f9a274a0b436afcf6a1322b6101f81e4ca290`, tree
`1eee58436d52e9d91b14c18358b191a4c67ed953`. The feature branch and canonical
remote `master` were pushed and fetched; this source is reachable from both.
The previously local baseline `78915dc` and diagnostic `b7ed68f` are included
in this tested tree. The clean retained primary `master` checkout was advanced
with a fast-forward. GitHub Actions returned no runs for this exact commit;
the repository contains no checked-in workflow, so no CI pass is claimed.

The existing compact bar expands into a call console within the same trusted
local window. This reuses the existing transcript, coaching, authentication
and session runtime. It avoids separate windows competing for microphone and
analysis events. Collapsing preserves an active call; ending explicitly hangs up.

The console has contact search and upcoming meetings, a contact/context card,
destination and caller-number selectors, script selection and editing, and a
review panel. A review creates an immutable prepared call without dialing.
Only the separate Start call action acquires media and sends the offer. Every
selection edit invalidates the review. Active calls lock configuration and
show an End call action. After hangup, existing transcript and coaching controls
remain available. Closing or changing workspace stops owned media.

Microphone and received audio feed the existing ASR/session pipeline under the
prepared call ID. Analysis sends that ID; the backend chooses the frozen
context and script. The current meeting cannot silently substitute another
contact. User and local-agent script sources remain visible.

Visual direction: extend the current navy overlay, use system sans-serif,
clear headings, light text with accessible contrast, restrained blue actions,
visible focus and textual status. The UI skill's marketing hero recommendation
does not fit this in-call console; use its contrast and interaction guidance.
No new font, component or runtime dependency is required.

Number acquisition shows server-supplied pricing and availability. A user must
explicitly continue to hosted checkout; a redirect is never purchase proof.
Unavailable purchasing is stated plainly. No UI test may contact a real payment
or telephony provider. Browser/Electron interaction and visual checks remain
required before release.

## Lifecycle corrections and validation

Review found six user-visible failure cases. Repeated review clicks could
create duplicate prepared records. A late end confirmation could leave an
already stopped call locked. Awaited media cleanup could overwrite a newer
terminal state. Workspace reset could send an old session-end event under a
new identity. Failed signaling startup could leave its reserved channel open.
Microphone denial could unnecessarily lock a call that had never started.

The controller now serializes preparation, applies terminal state before
awaiting resource cleanup, stops each audio session once, closes attempted
signaling on failure, and suppresses session-end writes during workspace
reset. A failure before signaling preserves the prepared review for retry.
Six tests reproduced these failures before the fixes and now pass. An
additional main-process regression verifies that an explicit call ID ignores
the unrelated default pipeline while preserving explicit mismatch checks.

The frozen desktop suite passed 57 tests with three opt-in tests skipped in
26.63 seconds (wrapper 26.96 seconds); runtime hashes remained unchanged. It included
actual Electron startup, generated local voice over real WebRTC, the offline
analysis transport, and the contact/review/script-edit/workspace-reset UI.
The three skips are separate full-backend and paid-provider tests; their
individual evidence is recorded in the voice and signaling validation docs.

The rebuilt unsigned macOS arm64 bundle passed the same UI path in 9.03 seconds.
The test asserts it loaded `app.asar/index.html`, not the source checkout.
Eleven packaged runtime files exactly match the validated source bytes.
No phone call, checkout or purchase was made by these UI checks. The screenshots
passed the visual style review at 94/100 against the existing Intelli toolbar;
this is not pixel equivalence to an external reference. Evidence is retained
under `output/calling-validation-20260920/dialer-ui/` in the parent Laserreach
workspace, including desktop-suite.log, packaged-ui.log and
package-source-proof.json. Actual full dialer audio/coaching integration,
signing, notarization and release remain separate checks.

The final workspace regression also clears the older assistant transcript,
call binding, reminders and pending coaching requests, and closes old overlay
panels on identity changes. Both the extracted real event handler and actual
Electron panel test failed before these fixes and passed afterward. The voice
loopback initially retained the first buffered RTP sample after muting; the test
now requires twenty consecutive quiet 50ms samples within five seconds, with
the same energy threshold, while separately proving mic-only and remote-only
audio. This establishes sustained silence rather than instantaneous muting.

The new combined dialer audio harness was still being authored by another task
and was explicitly excluded from this frozen suite; it is not counted as passed
or skipped here. The unsigned local DMG is 96 MB and passed `hdiutil verify`.
Its SHA-256 is
`89dd80e1acbac6cb117bb2e1c26d27dbe3e409340e5eadac29aaff05f8487665`.
This artifact is for local validation, not a signed/notarized distribution.
