# Intelli native capture and signing verification — 2026-09-21

This record covers the packaged arm64 Intelli app at source commit `c26d16b61d22022ccb0b44496b4d2bf30fb70108`. It records unlocked-state verification only; no source behavior was changed and no provider or telephone call was made.

## Native capture

The isolated packaged-app diagnostic launched:

```text
node output/intelli-unlocked-20260921/native-capture-unlocked.cjs
```

The real macOS APIs returned one online internal display and one `screen:1:0` source. The trusted local app frame and user gesture checks passed. Intelli's display handler granted `{video, audio: "loopback"}`. `DesktopAudioCapture.start("microphone_system")` resolved with a live 48 kHz stereo output audio track and no video track in the mixed output.

The signal probe then played the generated `conversation.wav` through the Mac output while sampling both real input streams. It observed:

| Input | Native track | Sample result |
| --- | --- | --- |
| System audio | `System audio`, `deviceId=loopback`, live, 48 kHz | max RMS `0.400812`, mean RMS `0.109104` |
| Microphone | `Default - MacBook Pro Microphone (Built-in)`, live, 48 kHz | max RMS `0.038027`, mean RMS `0.009655` |

The generated playback process exited `0`, the packaged app exited cleanly, and the isolated profile was removed. This is direct native capture evidence; it is separate from the prior injected-stream coaching test.

Chromium still logged `Can't wrap SharedImage as VideoFrame` for the one-pixel keepalive video track. Audio capture succeeded despite those video-frame diagnostics. The app does not send that video track to ASR/coaching.

Artifacts:

- `output/intelli-unlocked-20260921/native-capture-unlocked.json`
- `output/intelli-unlocked-20260921/native-capture-signal-probe.json`
- `output/intelli-unlocked-20260921/native-capture-signal-probe.cjs`
- `output/intelli-unlocked-20260921/packaged-source-provenance.json` confirms `main.js`, `src/desktop-audio.js`, and `src/display-capture.js` byte-match the source checkout inside `app.asar`.

## Developer ID signing

A disposable copy of `/usr/bin/true` was signed with `Developer ID Application: Trevor Martin (XY7XLD4UMP)` using `codesign --options runtime --timestamp=none`. Signing and verification both exited `0`; the resulting signature reported TeamIdentifier `XY7XLD4UMP`, the Developer ID Application authority chain, and runtime version `26.5.0`. The temporary binary and logs were removed after verification.

The identity inventory reported one valid codesigning identity. No keychain password, signing credential, or production app was modified.

Artifact: `output/intelli-unlocked-20260921/signing-probe.json`.

## Notarization profile

A metadata-only scan of the login keychain found no `com.apple.gke.notary.tool` / `notary` profile entry. No credential values were read or emitted. Notarization remains unverified and requires a configured notarytool profile.

Artifact: `output/intelli-unlocked-20260921/notary-profile-presence.json`.

## Evidence hashes

```text
app.asar: c5946da3d8e43ee07e1194c937eb1ba45ec68c00442d13f0d762256e53203f6e
native-capture-unlocked.json: 8c2c8db39cc17dbff0069c9f581f957d8fa86420a172ed3a91d25397cd726f3e
native-capture-signal-probe.json: f402abafd9c03b53afacc3128c968aace02bfe5580306ca77efd24f58531cc8d
signing-probe.json: a5b2ed7dc54d21f54c11bf56cbfd7c51c11c33aa755976ab9d80a30ad194a50f
```
