# Desktop realtime analysis budget

The renderer explicitly requested 14,000 completion tokens and the main-process
IPC fallback requested 12,000. Both overrode the backend's new 4,000-token
realtime default. The desktop now uses 4,000 in both places. Explicit caller
budgets remain supported; selected contact context and transcript are unchanged.

Two execution-based regressions invoke the application functions with an
in-memory IPC/client boundary. Both failed before the adjustment (14,000 and
12,000 respectively) and pass with the corrected limits. The main-process test
also verifies that an explicit 1,000-token request is preserved.

This aligns request budgets. It does not establish the cause of the observed
provider E2E timeout or prove coaching latency, output quality, or a shipped
desktop release. Full-backend offline IPC and generated-voice provider checks
remain separate validation gates.
