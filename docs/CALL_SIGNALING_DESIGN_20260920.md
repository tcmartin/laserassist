# Authenticated call signaling

The main process owns one signaling connection for one prepared call. Its URL
is derived from the saved backend, tenant and JWT and the validated call ID.
The renderer cannot supply an endpoint, credential, destination or provider.
The server checks actor ownership and uses its durable call record.

`CallSignaling` sends a start offer once. It does not reconnect or retry a start
after a transport failure, because the external call outcome may be uncertain.
It serializes start, ICE, short poll and end requests; a poll response forwards
sanitized server events to the renderer. A bounded idle poll keeps Janus state
and received ICE flowing. Auth/tenant/backend changes close the socket and
reject queued responses. Server disconnect cleanup owns provider hangup.

Request deadlines and a bounded queue prevent accumulation. Closing cancels
timers and rejects pending work. Errors expose fixed codes, never URLs/JWTs or
raw provider messages. Trusted main/preload handlers now expose start, trickle,
end and close, plus update/close subscriptions. The main process reserves the
active call before awaiting a connection and closes signaling when credentials
change or the app exits. The dialer UI and actual backend route integration
remain pending; local WebSocket tests are not a phone-call E2E.

Five real loopback WebSocket tests cover authentication context, serialization,
poll/hangup, stale identity, uncertain start without retry, and scope/size
rejection. Two main-process execution tests cover the simultaneous-start race
and rejecting invalid offers before constructing a transport. The combined
desktop suite passed 47 tests with three opt-in E2E skips, including the real
Electron startup and generated-voice WebRTC test. No provider call was made by
that suite. Runtime changes remain uncommitted while the dialer is integrated.
