# Standalone Intelli audio capture

Intelli remains a standalone live assistant. The website owns dialing and receives its own live coaching. Desktop capture does not depend on a website call or a dialer session.

## Problem and design

The standalone Start action previously requested only microphone audio. A remote speaker heard through headphones could be absent from transcription. The prior desktop-audio description overstated that behavior.

Start now requests microphone and system audio by default. `DesktopAudioCapture` owns both streams and mixes them into one audio stream for the existing hosted ASR and coaching path. The system request runs directly in the click handler to preserve user activation. Both sources use half gain to avoid clipping their sum. The optional display video track remains local and is never sent to transcription or analysis.

Settings offers an explicit Microphone only mode. A display stream without an audio track fails with a visible error; it does not silently claim to capture system audio. A rejected permission request, Stop, workspace change, or ended capture track releases acquired streams and the mixer. Streams granted after cancellation are stopped immediately. Duplicate Start attempts do not create extra capture sessions.

Electron's display handler accepts only a user-initiated audio request from the local main Intelli window. It rejects login windows, other frames, and a window replaced while source enumeration is pending. OS capture permission remains required. Electron was upgraded from 26.6.10 to exactly 44.4.3, an existing dependency, for modern macOS system audio support. The macOS package declares microphone and system audio usage descriptions.

## Validation boundaries

Unit tests cover input mixing gains, single acquisition, microphone mode, absent system tracks, permission denial, late permissions after cancellation, track-ended teardown, configuration normalization, and trusted-window display authorization. Generated-voice Electron integration is recorded separately in `INTELLI_STANDALONE_AUDIO_VALIDATION_20260920.md`. Injected streams exercise real renderer audio processing, ASR transport, and coaching; they do not establish native macOS permission or CoreAudio capture behavior. Packaged native capture, signing, and notarization require separate verification before release claims.

Reference: https://www.electronjs.org/docs/latest/api/desktop-capturer and https://www.electronjs.org/docs/latest/api/session

## Additional issues found during verification

- The compact 108px window clipped Settings below its header. Opening Settings now expands the native window within the active display; closing restores the compact height. The new IPC accepts only a boolean from the main bar frame. Settings scroll within the viewport and field widths remain inside the panel. The real Electron test asserts Audio source and Save visibility, input horizontal bounds, and compact height after closing.
- An automatic coaching request already in flight could reopen a live panel after Stop, and its response handler could append old results to a newly started session. Automatic requests now retain their originating session ID; late responses cannot render live coaching or append results into another session. A fresh capture resets local transcript and suggestion state. Regression tests exercise Stop and session replacement before response delivery.
