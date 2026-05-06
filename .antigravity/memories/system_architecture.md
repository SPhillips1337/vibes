# Vibes TUI: Core Architecture & LTM

## System Overview
Vibes is a reactive TUI agent system built with **Ink** and **Ollama/LM Studio**. It uses a sophisticated scheduling and intervention protocol to handle long-running coding tasks with human-in-the-loop capabilities.

## Key Components

### 1. The Scheduler (Promise-Wait Pattern)
Unlike standard event-loop schedulers, the Vibes Scheduler uses a **Promise-blocking intervention pattern**.
- **Execution:** Tasks are run asynchronously but the scheduler loop respects a `awaiting_intervention` status.
- **Intervention Gate:** When a task fails, the scheduler triggers an intervention and returns a `Promise` that blocks the task's completion until a human resolves it.
- **Direct Resolution:** The UI (via `useMission` hook) holds a `ref` to the Scheduler and calls `resolveIntervention()` directly. This bypasses React state lag and ensures `extraSteps` or `userGuidance` are applied immediately to the internal `taskMap`.

### 2. Intervention Manager
A dedicated service that uses the LLM to analyze failures.
- **Timeout Protection:** Formulating a question has a 10s timeout to prevent TUI hangs if the LLM is slow.
- **Contextual Guidance:** The agent asks the user a specific question. If the user replies with text, it is injected into the next retry as `[USER GUIDANCE]`.

### 3. YOLO Mode (Alt+Y)
A "no-limits" execution mode.
- **Implementation:** Sets the step limit to 9999.
- **Live Toggling:** The `TaskExecutor` checks the `isYoloMode` flag *every step*, meaning you can unlock a stalling agent mid-mission without restarting.

### 4. Context Management
- **Token Budget:** Optimized for 32K context windows.
- **Concurrency:** `MAX_CONCURRENT_TASKS` is default to `1` to prevent LM Studio context-splitting errors (400 Bad Request) and file write collisions.

## Critical Patterns for Future Agents
- **Always use `ref` for Scheduler state:** React state is for the UI; the Scheduler needs direct access to mutable objects to avoid "ghost retries" (where settings like `extraSteps` are lost).
- **Smart Step Parsing:** When a user replies to an intervention, the system regex-parses phrases like "add 50 steps" to automatically bump the budget.
- **Heartbeat Animation:** Always ensure `isExecuting` or `isPlanning` triggers the `dots` heartbeat to signal activity to the user.

## Session Log (2026-05-06)
- Implemented Heartbeat and Intervention UI.
- Fixed "ghost retry" bug by moving resolution logic into the Scheduler via Promises.
- Added YOLO Mode with live toggling via `Alt+Y`.
- Fixed Meta-key leakage (Alt+Y typing 'y') by guarding shortcuts with `!isIdle`.
