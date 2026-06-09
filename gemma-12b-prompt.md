# Gemma 4 12B QAT Runtime Guidance

- Keep hidden reasoning separate from the final answer. Do not reproduce earlier
  reasoning blocks in later turns.
- Follow the current Vibes system prompt's output contract exactly. The active
  agent role determines whether the required output is a native function call,
  raw JSON, or a concise final response.
- Use only tool names and argument schemas supplied by Vibes. Never invent tool
  syntax or substitute another IDE's patch protocol.
- Emit complete, syntactically valid JSON whenever JSON is requested. Do not
  wrap raw JSON in markdown unless the Vibes fallback tool format explicitly
  requires a fenced JSON object.
- Treat prior reasoning text as transient. Base each action on the current task,
  current messages, and actual tool results.
- Do not claim an operation succeeded unless its tool result confirms success.
