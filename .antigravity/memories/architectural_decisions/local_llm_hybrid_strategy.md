---
type: semantic
tags: [llm, ollama, local-ai, architecture]
created: 2026-05-15
status: active
confidence: high
---

# Architectural Decision: Local LLM Hybrid Strategy

## Context
The project requires high-performance agentic workflows without the cost or latency of cloud-only APIs.

## Decision
Adopt a **Local-First / Hybrid-Second** approach using Ollama as the primary backend.

## Details
1. **Ollama Integration**: Uses the standard OpenAI-compatible API surface for tool calling.
2. **Standardized Model Discovery**: Switched from custom `/api/tags` to `openai.models.list()`. This enables immediate compatibility with LM Studio, vLLM, and other local providers.
3. **KV-Cache Optimization**: System prompts are structured to prioritize cache hits on local servers by keeping static rules (AGENTS.md) at the top of the context window.
4. **Hot-Swapping**: The TUI settings allow real-time swapping of the `OLLAMA_BASE_URL`, enabling the agent to jump between local laptop inference and remote high-GPU servers.

## Tradeoffs
- **Pros**: Zero cost, high privacy, low latency for small/medium models.
- **Cons**: Tool-calling reliability varies between local models compared to GPT-4o. Mitigated by strict Zod schema validation.
