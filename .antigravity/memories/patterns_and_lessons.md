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
- **Pattern:** Automatically run `git commit` before mission execution and provide a one-key `undo` (`git reset --hard HEAD~1`).
- **Why it works:** It removes the "fear of failure" for both the user and the agent. If the agent makes a massive logic error or botches a complex refactor, the user can instantly restore the workspace without manual cleanup.

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
