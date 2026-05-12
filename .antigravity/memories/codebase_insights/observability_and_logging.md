---
type: semantic
tags: [observability, logging, tui, events]
created: 2026-05-12
related: [src/logger.ts, src/tui/hooks/use-mission.ts, src/tui/components/log-stream-view.tsx]
blast_radius: [logger, tui-main]
confidence: high
---

# Observability and Logging Pattern

## System Log Streaming
To allow real-time inspection of agent reasoning and system behavior without leaving the TUI, Vibes implements a listener-based log streaming pattern.

### 1. Unified Event Stream
All significant actions are captured as `ExecutionEvent` objects. This includes:
- `thinking`: Agent internal reasoning.
- `tool_call` / `tool_result`: Interactive tool usage.
- `system_log`: Low-level system logs (INFO, WARN, ERROR, DEBUG) captured from `src/logger.ts`.

### 2. Logger Listeners
`src/logger.ts` maintains a set of `LogListeners`. When `log()` is called, it writes to `/tmp/vibes-debug.log` and notifies all listeners. 
The `useMission` hook registers a listener on mount to pipe these logs into the React `events` state.

### 3. Log Stream View
The `LogStreamView` component (accessible via `Alt+L`) provides a dedicated, high-density stream of the last 50 events. This is the primary tool for debugging "why" an agent is taking a certain action or why a tool failed.

## Best Practices
- **Use `log()` for system state**: Use the standard logger for anything that helps debug the infrastructure.
- **Use `ExecutionEvent` for agent state**: Use the scheduler/executor event stream for anything specific to task execution.
- **Keep it compact**: Log messages in the TUI should be concise to avoid cluttering the terminal.
