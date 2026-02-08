Goal
Build a Rust “Core” that handles capture → VAD → transcription → analysis → storage → search, with
thin native shells for macOS and Windows that provide stealth (screen-share invisibility), minimal UI,
and platform integrations. Keep everything local-first; MCP/cloud optional.

Architecture

- Rust workspace:
    - core: orchestration, config, telemetry
    - audio: capture, ring buffers, VAD
    - stt: Faster-Whisper primary + whisper.cpp fallback
    - llm: llama.cpp chat + tools
    - persist: append-only NDJSON + optional encryption + indexing
    - embed: embeddings + vector index (semantic search)
    - mcp: optional plugin/bridge layer
    - ffi: C ABI for shells; event/callback API; shared models
    - cli (optional): headless testing/benchmark tool
- Native shells:
    - macOS AppKit (Swift/ObjC): menu-bar app, secure windows, hotkeys, ScreenCaptureKit awareness
    - Windows WinUI 3/WPF (C#) or Win32 (C++): tray app, secure windows, global hotkeys
    - Linux (later): GTK/Qt shell; Wayland caveats (best-effort stealth)

Data Flow (Core)

- Capture thread (per device):
    - Platform capture (AVAudioEngine/WASAPI via cpal)
    - Push PCM into a lock-free ring buffer (Shared memory across threads)
- VAD pipeline:
    - Fast energy/RMS gate first; optional Silero VAD (ONNX) for accuracy
    - Emits voiced spans with timestamps
- Transcription workers:
    - Faster-Whisper (CTranslate2) primary, per-platform accelerator:
    - macOS: Metal
    - Windows: CUDA if present, else DirectML/CPU
- whisper.cpp (Metal/CUDA/CPU) fallback with equivalent transcript API
- Streaming chunker with overlap; punctuation/segment joining strategy
- Analysis:
    - Local LLM via llama.cpp (Gemma 4B/1B gguf) for summaries/suggestions/activities
    - Request queue (prioritize chat over background analysis) with adaptive pacing
- Persistence:
    - Append NDJSON per session: transcript.ndjson, analysis.ndjson, metadata.json
    - Optional envelope encryption at-rest; key in Keychain/DPAPI
- Embeddings + Search:
    - Embedding model (small, local): e.g., BGE-small/e5-small via gguf or ONNX
    - Index per-session (utterance-level) + global index (HNSW)
    - Query API for cross-session semantic search

Core Public API (FFI)

- Init/Shutdown
    - insighto_init(const InsightoConfig* cfg, InsightoCallbacks cb) -> InsightoHandle
    - insighto_shutdown(InsightoHandle)
- Session lifecycle
    - insighto_session_start(InsightoHandle, const char* id, const SessionMeta* meta)
    - insighto_session_end(InsightoHandle, const char* id, const SessionEnd* end)
- Recording
    - insighto_record_start(InsightoHandle, const AudioParams* params)  // selects device or default
    - insighto_record_stop(InsightoHandle)
- Live transcript/analysis
    - insighto_get_state(InsightoHandle, InsightoState* out) // metrics/health
    - insighto_trigger_analysis(InsightoHandle, const AnalysisRequest*) // summary/suggestions/
activities/final
    - insighto_chat(InsightoHandle, const ChatRequest*, ChatTicket*) // optional live Q&A
- Search
    - insighto_search(InsightoHandle, const SearchQuery*, SearchResults*) // cross-session
- Model/tier control
    - insighto_set_model_tier(InsightoHandle, TierSpec*) // auto/high/low; override
- MCP (optional)
    - insighto_mcp_invoke(...) // plug‑in interface for remote tools only if enabled
- Callbacks (async events)
    - on_transcript_segment(SessionId, Segment): also persisted by core
    - on_analysis_result(SessionId, AnalysisResult)
    - on_final_summary(SessionId, Summary)
    - on_status(Event) // warnings, queue status, perf info
    - on_error(Error)

All pointers cross the boundary as C‑friendly structs (POD), JSON strings for complex payloads if
needed. Provide thin language bindings for Swift/C#.

Threading Model

- Audio capture thread → single-producer ring buffer
- VAD worker(s): light compute; can be combined with capture if needed
- Transcription pool (1–N based on cores/GPU): sequential per stream, parallel across streams (future)
- Analysis queue thread: prioritizes chat; adaptive delays
- File writer thread: bounded channel to append to NDJSON; fsync batching
- Embedding/indexer worker: backfills embeddings async; merges into HNSW index snapshot
- LLM thread: one dedicated llama.cpp context; optional batch across prompts

Config and Tiering

- Hardware probe (Rust):
    - CPU cores, total memory, GPU vendor/capabilities
    - macOS: prefer Metal; Windows: CUDA if NV GPU otherwise DirectML/CPU
- Transcription tier:
    - Faster-Whisper model sizes: tiny/base/large-v3-turbo (user selectable); default auto by mem/GPU
- LLM tier:
    - High: Gemma 4B Q4_K_M; Low: Gemma 1B Q4
- Knobs: threads, batching, VAD on/off, overlap ms, prompt templates
- Persist path: <userData>/sessions/<sessionId>/ (shell provides path)

Stealth (Shells)

- macOS:
    - AppKit windows set to non-shareable: NSWindow.sharingType = .none
    - Use NSWindow.contentSharingType where available; also apply setExcludedFromWindowsMenu and turn
off thumbnails
    - Auto-hide UI on ScreenCaptureKit capture start; run headless/menu‑bar by default
    - Entitlements: microphone; file access inside container; network client (optional MCP); hardened
runtime
- Windows:
    - SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE) for all UI windows
    - Default hidden (tray) with global hotkey to open overlay
- Linux:
    - Wayland portal awareness; default headless; show ephemeral windows when not sharing

