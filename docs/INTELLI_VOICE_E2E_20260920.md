# Intelli generated voice E2E

`tests/electron-provider-e2e.test.js` is an opt-in local end-to-end check for
the hosted Electron runtime. It launches the real Electron binary with a
disposable user-data directory, configures the loopback backend through the
same hosted settings file used by the app, and drives the existing preload IPC
through Chromium DevTools Protocol. The harness uses the pinned `ws`
dependency already present in Intelli; it does not add Playwright or another
runtime dependency.

The test seeds unique synthetic rows in the existing local DynamoDB tables for
one user, organization, membership, pipeline, person, and company. It starts
an isolated Redis process and a loopback Flask backend with workers, sender
workers, scrapy, and legacy campaign resume disabled. The backend uses the
repository's gevent WebSocket worker because the hosted Intelli endpoints are
`flask_sockets` routes. The generated Kokoro `buyer.wav` corpus file is streamed as
PCM through the real Electron audio IPC. The test requires a real Deepgram
transcription and one real GPT-5-mini analysis. It checks the returned account
context, usage metadata, transcript and analysis events in the backend session,
and a separate session read after teardown. Fixtures, Redis, backend,
Electron, and the temporary profile are cleaned up in `finally`.

Run only when a provider call is authorized:

```sh
cd /Users/trevormartin/.codex/worktrees/laserreach-visibility-calling/intelli
RUN_INTELLI_VOICE_E2E=1 node --test tests/electron-provider-e2e.test.js
```

The test loads `DEEPGRAM_KEY` (or `DEEPGRAM_API_KEY`) and `OPENAI_API_KEY`
in memory from the primary backend `.env` when they are absent from the
process environment. Values, bearer tokens, transcripts, and provider output
are never written to the repository or evidence files. The local DynamoDB
endpoint must already be available at `http://127.0.0.1:8000`; the harness
does not create, reset, or delete shared tables. A normal `node --test
tests/electron-provider-e2e.test.js` run skips the provider test.

Validation on 2026-09-20:

- `node --check tests/electron-provider-e2e.test.js` passed.
- Default gated invocation passed with one intentional skip.
- `npm test` passed: 27 tests, 1 intentional skip.
- `CSC_IDENTITY_AUTO_DISCOVERY=false npm run build-check` produced the
  unsigned macOS app, and that packaged app reached its DevTools endpoint in
  a disposable startup smoke. A normal signed build remains dependent on the
  machine's available macOS signing identity.
- The provider-enabled invocation launched the real Electron binary, seeded
  and authenticated a synthetic organization, connected through the loopback
  gevent WebSocket server, and received a non-empty Deepgram transcript from
  `buyer.wav` containing the generated follow-up/sales scenario.
- Historical provider attempts remain recorded below: the local process key
  returned `401 invalid_api_key`, and the first production-container-key run
  timed out before the serialization fix.
- The final authorized production-container-key run completed in 26.4 seconds.
  It received a 97-character Deepgram transcript and provider usage of 896
  total tokens. Scenario-specific coaching, selected pipeline/person/company
  context, analysis persistence, separate session readback, and teardown all
  passed with two stored session events. No provider secret, bearer token,
  transcript, or response body was written to disk.

## Timeout diagnosis

The pre-fix timeout run with the production-container key reached 198.17s and
returned `analysis_ws_timeout`. The loopback backend stayed running and logged
the authenticated Intelli analysis WebSocket connection. The pre-correction
diagnostic compared the generated WebSocket request ID with the unrelated IPC
analysis ID, so status reachability was unverified. The harness now reports
status events by their post-send observation window and includes generated
request IDs. It never records credentials, JWTs, transcripts, or provider
response bodies.

The request reaches the Electron analysis client and its timeout is surfaced
with the IPC request's id. The prior status claim cannot distinguish a missing
status from the harness's invalid id comparison. It also does not prove that
the exact application model route completed. `gpt-5-mini` is normalized to
`gpt-5.6-luna` before the gateway route
is selected (`backend/services/ai_cost_management.py`); the `difficult_agent`
policy then chooses the first credentialed route. The direct provider probe used
the production-container key with `gpt-5-mini` and 512 max completion tokens;
it returned success in 6 seconds. That proves the captured key and provider
network path work for that direct model request. The post-fix E2E run verified
the exact normalized gateway route through successful coaching and usage.

The backend emits `analysis_status=running` immediately before synchronous
context construction and `run_gpt5mini_analysis`
(`backend/app.py:17238-17263`). Before the bounded patch, the gateway constructed
an OpenAI client without an explicit timeout (`backend/services/ai_gateway.py:326-342`); the installed
SDK defaults to 600-second read/write timeouts and two retries. Electron waits
180 seconds (`intelli/src/hosted-client.js:400-425, 621-632`), so a blocked
context/provider call can outlive the client request and leave the UI with a
generic timeout before the backend can send a result or error. The bounded
native-thread and deadline path now emits a result or bounded error, and the
post-fix provider-backed run completed through that path. The numeric-context
regression found during the offline trace is fixed by the Intelli-only JSON
encoder and bounded serialization error handling in `backend/app.py`.

Fresh evidence counts:

- Local process key: one actual E2E run, explicit provider `401`, 19.10s.
- Production-container key: one pre-fix actual E2E run,
  `analysis_ws_timeout`, 198.17s; status reachability was unverified by the
  pre-correction request-ID filter; backend remained running.
- Production-container key: one post-fix actual E2E run, 26.4s, 97-character
  transcript, 896 provider total tokens, coaching/context/session readback
  passed.
- Production-container direct probe: one request, `gpt-5-mini`, 512 max
  completion tokens, success in 6s.
