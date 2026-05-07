# Codebase Insight: Scheduler & Intervention Protocol

## Hidden Knowledge
The Vibes TUI uses a "Warm Restart" pattern for human-in-the-loop interventions. Unlike many agents that simply stop and wait for a new prompt, Vibes blocks the *internal* execution of a task using a `Promise` that is stored in the `Scheduler`.

### Key Mechanism
1.  **Detection**: The `TaskExecutor` detects a failure or a complex decision.
2.  **Notification**: An `intervention_required` event is emitted.
3.  **Blocking**: The `Scheduler` creates a new `Promise`. It stores the `resolve` and `reject` functions in an internal map.
4.  **UI Bridge**: The `useMission` hook holds a `useRef` to the active `Scheduler`. When the user clicks "Approve" or submits guidance, the UI calls `scheduler.resolveIntervention()`.
5.  **Resumption**: The original `executeTask` call (which was `awaiting` the promise) resumes immediately with the user's guidance injected into its history.

### Why this is critical
If you try to manage interventions using purely React state, the "ghost retry" bug occurs. The UI might show the update, but the agent's actual execution thread might have already timed out or moved on to a generic retry without the human's input. The **Promise-blocking pattern** is the only way to ensure the agent's memory stays perfectly in sync with the human's guidance.