Core never draws UI; shells ensure every window is protected or hidden.

Persistence Format

- metadata.json: { id, createdAt, endedAt, whisperModel, llmModel, appVersion, tags }
- transcript.ndjson: lines of { type: "transcript", ts, id, text, confidence, speaker? }
- analysis.ndjson: lines of { ts, type: "summary" | "suggestions" | "activities" | "final-summary",
payload... }
- Embeddings:
    - <session>/embeddings.bin (row-major f32) + <session>/embeddings.idx (HNSW metadata)
    - Global index snapshot under <userData>/index/ for cross‑session

Encryption (optional):

- Envelope encryption for NDJSON files; AES‑GCM key stored in Keychain (macOS) / DPAPI (Windows)
- Rotate keys per device; lock/unlock at app start

Search

- embed crate:
    - Load lightweight embedding model (gguf or ONNX) at startup
    - Stream utterances through a bounded queue; store embeddings
- index crate:
    - HNSW index (e.g., hnsw_rs) with periodic compaction
    - Query API: top‑k nearest utterances with session/time metadata
- Hybrid search:
    - Optional BM25 (tantivy) over text fallback/combination

LLM

- llama.cpp (via llama_cpp_rs or direct C FFI):
    - Load GGUF based on tier; set Metal/CUDA backend
    - One context per app; configure KV cache, context length
- Function/tool calling:
    - Provide JSON tool schema; shells (or core) handle MCP bridging if enabled
- Prompts:
    - Reuse current prompt templates (summary, suggestions, activities)
    - Keep iterative retries on JSON parse failure (pattern from llm-worker.js)

Transcription

- Faster‑Whisper primary:
    - Use ctranslate2 C API via Rust FFI or community bindings if stable
    - Configure compute type (auto int8/float16), device (Metal/CUDA/CPU)
- whisper.cpp fallback:
    - whisper-rs with Metal/CUDA build
- VAD:
    - Stage 1 energy gate (fast)
    - Stage 2 Silero VAD (ONNX) if CPU budget allows; only emit voiced spans
- Stream handler:
    - Adaptive chunk length and overlap
    - Segment stitching: punctuation completion, confidence thresholds

Queues/Pacing (take from current codebase)

- RequestQueue: prioritize chat over analysis; adaptive delay based on average processing time and
queue size
- Analysis throttling (min interval) to avoid overloading LLM
- Incremental updates: push transcript segments as they complete, not full rebuilds
- Append‑only writer: crash safe

FFI Type Sketch (selected)

- Config (JSON or struct): model paths, device choice, threads, storage path
- Segment { id: [u8;16] or string, ts: i64, text: *const c_char, confidence: f32 }
- AnalysisRequest { types: bitflags, force: bool }
- AnalysisResult { summary_json, suggestions_json, activities_json }
- Callbacks registered at init: function pointers or user data + vtable
- All allocation on Rust side; shells free via insighto_free(void*)

Native Shell Responsibilities

- Tray/menu‑bar app + global hotkey for overlay
- Apply screen‑capture exclusion on all windows
- Simple panels: Live transcript, Insights, Sessions Viewer (reuse patterns)
- Settings UI: tier override, VAD, encryption, auto final summary, integrations
- Calendar integration (Phase 3): event metadata → metadata.json
- License UI: token entry, org cert enrollment

Build & Packaging

- Rust: cargo workspace, features:
    - faster-whisper, whispercpp_fallback, metal, cuda, directml, encrypt, mcp
- macOS:
    - Universal builds (arm64/x64 optional), sign/notarize, sandbox entitlements
    - Ship models as external downloads; cache under userData/models/
- Windows:
    - MSVC toolchain; sign; installer (MSIX/Wix)
- CI:
    - GitHub Actions for multi-target builds; test matrix (unit + perf smoke)
    - Benchmark harness for audio throughput, transcription latency, LLM token/s

Testing

- Unit: ring buffer, VAD, NDJSON writer, indexer
- Integration: end‑to‑end capture → transcript; LLM prompts; search results correctness
- Performance: sustained 60‑minute session memory/CPU; GPU fallback
- Stealth: manual and automated checks (GraphicsCapture, ScreenCaptureKit, PrintScreen)

Patterns to Reuse From Current Code

- Append‑only NDJSON with per‑session folders (already implemented)
- RequestQueue prioritization and adaptive delays (chat > analysis)
- Analysis min interval + “isAnalyzing” guard
- Tier detection and model selection (extend to Rust, improve heuristics)
- Incremental transcript updates (avoid full joins)
- Audio chunk pooling and VAD gating (ported to Rust)
- Separable prompts for summary/suggestions/activities with iterative JSON fixup

Timeline (aggressive, based on your velocity)

- Week 1–2:
    - Core skeleton, FFI, capture+ring buffer+RMS VAD, whisper.cpp fallback working on both platforms
    - NDJSON persistence wired; simple CLI to validate
- Week 3–4:
    - Faster‑Whisper integration (Metal/CUDA), session viewer in shells, llama.cpp LLM for summaries/
suggestions
    - Basic HNSW embeddings index; cross‑session search CLI
    - macOS shell with stealth windowing; Windows shell with WDA_EXCLUDEFROMCAPTURE
- Week 5–6:
    - Polish: encryption at rest, settings, license gate, MCP optional pack
    - Performance passes and packaging (MAS prep, Windows installer)
- Optional pull‑in:
    - If whisper.cpp suffices on M‑series initially, you can hit parity faster and add Faster‑Whisper
in Week 3.

If you want, I can start by scaffolding the Rust workspace (crates, FFI headers, core structs, and
minimal CLI) and the AppKit/WinUI shells with the window‑exclusion calls stubbed.