- Deepgram generated-voice ASR in both E2E runs reached a non-empty transcript
  containing the expected follow-up/sales scenario before analysis.

The pre-fix timeout run did not verify coaching content, durable analysis
persistence, or post-teardown session readback. The post-fix run verified all
three through the real Electron and backend path.

The Electron request id (`e2e-analysis-...`) is an IPC correlation id. The
hosted client creates a separate WebSocket `request_id`
(`analysis_<timestamp>_<seq>`) inside `_sendSocketRequest`; the main process
preserves the IPC id only on the final `llm-analysis-response`. Timeout
diagnostics correlate status events by their observation window after the
analysis IPC send. They must not compare `status.requestId` directly with the
IPC analysis id.

`tests/electron-analysis-offline.test.js` runs the real Electron binary and IPC
against a disposable local gevent WebSocket server. It sends one fake completion
and one fake `analysis_timeout` error, with no ASR or provider calls. The fake
server echoes generated WebSocket request ids; Electron emits three status events
and two IPC responses keyed by the original `offline-complete` and
`offline-timeout` ids. This proves Electron IPC, hosted-client request-id
generation, status forwarding, result delivery, and structured error delivery
without exercising backend context or provider code.

The harness deliberately does not dial a phone, access Twilio/SIP/AWS, buy a
number, send outreach, or enable any startup worker. It is not a substitute
for provider billing and quota monitoring; the command performs one short
transcription stream and one analysis request when it reaches the provider
steps.

## Actual-backend offline Electron trace

The bounded offline diagnostic in `tests/electron-backend-offline.test.js`
drives the real Electron IPC, hosted WebSocket client, and `flask_sockets` handler
under `customworker.CustomGeventWebSocketWorker`. Its temporary bootstrap
replaces only `abm.intelli_service.run_gpt5mini_analysis` with a deterministic
in-memory result. JWT authorization, DynamoDB context construction, Redis
sessions, analysis status delivery, and teardown remain real. It makes zero
provider and ASR calls.

The final run passed with numeric DynamoDB data after the backend serialization
fix:

```
[backend-offline-e2e] backend_ms=4988 session_ms=6367 analysis_ms=421 readback_ms=511 running_status=true generated_request_id=true provider_calls=0 asr_calls=0
```

The analysis status used the generated `analysis_<timestamp>_<sequence>`
request ID. The result contained the selected pipeline, person, and company
context. Transcript and analysis events were read back from the Redis-backed
session after `session_end`. The IPC request omitted `maxCompletionTokens`; the
deterministic fake observed the main-process default of 4000 tokens.

The pre-fix trace seeded `abm_pipelines.current_step` as a DynamoDB number. The
handler emitted `running` and `done`, then no result reached Electron. The
context builder returns the raw pipeline object
(`backend/abm/intelli_service.py:225-237`), so DynamoDB deserializes the numeric
value as `Decimal` before it reaches the result send at
`backend/app.py:17392-17401`; the old `_send` (`backend/app.py:16643-16647`)
silently suppressed the resulting JSON serialization error. The backend fix
uses a narrowly scoped Intelli WebSocket encoder for integral/fractional values
and nested sets, leaving the existing global `DecimalEncoder` behavior
unchanged, and emits a bounded serialization error for unsupported result data.
Focused route tests cover numeric result delivery, unsupported result data, and
transport send failures. The numeric fixture now passes through the actual
Electron/backend path without provider or ASR calls.

## Prepared-call offline trace extension

The prepared-call extension now seeds the real `abm_intelli_calling` table with a
reviewed script and local caller number, obtains `context_snapshot_id` through
the authenticated HTTP context route, prepares the call through the real HTTP
route, mutates the original person and script rows, and sends the prepared
`callId` through the real Electron IPC. The fake analysis boundary receives the
stored person, rendered script, and revision from the immutable call snapshot.
The trace also sends a mismatched pipeline and a foreign-actor request; both
must return an error before the fake completion result. The default pipeline
setting is intentionally unrelated, which verifies that an explicit call ID
cannot inherit it. The backend remains frozen while this harness is validated.

No raw terminal log was retained for the earlier 26.4-second provider run.
The durable sanitized evidence index is
`docs/INTELLI_VOICE_E2E_20260920_RESULT.json`; the canonical narrative and
assertion counts remain in this document. This preserves the requested result
metadata without persisting credentials, JWTs, transcripts, or provider bodies.

The prepared-call full-backend trace passed after two harness fixture corrections:
the disposable organization now carries an active `laserreach_team`
subscription for the real RBAC entitlement check, and the destination ID hashes
the normalized ten-digit phone (`2025550101`) because the compliance normalizer
removes the leading US country code. The passing run reported backend startup
4,823 ms, session setup 7,436 ms, analysis response 109 ms, and session
readback 515 ms (22.0 seconds total). It verified immutable person and script
snapshots after source mutation, mismatch and foreign-actor rejection before
fake completion, and zero provider or ASR calls.

The passing run temporarily aligned the test profile's default pipeline with the
prepared pipeline to isolate backend and IPC behavior. The unmodified harness
still requires the scoped `main.js` fix that omits `cfg.defaultPipelineId` when
an explicit `callId` is supplied.

After that `main.js` fix, the unmodified harness passed with an intentionally
unrelated default pipeline and no request `pipelineId`:

```
[backend-offline-e2e] backend_ms=4903 session_ms=7264 analysis_ms=108 readback_ms=509 running_status=true generated_request_id=true provider_calls=0 asr_calls=0
```

The sanitized stdout, result metadata, fixture-cleanup verification, and source
hashes are retained under
`/Users/trevormartin/Projects/laserreach/output/calling-validation-20260920/prepared-coaching/`.
The result records zero leaked dynamic calling tables before or after the run.
