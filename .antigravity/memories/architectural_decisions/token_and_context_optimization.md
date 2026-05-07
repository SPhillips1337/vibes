# Architectural Decision: Token & Context Optimization

## Context
Agents were frequently hitting the 32K token context limit (especially with local models like Qwen-2.5-Coder-32B). A critical bug was discovered where `file_read` was returning raw byte arrays (Buffers) instead of text strings when an encoding wasn't explicitly applied. This resulted in 10x token bloat for simple file reads.

## Decision
1.  **Zod-Enforced Defaults**: Update the `TaskExecutor` to always validate tool arguments against their Zod schemas *before* execution. This ensures that default values (like `encoding: 'utf8'`) are correctly injected even if the LLM omits them.
2.  **Explicit Tool Fallbacks**: Implement hard-coded fallbacks in file tools to ensure UTF-8 strings are returned even if validation is somehow bypassed.
3.  **Aggressive Truncation**: Maintain a strict 6K token limit per tool result to prevent a single large file from "saturating" the agent's short-term memory.

## Status
**Active** (Implemented 2026-05-06)

## Consequences
- **Positive**: Drastically reduced "amnesia" loops where the agent forgets it already read a file.
- **Positive**: 32K context windows are now sufficient for multi-file coding missions.
- **Negative**: Very large files will be truncated, requiring the agent to use `shell` commands like `grep` or `sed` for specific targeting.
