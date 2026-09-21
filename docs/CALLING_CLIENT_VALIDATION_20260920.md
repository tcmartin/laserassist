# Intelli calling client validation

The desktop calling boundary is implemented in `src/calling-client.js` and
uses the existing `HostedApiClient` transport. It accepts only fixed backend
paths and allowlisted payloads. It sends the configured bearer token and
tenant header, requires a configured backend, and rejects a response when the
backend URL, tenant, or token changes while the request is in flight.

Preload exposes named `calling*` methods. Main-process handlers accept calls
only from the bar's registered `index.html` top-level `file:` frame. Auth and
login windows, insight panels (until a dedicated local calling panel exists),
subframes, navigated content, and untrusted senders are rejected. Mutation
bodies are capped at 64 KiB after UTF-8 JSON serialization. Checkout returns
the backend checkout result; this boundary does not open checkout or start
media.

Offline validation uses an injected fake transport and makes no network,
provider, payment, or media calls:

```text
npm test -- --test-name-pattern='calling client'
node --check src/calling-client.js
node --check main.js
node --check preload.js
```

Covered behavior includes request paths and tenant headers, JSON payloads,
context/script/number/call methods, unknown-field rejection, confirmation and
identifier bounds, missing authentication, stale identity responses, calling
IPC frame/URL trust boundaries, and oversized mutation rejection.
