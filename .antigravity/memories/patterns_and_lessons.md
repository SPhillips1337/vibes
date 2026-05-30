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

