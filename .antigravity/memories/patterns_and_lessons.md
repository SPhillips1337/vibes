# Patterns & Lessons: Vibes TUI

## 🟢 Success Patterns (Anti-Gravity)

### 1. Promise-Blocking Interventions
- **Pattern:** When an agent needs human help (intervention), don't just stop or fail. Block the internal `await` of the task execution with a `Promise` that is resolved by a UI action.
- **Why it works:** It keeps the agent's internal state (message history, previous thoughts) "warm" while waiting for the human. Once resolved, it picks up exactly where it left off.

### 2. Live Limit Toggling (YOLO Mode)
- **Pattern:** Passing a getter function (e.g., `getYoloMode: () => boolean`) into deep service layers like `TaskExecutor`.
- **Why it works:** Allows the user to toggle global safety limits (like `MAX_STEPS`) *while* a long-running task is already in progress, without needing to restart the mission.

### 3. File Watcher Isolation
- **Pattern:** Store all volatile files (logs, temp data) in hidden directories (like `.vibes/`) and explicitly exclude them from dev watchers (`tsx watch --exclude .vibes`).
- **Why it works:** Prevents "Infinite Restart Loops" where the app's own activity (logging) triggers the watcher to restart the app.

### 5. Auto-Git "Time Travel" (Safety Net)
- **Shortcut Priority [UI-02]**: Use `Alt` modifiers for system-level shortcuts (Update, Undo, New Mission) to prevent input leakage while the user is typing in text fields.
- **Config Resilience [STB-01]**: When using Zod with merged data sources (Env + JSON), ensure schemas use `z.union` to handle both raw strings and already-transformed types, preventing "Double Transformation" crashes.
- **Universal Model Discovery [API-01]**: Prefer standard OpenAI `models.list()` over provider-specific endpoints (like Ollama's `/api/tags`) to maintain compatibility across different local LLM backends (LM Studio, vLLM).
- **Dynamic Endpoint Settings [API-02]**: Expose `OLLAMA_BASE_URL` and `OLLAMA_API_KEY` in the TUI settings to allow hot-swapping between local and remote LLM instances without restarts or manual `.env` edits.
- **MCP Sanitization [SEC-01]**: Use environment variable expansion (`${VAR}`) in JSON configuration files to keep sensitive API keys in `.env` while maintaining shareable configuration files.
- **Interactive Configuration on Setup [ENV-01]**: Offer interactive `.env` configuration prompts in `install.sh`. Guard the input prompts with `[ -t 0 ]` to support both manual interactive installs and non-interactive scripted piping (e.g. `curl | bash`).

### 6. Logic-Level Thrashing Detection
- **Pattern:** Keep a rolling hash of the last N tool calls and trigger human intervention if the same failing action is repeated 3 times.
- **Why it works:** Prevents agents from "spinning" and burning through expensive context windows or local compute when they get stuck in a logic loop.

### 7. Shortcut Priority Hierarchy
- **Pattern:** Position global system shortcuts (with modifiers like `Alt`) ABOVE the text-input suppression guards in the input handler.
- **Why it works:** Allows the user to perform system actions (like Updating or Undoing) even while the cursor is focused in an active `TextInput` field, without characters leaking into the input.

### 8. Markdown Tool Fallback Parser
- **Pattern:** Add string-parsing fallbacks to catch manually written JSON code blocks when API-level tool calling fails or is unsupported.
- **Why it works:** This enables agentic execution on smaller or buggy models that cannot render tool-calling schemas natively (like Gemma 12B or Phi-4-mini).

### 9. Automated Self-Healing Verification Loops
- **Pattern:** Wrap task completion in combined structural and build compilation check loops.
- **Why it works:** If checks fail, passing compiler/linter errors back to the executor as task guidance lets them immediately correct syntax, import, or build failures before code review.

### 10. Codex Snippet Context Compression
- **Pattern:** Intelligently strip import statements, comments, and long duplicate snippets from retrieved code references.
- **Why it works:** Decreases token usage by 50%+, protecting the smaller context windows of 3B-9B models from being flooded by irrelevant imports or comments.

## 🔴 Failure Lessons (Drag)

### 1. The "Ghost Retry" Bug
- **Lesson:** Updating React state to resolve an intervention is too slow for real-time agents.
- **Fix:** Use a direct `ref` to the running `Scheduler` and call resolution methods directly. This ensures the agent sees the human's guidance immediately.

### 2. Global Shortcut Leakage
- **Lesson:** `useInput` hooks in Ink capture all keystrokes, including those intended for `TextInput` fields.
- **Fix:** Explicitly guard global shortcuts with `!isIdle` or `isTyping` flags to prevent (e.g.) `Alt+Y` from typing a literal 'y' into your mission description.

### 3. Uncontrolled TUI Inputs
- **Lesson:** Using `defaultValue` in Ink's `TextInput` can lead to focus resets or UI "flicker" if the parent re-renders frequently.
- **Fix:** While version 2.0.0 of `@inkjs/ui` has limited controlled-prop support, isolating re-renders or using stable initialization prevents the "reset on every key" bug.

### 4. The "Physical Toggle" Blocker
- **Lesson:** Connection failures to "Remote LLMs" are often outside the codebase.
- **Fact:** A remote server might respond to `ping` but refuse connections if the LLM backend (Ollama/LM Studio) was toggled off via a hardware or UI switch on the host machine.
- **Fix:** Implement clearer "Connection Refused" diagnostics in the TUI to help the user distinguish between network failures and service availability issues.

### 5. UI Information Flooding
- **Lesson:** Dumping raw system logs into the live agent execution feed creates "Signal Noise" that hides the agent's actual logic.
- **Fix:** Architecturally separate the **Task View** (agent intent and tool outcomes) from the **Log Stream** (raw diagnostic messages). This preserves the user's mental model of the agent's progress.

### 6. PowerShell Native Command Error gotcha
- **Lesson:** When `$ErrorActionPreference = 'Stop'` is set in a PowerShell script, any output to the standard error stream (stderr) by native commands (such as `git` or `npm`) is intercepted and treated as a terminating `NativeCommandError`, crashing the script even if the command completed successfully.
- **Fix:** Set `$ErrorActionPreference = 'Continue'` when invoking external native commands, avoid redirecting stderr (`2>&1`) to standard output in capturing variables, and check `$LASTEXITCODE` to explicitly manage execution failures.

### 7. Raw SGR Mouse Leakage
- **Lesson:** Enabling raw SGR mouse reporting (`\x1b[?1000h\x1b[?1006h`) in Ink TUIs translates mouse clicks and scroll wheel events into ANSI escape sequences sent to stdin. Because standard Ink text inputs listen to all stdin data, these sequences leak and append garbage characters (like `[<0;...`) into text fields.
- **Fix:** Avoid SGR mouse mode unless stdin can be cleanly wrapped to intercept and strip mouse escape sequences before they reach Ink's key listener.

### 8. Incremental Rendering Screen Overlap
- **Lesson:** Ink's `incrementalRendering: true` uses line-level diffing to minimize redraw flickering. However, if background processes or remote LLM logs write directly to stdout/stderr, these lines are never cleared by Ink and permanently overlap the TUI layout.
- **Fix:** Use full terminal screen redraws (default rendering) to clear background print noise, and solve rendering flickering at the state layer (e.g. by buffering/throttling state flushes).

### 9. Navigation Key Hijacking
- **Lesson:** Binding global view-switching commands to generic keys like `Home` and `End` intercepts them globally, breaking text cursor navigation in inputs and log scroll handlers in lists.
- **Fix:** Guard global navigation shortcuts so they are disabled if a text input is active or the current view uses those keys locally for scrolling.

### 10. Concurrent Session File Writes
- **Lesson:** Writing session data at high frequencies (e.g. every 100ms on event buffers) triggers concurrent asynchronous filesystem operations on the same file path. This leads to write races, file truncation, and JSON corruption, causing syntax errors when other routines try to read the files.
- **Fix:** Serialize write operations using a promise queue per session, and write files atomically by saving to a temporary path first and then renaming it.

### 11. Silent Corruption Mitigation
- **Lesson:** Pre-existing corrupted JSON files in data folders trigger repeating read failures and log stream pollution on every state update loop.
- **Fix:** When a file fails to parse, log it once and rename it (e.g. `.json` to `.json.corrupted`) to exclude it from future directory searches while keeping the raw data available for recovery.

### 12. Codex RAG Backoff on Connection Failure
- **Lesson:** When a downstream database (like Neo4j) is offline, executing semantic/vector search queries loops through all candidates and retries, flooding TUI execution traces with standard connection failure warnings.
- **Fix:** Detect network/connection errors (`ECONNREFUSED` / `Connection refused`) on the first query attempt, mark the service as offline, and back off (returning empty results immediately) for 5 minutes.

### 13. Stack-Aware Runtime Quality Audits
- **Lesson:** Standard compilers and type checkers do not catch silent framework-specific runtime styling, loading, or semantic bugs across different tech stacks (e.g., React `createContext` inside render functions, out-of-scope hook reference, JS imports in CSS files; Python mutable default arguments in function definitions).
- **Fix:** Implement dynamic workspace tech-stack identification in [tech-stack.ts](file:///home/stephen/Vibes/src/agent/tech-stack.ts) by analyzing dependencies and files, then use [runStructuralAudit](file:///home/stephen/Vibes/src/agent/structural-audit.ts) to execute stack-specific auditing modules (skipping irrelevant checks) and prepend stack tags to Codex semantic searches in [task-executor.ts](file:///home/stephen/Vibes/src/agent/task-executor.ts).

### 11. Single-Point Stack Detection with Cascade Propagation
- **Pattern:** Detect tech stack once at plan time in `MissionPlanner`, store it on `Mission.tech_stack`, propagate it through `Scheduler` into each `executeTask(... techStack)` call so both the executor system prompt and the Codex semantic query are correctly prefixed — without re-scanning the filesystem per task.
- **Why it works:** Stack detection (filesystem scan + `package.json` parse) is I/O-expensive. Running it once at planning time keeps per-task execution overhead minimal while ensuring every prompt the executor receives contains precise language/framework context (`Tech Stack: typescript, react, css`). The fallback (`?? detectTechStack(workspaceRoot)`) in `executeTask` handles standalone test invocations gracefully.

### 14. JS Heap OOM in Long-Running Agent Loops (3 fixes)
- **Lesson:** A long-running agent harness (3+ hours, YOLO mode) will OOM if the `messages[]` array, thrash detector, and tokenizer all accumulate memory without bounds.
- **Root Cause A — Unbounded `messages[]`:** `compressMessages` only triggers when the token budget is exceeded. When a small model produces short outputs, the token count may stay under budget while the raw JS object count grows into hundreds of entries holding gigabytes of string data.
- **Root Cause B — O(n²) thrash detector:** `shouldStopAfterTurn` rebuilt the full `callHistory[]` from the entire `messages` array on every step (O(n) scan × O(n) filter = O(n²) per step). At step 500 this is scanning 1,000+ messages per turn.
- **Root Cause C — Repeated tokenization of static content:** `estimateTokens()` called `gpt-tokenizer`'s `encode()` on every message including the static system prompt every step, creating fresh `Uint32Array` buffers each time.
- **Fix A:** Add `MSG_HARD_CAP = 150` in `task-executor.ts` before the `transformContext` check. Call `compressMessages(messages, true)` (force flag) to always compress when message count exceeds the cap, regardless of token budget. (`context-manager.ts` accepts new `force = false` optional param.)
- **Fix B:** Replace the per-step rebuild in `createDefaultHooks` with a `Map<string, number>` (`_thrashCallCounts`) maintained in the closure — incremented each turn, bounded at 500 entries with insertion-order eviction. O(1) per step.
- **Fix C:** Add a module-level `TOKEN_COUNT_CACHE = new Map<string, number>()` (max 512 entries, LRU eviction) in `context-manager.ts`. `estimateTokens()` checks the cache first; static strings like the system prompt are encoded only once per session.
- **Files:** `src/agent/task-executor.ts`, `src/agent/context-manager.ts`
- **Commit:** `ag/fix-tui-breaks` — `fix: prevent JS heap OOM in agent harness (3 targeted fixes)`

### 15. Settings TUI Infinite Re-render Loop
- **Lesson:** In Ink TUIs, rendering nested child views (like SettingsView) with inline event handlers or state updates inside `useEffect` can trigger a cascading infinite re-render loop ("Maximum update depth exceeded").
- **Fix:** 
  1. Synchronize parent props to local state using a `useEffect` with stable dependencies to avoid state lag.
  2. Avoid shadowing keyboard handling names (e.g. using `pressedKey` instead of `key` inside `useInput` callback) to prevent collision with field configuration metadata.
  3. Stable memoization of callbacks passed down to views (e.g. using `useCallback` on the `onClose` handler) so that re-renders of the parent do not cause unneeded child unmounts/re-mounts.
- **Files:** `src/tui/components/settings-view.tsx`, `src/index.tsx`
- **Commit:** `fix: eliminate settings infinite re-render — key shadowing, Select mount-trigger, stable onClose`

### 16. Local Memory Activation & Init Race
- **Lesson:** Memory service initialization must be gated by `MEMORY_ENABLED` configurations to avoid constructor spam and diagnostic warning logs when memory is disabled. When using `LOCAL_MEMORY=true`, verify the existence of local JSONL paths synchronously during service bootstrap to avoid race conditions between first read/write events.
- **Fix:** Gate memory instantiation on config, improve remote connection diagnostic tips (pointing to offline/local fallback options), and enforce synchronous directories check prior to async JSONL reads.
- **Files:** `src/memory/memory-service.ts`
- **Commit:** `fix: memory service — gate on MEMORY_ENABLED, clear diagnostic for missing API key, fix local init race`

### 17. OpenAI-Style Tool Call Format Fallback Parser
- **Lesson:** Standard fallback markdown JSON tool parsers that only support custom keys like `tool` and `args` will miss tool calls from models that output standard OpenAI function calling schemas (`name` and `arguments`). This causes tasks to be marked complete without executing their underlying operations, leading to downstream errors.
- **Fix:** Extend manual tool call parsing to recognize JSON objects that possess `name` and (`arguments` or `args`) fields, ensuring compatibility with standard OpenAI formats.
- **Files:** `src/agent/task-executor.ts`
- **Commit:** `fix: manual tool call parsing — support standard OpenAI name/arguments structure`

### 18. Consecutive Turn Tool Sequence Thrash Detection
- **Lesson:** Tracking the total count of each unique tool+arguments hash globally across the entire session results in "False Positive" thrash triggers. Regular repetitive operations (like running `git status` or `npm run build` at different stages of a long mission) hit the global limit and prematurely abort the agent loop.
- **Fix:** Redesign the thrash detector to analyze the sequence of tool calls per turn. Maintain a sliding queue of the last N turns' tool call sequences, and trigger thrash detection only if the exact same sequence of tool calls (with identical names and arguments) is executed for N *consecutive* turns.
- **Files:** `src/agent/task-executor.ts`
- **Commit:** `fix: change thrash detection to track consecutive identical turn tool sequences`

### 19. Task Dependency Mapping & Milestone Fallbacks
- **Lesson:** Hardcoding empty `depends_on: []` arrays bypasses the scheduler's dependency checks. When prerequisite tasks fail (such as being blocked by security policies or failing validation), dependent downstream tasks continue to run out of sequence and fail, wasting compute and producing corrupted plans.
- **Fix:**
  1. Prompt the planner model to output string-based dependencies in `depends_on` using exact task titles.
  2. Resolve the task titles to their respective generated UUIDs in `mission-planner.ts`.
  3. Automatically inject sequential milestone fallbacks (making tasks in milestone $M$ depend on all tasks in milestone $M-1$ by default if no dependencies are defined) to prevent out-of-order execution.
- **Files:** `src/agent/mission-planner.ts`
- **Commit:** `fix: resolve task dependencies from planner and add milestone sequential fallbacks`

### 20. Thrash History Contamination & Reset Boundaries
- **Lesson:** If the loop/thrash detection sequence queue is not cleared when a task ends or is retried, the history of previous task runs contaminates loop detection. This triggers immediate "False Positive" thrash blocks when a task is retried or a new task begins with the same initial tool (such as `list_dir` or `shell`).
- **Fix:** Add a `reset` callback to the `AgentLoopHooks` interface that clears the consecutive tool sequence array, and invoke it at the start of the `TaskExecutor`'s `executeTask` loop.
- **Files:** `src/agent/types.ts`, `src/agent/task-executor.ts`
- **Commit:** `fix: reset consecutive turn thrash history at task start boundary`

### 21. Resilient Tool Argument Parsing & Auto-Normalization
- **Lesson:** LLMs frequently produce malformed tool arguments based on library defaults or other models (e.g. passing `timeout` as an object `{"total": 10}` or in seconds instead of milliseconds). When Zod validation fails, the model gets stuck in an execution failure loop, triggering thrash detection.
- **Fix:** 
  1. Define tool schemas defensively using `z.union` to support both native formats and common malformed object variants (transforming objects back to primitive types).
  2. Implement auto-normalization on parsed values inside the tool executor (e.g. converting seconds $\le 1000$ to milliseconds) to ensure expected execution runtime behavior.
- **Files:** `src/tools/shell-tool.ts`
- **Commit:** `fix: shell tool — support object-based timeout and seconds-to-milliseconds auto-normalization`

### 22. Intra-Run Tool Failure Memory Persistence
- **Lesson:** If the agent has no memory of its tool call failures across retries (because the message history resets completely on task retry), it is prone to repeating the exact same invalid commands or actions, leading to loop detection blocks.
- **Fix:** Implement the `afterToolCall` hook in `TaskExecutor` to automatically save failed tool usage logs (including the tool name, arguments, and failure result) to the memory service. This serves as "experience replay," which is retrieved at the start of any subsequent attempts of the task.
- **Files:** `src/agent/task-executor.ts`
- **Commit:** `fix: task executor — persist failed tool execution logs to memory for intra-run learning`

### 23. Source Extension Drift in Ink Components
- **Lesson:** A React/Ink component can be syntactically valid at runtime but still fail the build if it lives in a `.jsx` file while the project’s TypeScript gate expects module declarations for the imported `.js` path.
- **Fix:** Keep typed TUI components in `.tsx` and preserve the `.js` import specifier pattern used by Node16/ESM resolution. This keeps `tsx` runtime and `tsc` aligned without adding declaration-file shims.
- **Files:** `src/tui/components/settings-view.tsx`, `src/index.tsx`
- **Commit:** `fix: convert settings view to typed tsx component to satisfy build and runtime resolution`

### 24. Failure-Gated Thrash Detection
- **Lesson:** Thrash detection should not count every repeated tool sequence. Normal convergence often repeats the same read/edit/build cycle, and that should only trip when the repeated turns are actually failing end-to-end.
- **Fix:** Reset the streak whenever a turn has any successful tool result, and only treat identical consecutive turns as thrash when every tool result in the turn failed. Use a higher threshold than 2 to avoid false positives during legitimate retries.
- **Files:** `src/agent/task-executor.ts`
- **Commit:** `fix: make thrash detection count only repeated failing turns`

### 25. Benign Verification Whitelist
- **Lesson:** Small-model harnesses need a carve-out for validation-heavy convergence. Repeated read-only inspection turns and repeated build/test verification are normal progress signals, not loop signals.
- **Fix:** Treat turns composed entirely of read-only tools (`list_dir`, `file_read`, `read_lines`, `glob`, `file_outline`, `search_symbols`) or explicit verification shell commands (`npm run build`, `npm test`, `tsc`, `vitest`, `jest`, `eslint`, etc.) as benign and do not advance the thrash streak.
- **Files:** `src/agent/task-executor.ts`
- **Commit:** `fix: whitelist benign verification turns in thrash detection`

### 26. Provider Capability Error Classification
- **Lesson:** OpenAI-compatible servers can reject requests because of engine/load configuration, even when the request payload and model output are valid. Presenting these errors as malformed model output sends users toward ineffective prompt changes.
- **Fix:** Normalize known provider capability errors at the client boundary and show provider-specific remediation in the TUI. LM Studio's native draft-model speculative-decoding capability gap requires disabling the loaded model's Draft Model / Speculative Decoding setting or selecting a compatible engine.
- **Files:** `src/ollama-client.ts`, `src/tui/hooks/use-mission.ts`, `src/index.tsx`
- **Commit:** `fix: classify speculative decoding provider errors`

### 27. Token-Budgeted Memory Injection
- **Lesson:** Limiting memory retrieval by entry count does not bound prompt size because a single memory can contain thousands of tokens. Executor compaction cannot solve this reliably when memories are embedded in the preserved system prompt.
- **Fix:** Budget the complete memory section before prompt construction using 4% of `CONTEXT_WINDOW`, clamped to 1,024-6,144 tokens; cap each entry at 768 tokens; stop adding entries when the total budget is exhausted; log actual injection usage; and exclude zero-score local retrieval results.
- **Files:** `src/memory/memory-service.ts`, `src/memory/local-memory.ts`
- **Commit:** `fix: bound memory prompt injection by token budget`

### 29. Structural Audit False Positive: JSX Template Literal Brace Counting

- **Lesson:** The character-level brace scanner in `structural-audit.ts` pushes `braceDepth` onto `templateBraces` when entering `${}` inside a template literal, but **never pops it when the closing backtick exits `inTmpl`**. Files with `` className={`foo ${variable}`} `` are falsely reported as "Unclosed braces (depth: 1)", causing the agent loop to spiral (repeated list_dir, tsc hunts, 3,900+ reasoning tokens trying to parse the same line mentally).
- **Root Cause:** The triad for template literal brace tracking is: **push on `${`**, **pop on closing `}`**, **and pop on closing backtick**. The third step was missing.
- **Fix:** When `inTmpl` closes (backtick encountered), restore depth: `if (templateBraces.length > 0) braceDepth += templateBraces.pop()!;` — applied in **both** `getDefinitionBraceDepth()` and `runStructuralAudit()`.
- **Never Again:** Any character-level brace counter that tracks template literals MUST restore depth on backtick close, not just on `${}` close.
- **Files:** `src/agent/structural-audit.ts`

### 30. OpenAI Client Factory vs Singleton

- **Lesson:** `getOllamaClient() = () => new OpenAI(...)` is a factory — every call creates a fresh `undici` dispatcher with an isolated connection pool. When concurrent tasks share the same LLM host, this means N separate pools each maintaining their own TCP connections instead of sharing one.
- **Fix:** Convert to a config-aware singleton that caches the client and only re-creates when `OLLAMA_BASE_URL` or `OLLAMA_API_KEY` changes (to support live `updateConfig()` from the settings TUI). A shared singleton enables HTTP Keep-Alive reuse across all agent steps and concurrent tasks.
- **Note:** Per-step sequential LLM calls within a single `TaskExecutor` loop are correct by design. Parallelism is at the *task* level via `MAX_CONCURRENT_TASKS` in the Scheduler.
- **Files:** `src/ollama-client.ts`
