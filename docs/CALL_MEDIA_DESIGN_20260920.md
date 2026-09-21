# Operator call media

The dialer needs two audio paths: microphone audio sent to the remote caller,
and microphone plus received audio sent to the existing transcription stream.
Sending the mixed stream to the peer would echo the caller's voice back to them.

`src/call-media.js` owns one audio-only WebRTC connection, its microphone
stream, and a Web Audio graph. Only microphone tracks enter the peer connection.
Separate local and remote sources enter a transcription destination at half
gain each. The module plays the remote stream through an audio element; the local
source never connects to the speaker destination. The caller may supply an audio
element to configure output or mute local tests. Playback rejection emits
`playback_blocked` for the UI to surface.

The main process will own authenticated signaling. The renderer sends only an
offer and ICE candidates and receives sanitized answer/candidate events for the
prepared call. No provider credentials belong in the renderer. Candidates that
arrive before the answer are queued with a fixed cap. Closing stops all owned
tracks, disconnects graph nodes, closes the peer and audio context, and rejects
late startup completion. The media module does not dial or purchase anything.

This module is one part of the dialer. It must still be connected to the
authenticated media route, call review UI, remote playback, ASR and call-session
coaching. Fake-browser unit tests cannot establish real audio transport; an
Electron loopback test with generated voices remains required before release.

## Local media validation

Four unit regressions cover audio routing, early ICE, malformed signaling and
queue limits, and cancellation during offer creation. A real Electron test
uses two browser WebRTC peers and the generated Kokoro buyer WAV. It checks
RTP receipt in both directions, one outbound microphone track, and independent
microphone-only, remote-only, and both-muted energy at the transcription mix.
It closes both peers, every owned track, audio contexts and playback, exits
Electron, and removes the disposable profile. It makes zero provider calls.

The stronger remote-only assertion initially failed: RTP was received but the
remote audio graph was silent without an active playback element in this
Electron build. The module now owns playback instead of relying on an optional
consumer callback to start it. The loopback test passes with a zero-volume
playback element; remote-only and local-only energy are nonzero and both-muted
energy is below the silence threshold. This is local media proof, not SIP,
transcription, coaching, or full dialer E2E proof.

API references:
- [Remote ICE candidates](https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/addIceCandidate)
- [Received tracks](https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/track_event)
- [Audio stream destination](https://developer.mozilla.org/en-US/docs/Web/API/MediaStreamAudioDestinationNode)
