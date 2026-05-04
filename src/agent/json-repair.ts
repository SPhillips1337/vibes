/**
 * Attempts to repair common JSON errors from LLMs
 */
export function repairJson(json: string): string {
  let repaired = json.trim();

  // Remove any markdown code blocks
  if (repaired.includes('```')) {
    const matches = repaired.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (matches && matches[1]) {
      repaired = matches[1].trim();
    }
  }

  // Basic repairs for common LLM issues
  
  // 1. Remove trailing commas before closing braces/brackets
  repaired = repaired.replace(/,\s*([}\]])/g, '$1');

  // 2. Attempt to fix unterminated strings (heuristic)
  // If we have an odd number of quotes on a line, it's likely a problem
  // But this is risky, so we'll be conservative.

  // 3. Ensure it starts and ends with braces
  if (!repaired.startsWith('{')) repaired = '{' + repaired;
  
  // Count braces to find missing closures
  let openBraces = 0;
  let openBrackets = 0;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < repaired.length; i++) {
    const char = repaired[i];
    if (char === '"' && !escaped) inString = !inString;
    if (inString) {
      if (char === '\\') escaped = !escaped;
      else escaped = false;
      continue;
    }
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
