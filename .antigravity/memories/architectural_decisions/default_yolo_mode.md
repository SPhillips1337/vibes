---
type: semantic
tags: [agent, yolo-mode, defaults, mission-execution]
created: 2026-05-15
related: [src/config.ts, src/tui/hooks/use-mission.ts, src/agent/task-executor.ts]
blast_radius: [task-execution, step-limits]
confidence: high
---

# AD: Default YOLO Mode

## Context
Vibes TUI previously defaulted to a strict step limit (MAX_STEPS) for agent tasks. While safer, this frequently interrupted workflows for complex tasks that required more than 25 steps, leading to user friction and repeated requests to increase step limits manually.

## Decision
As of May 15, 2026, **YOLO Mode** is now enabled by default.
- `YOLO_MODE` in `config.ts` defaults to `true`.
- `TaskExecutor` and `Scheduler` default to YOLO behavior if no mode is explicitly provided.
- The TUI initializes with YOLO mode active.

## Rationale
- **User Momentum**: Users working in high-velocity environments (like Antigravity) prefer uninterrupted task execution.
- **Intervention System**: The existing `thrashing detection` and `intervention manager` provide sufficient safety. Even in YOLO mode, the agent will stop and ask for help if it detects a loop or hits a very high (9999) step threshold.
- **Git Snapshots**: Automatic git snapshots before every mission provide an "Undo" safety net, making high-autonomy execution less risky.

## Consequences
- Agents will execute until the mission is complete or they get stuck, without artificial pauses at step 25.
- "Step Limit Exceeded" errors will be rare.
- Token consumption may increase for long-running tasks, but overall mission completion speed is improved.
