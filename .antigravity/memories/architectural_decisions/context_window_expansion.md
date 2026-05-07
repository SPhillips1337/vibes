# Architectural Decision: Context Window Expansion (64K Experiment)

## Context
While the 32K context window (with optimizations like string encoding and Zod validation) improved reliability, complex coding missions still occasionally triggered context compression. This compression can lead to "short-term amnesia" where the agent loses track of specific implementation details from the middle of the conversation.

## Decision
1.  **Double the Window**: Increased `CONTEXT_WINDOW` from 32,768 to 65,536 tokens.
2.  **Maintain Reserves**: Kept the 4K response reserve and 2K tool schema reserve.
3.  **Dynamic Scaling**: The `TaskExecutor` and `context-manager` already use dynamic calculation, so doubling the `.env` value automatically updates the "usable budget" display in the TUI footer.

## Status
**Experimental** (Started 2026-05-07)

## Consequences
- **Positive**: Significantly more "headroom" for large file edits and long task histories.
- **Positive**: Reduced frequency of context compression events.
- **Neutral**: Requires model support (e.g., Qwen 2.5 series or specialized Long-Context models).
- **Risk**: Potential for slightly higher latency or VRAM usage on the host machine (Ollama/LM Studio).
