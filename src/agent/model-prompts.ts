import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { log } from '../logger.js';

export type ModelPromptRole = 'executor' | 'planner' | 'reviewer' | 'triage';

const GEMMA_12B_PROMPT_PATH = fileURLToPath(
  new URL('../../gemma-12b-prompt.md', import.meta.url),
);

const GEMMA_12B_FALLBACK = `# Gemma 4 12B QAT Runtime Guidance

- Keep hidden reasoning separate from the final answer.
- Follow the current system prompt's output contract exactly.
- Use only tool names and argument schemas supplied by the runtime.
- Emit complete, syntactically valid JSON whenever JSON is requested.
- Treat prior reasoning text as transient; rely on current messages and tool results.`;

let cachedGemmaPrompt: string | undefined;

export function isGemma12BModel(modelName: string): boolean {
  const normalized = modelName.toLowerCase().replace(/[^a-z0-9]+/g, '');
  return normalized.includes('gemma') && normalized.includes('12b');
}

function loadGemma12BPrompt(): string {
  if (cachedGemmaPrompt !== undefined) return cachedGemmaPrompt;

  try {
    cachedGemmaPrompt = readFileSync(GEMMA_12B_PROMPT_PATH, 'utf8').trim();
    log(`Loaded Gemma 12B runtime prompt from ${GEMMA_12B_PROMPT_PATH}`, 'DEBUG');
  } catch (err) {
    cachedGemmaPrompt = GEMMA_12B_FALLBACK;
    log(
      `Failed to load bundled Gemma 12B prompt; using fallback: ${err instanceof Error ? err.message : String(err)}`,
      'WARN',
    );
  }

  return cachedGemmaPrompt;
}

function getRoleContract(role: ModelPromptRole): string {
  switch (role) {
    case 'executor':
      return `VIBES EXECUTOR CONTRACT:
- Prefer the native Vibes function tools supplied with the request.
- Do not emit unified diffs unless a tool result explicitly asks for one.
- If native tool calling is unavailable, use the JSON fallback format defined by the main system prompt.
- After tool execution, report completion only when the acceptance criteria have been verified.`;
    case 'planner':
      return `VIBES PLANNER CONTRACT:
- Return exactly one raw JSON mission-plan object matching the schema in the main system prompt.
- Do not use markdown fences, tool calls, commentary, or unified diffs.`;
    case 'reviewer':
      return `VIBES REVIEWER CONTRACT:
- Return exactly one raw JSON review object matching the schema in the main system prompt.
- Do not use markdown fences, tool calls, commentary, or unified diffs.`;
    case 'triage':
      return `VIBES TRIAGE CONTRACT:
- When a triage function tool is supplied, call that tool with schema-valid arguments.
- Otherwise return exactly one raw JSON object matching the requested triage schema.
- Do not include commentary, markdown fences, or code changes.`;
  }
}

export function getModelSpecificPrompt(modelName: string, role: ModelPromptRole): string {
  if (!isGemma12BModel(modelName)) return '';

  return `\n\n[MODEL-SPECIFIC INSTRUCTIONS: GEMMA 4 12B QAT]
${loadGemma12BPrompt()}

${getRoleContract(role)}
[END MODEL-SPECIFIC INSTRUCTIONS]\n`;
}
