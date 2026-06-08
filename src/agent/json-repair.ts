/**
 * Strip reasoning preamble and extract the raw JSON string from a model response.
 *
 * Handles three cases, in order:
 *   1. Closed <think>...</think> block  — strip with non-greedy regex, then find JSON.
 *   2. Unclosed <think> block (model cut off mid-reasoning) — strip everything
 *      up to the first '{' that appears at the start of a line (the real JSON root).
 *   3. Markdown code fences (```json ... ```) — strip fences.
 *
 * Exported as `extractJsonContent` for use by mission-planner and other callers
 * that want the cleaned string before attempting JSON.parse.
 */
export function extractJsonContent(text: string): string {
  let trimmed = text.trim();

  // Case 1: fully closed <think>...</think> block(s)
  if (/<\/think>/i.test(trimmed)) {
    trimmed = trimmed.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  } else if (/<think>/i.test(trimmed)) {
    // Case 2: unclosed <think> — find the first '{' at the start of a line
    // (i.e. the JSON root object) and discard everything before it.
    const lineStartJson = trimmed.match(/^\{/m);
    if (lineStartJson && lineStartJson.index !== undefined) {
      trimmed = trimmed.slice(lineStartJson.index).trim();
    } else {
      // Fallback: strip the whole <think> tag and everything until the first '{'.
      // Guard against very large inputs before the greedy [\.\s\S]* match.
      if (trimmed.length > 200_000) trimmed = trimmed.slice(0, 200_000);
      trimmed = trimmed.replace(/<think>\s*[\s\S]*/, '').trim();
    }
  }

  // Strip markdown code fences if present
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenceMatch && fenceMatch[1]) {
    trimmed = fenceMatch[1].trim();
  }

  return trimmed || text.trim();
}

/**
 * Extract JSON object from text that may contain preamble (thinking tokens, etc.)
 * Internal helper used by repairJson.  Returns null when no JSON object/array
 * root delimiter is found.
 */
function extractJson(text: string): string | null {
  let trimmed = extractJsonContent(text);

  // Try to find a complete JSON object: first '{' to matching '}'
  const start = trimmed.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inStr = false;
  let escaped = false;
  for (let i = start; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (!escaped && ch === '"') inStr = !inStr;
    if (!inStr) {
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
    }
    escaped = !escaped && ch === '\\';
    if (depth === 0 && i > start) {
      return trimmed.slice(start, i + 1);
    }
  }
  // No closing brace found — return from start onward
  return trimmed.slice(start);
}

/**
 * Attempts to repair common JSON errors from LLMs
 */
export function repairJson(json: string): string | null {
  const extracted = extractJson(json);
  if (extracted === null) return null;

  let repaired = extracted;

  // Remove any markdown code blocks
  if (repaired.includes('```')) {
    const matches = repaired.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (matches && matches[1]) {
      repaired = matches[1].trim();
    }
  }

  // Remove trailing commas only when not inside strings
  let result = '';
  let inString = false;
  let escaped = false;

  for (let i = 0; i < repaired.length; i++) {
    const char = repaired[i];
    const nextChar = i + 1 < repaired.length ? repaired[i + 1] : '';

    // Handle string state
    if (!escaped && char === '"') {
      inString = !inString;
      result += char;
      continue;
    }

    if (inString) {
      escaped = !escaped && char === '\\';
      result += char;
      continue;
    }

    escaped = false;

    // Skip comma if it's a trailing comma before } or ]
    if (char === ',' && (nextChar === '}' || nextChar === ']')) {
      continue;
    }

    result += char;
  }

  repaired = result;

  // Count braces to find missing closures
  let openBraces = 0;
  let openBrackets = 0;
  inString = false;
  escaped = false;

  for (let i = 0; i < repaired.length; i++) {
    const char = repaired[i];
    if (!escaped && char === '"') inString = !inString;
    if (inString) {
      escaped = !escaped && char === '\\';
      continue;
    }
    escaped = false;
    if (char === '{') openBraces++;
    if (char === '}') openBraces--;
    if (char === '[') openBrackets++;
    if (char === ']') openBrackets--;
  }

  // Close any open structures
  while (openBrackets > 0) {
    repaired += ']';
    openBrackets--;
  }
  while (openBraces > 0) {
    repaired += '}';
    openBraces--;
  }

  return repaired;
}
