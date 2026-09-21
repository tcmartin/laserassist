# Intelli standalone scope

Laserreach Intelli remains a standalone Cluely-like desktop assistant. The
desktop entrypoint requests microphone and system audio, streams transcription, presents live
coaching overlays, stores sessions, and keeps hosted authentication, reminders,
context, and workspace reset behavior. Telephone dialing and call preparation
belong to the website.

The separation initially preserved microphone-only capture. The subsequent capture
fix adds an explicit microphone/system mixer and Microphone only setting; see
`INTELLI_SYSTEM_AUDIO_20260920.md`. Injected dual-input capture is verified. Native
macOS capture and signed distribution remain unverified.

## Boundary found in the current tree

Before separation, the desktop dialer was mounted from `index.html`: the `Call` button, hidden call
workspace, `DialerUI` script, `callId` handoff, and call-specific listening
hooks all lived in the renderer. `main.js` added the corresponding
`CallingClient`/`CallSignaling` construction, calling IPC handlers, media
transport lifecycle, and the expanded-window resize handler. `preload.js`
exposed that same calling-only IPC surface.

The `src/call-media.js`, `src/call-signaling.js`, and `src/calling-client.js`
modules remain available for the website migration. They are not deleted from
this desktop checkout while the website owner completes that migration.

## Bounded change

1. Remove the Intelli renderer's dialer button, workspace mount, dialer assets,
   call-bound analysis/listening state, and call-specific reset branches.
2. Remove desktop-only CallingClient/CallSignaling construction, media helpers,
   calling IPC handlers, preload exports, and expanded-window resize behavior.
3. Preserve hosted ASR capture, manual/automatic analysis, overlays, auth,
   reminders, context, sessions, and serialization/error handling.
4. Add a regression that proves no dialer surface or calling IPC remains in the
   standalone desktop entrypoint while the listening/coaching entrypoints stay
   wired.

The reusable call modules and their focused tests remain as migration material;
this change does not alter the website or provider behavior.
