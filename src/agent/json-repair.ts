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

  // Remove trailing commas only when not inside strings
  let result = '';
  let inString = false;
  let escaped = false;

  for (let i = 0; i < repaired.length; i++) {
    const char = repaired[i];
    const nextChar = i + 1 < repaired.length ? repaired[i + 1] : '';

    // Handle string state
    if (char === '"' && !escaped) {
      inString = !inString;
      result += char;
      continue;
    }

    if (inString) {
      if (char === '\\') escaped = !escaped;
      else escaped = false;
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

  // Ensure it starts and ends with braces
  if (!repaired.startsWith('{')) repaired = '{' + repaired;
  
  // Count braces to find missing closures
  let openBraces = 0;
  let openBrackets = 0;
  inString = false;
  escaped = false;

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
