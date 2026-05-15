---
type: semantic
tags: [tui, ink, react, integration]
created: 2026-05-15
related: [codebase_insights/agent_architecture.md]
blast_radius: [src/tui/]
confidence: high
---

# TUI Integration: Reactive Control Surface

The Vibes TUI is built with React and Ink, providing a live window into the agent's mind.

## 1. The Dashboard (`src/tui/components/dashboard.tsx`)
- **Insight**: Decouples status from logic. It polls system resources (CPU/MEM) and monitors mission progress without directly interfering with the execution loop.

## 2. Live Execution Feed (`src/tui/components/task-view.tsx`)
- **Pattern**: Displays a filtered subset of `ExecutionEvent` objects.
- **Log Separation**: Critical architectural split between **Task View** (high-level tools/outcomes) and **Log Stream** (raw system logs).
- **Recent Change**: Removed `system_log` from the Task View to prevent "UI flooding" and ensure the user can follow the logical flow of the agent's work.

## 3. Keyboard Shortcut Guarding
- **Safety Pattern**: Global shortcuts (Alt+Key) are positioned at the top of the `useInput` hook, outside of `isTyping` guards. This allows "Emergency Stops" or "Undo" actions even when the cursor is in a text input field.
- **Collision Prevention**: Uses `Alt` (Meta) exclusively for system actions to avoid conflict with standard typing characters.
