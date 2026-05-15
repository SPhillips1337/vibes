---
type: semantic
tags: [agent, architecture, scheduler, executor]
created: 2026-05-15
related: [codebase_insights/tui_integration.md]
blast_radius: [src/agent/]
confidence: high
---

# Agent Architecture: The Trinity Loop

The Vibes agent engine is built on a tripartite structure that separates mission planning, task scheduling, and atomic execution.

## 1. Mission Planner (`src/agent/mission-planner.ts`)
- **Role**: High-level decomposition.
- **Insight**: It cumulatively ingests `AGENTS.md` and `DESIGN.md` into the system prompt. This ensures that the generated plan is already aligned with project-specific rules before a single line of code is written.

## 2. Scheduler (`src/agent/scheduler.ts`)
- **Role**: Dependency management and concurrency control.
- **Insight**: Uses a **Promise-blocking intervention model**. When a task fails, the scheduler doesn't exit; it parks the task in an `await` state, allowing the TUI to resolve it without losing the "warm" context of the agent's memory.
- **Concurrency**: Controlled via `config.MAX_CONCURRENT_TASKS`.

## 3. Task Executor (`src/agent/task-executor.ts`)
- **Role**: Atomic tool execution and LLM interaction.
- **Insight**: Implements **Thrashing Detection** by hashing tool calls. If an agent repeats a failing call 3 times, it triggers a mandatory pause.
- **Cache Optimization**: Uses **KV-Cache Prefixing** (static rules at the top, dynamic context at the bottom) to minimize latency on local inference engines like Ollama.
