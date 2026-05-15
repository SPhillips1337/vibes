---
type: semantic
tags: [safety, intervention, loop-prevention, agent]
created: 2026-05-15
status: active
confidence: high
---

# Architectural Decision: Safety & Intervention System

## Context
Agentic loops can enter "Infinite Thrashing" states when they encounter errors they cannot self-correct, burning compute and tokens.

## Decision
Implement a multi-layered safety net involving **Thrashing Detection**, **Zombie Process Killing**, and **Human-in-the-Loop Interventions**.

## Details
1. **Logic-Level Thrashing**: The `TaskExecutor` hashes recent tool calls. A repeat of the same failing call 3 times triggers a mandatory pause.
2. **Zombie Cleanup**: Background shell processes are tracked and issued a `SIGKILL` if the mission is aborted or if they time out.
3. **Promise-Blocking UI**: Interventions block the scheduler's internal loop using an awaited Promise. The TUI resolves this Promise when the user provides guidance.
4. **Undo Momentum**: Uses git snapshots (`git commit -am "vibes: pre-mission snapshot"`) before each mission to allow a "one-click" full rollback of agent changes.

## Tradeoffs
- **Pros**: Prevents catastrophic codebase damage and compute waste.
- **Cons**: Adds latency to autonomous tasks. Mitigated by "YOLO Mode" which raises intervention thresholds for trusted operations.
