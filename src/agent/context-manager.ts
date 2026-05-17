import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { config } from '../config.js';
import { log } from '../logger.js';
import { encode, decode } from 'gpt-tokenizer';

const RESPONSE_RESERVE_TOKENS = 4096;
const TOOL_SCHEMA_RESERVE_TOKENS = 2048;

export function estimateTokens(text: string): number {
  return encode(text).length;
}

export function estimateMessagesTokens(messages: ChatCompletionMessageParam[]): number {
  let total = 0;
  for (const msg of messages) {
    total += 4;
    if (typeof msg.content === 'string') {
      total += estimateTokens(msg.content);
    } else if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if ('text' in part) total += estimateTokens(part.text);
      }
    }
    if ('tool_calls' in msg && msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        total += estimateTokens(tc.function.name);
        total += estimateTokens(tc.function.arguments);
      }
    }
  }
  return total;
}

export function getUsableBudget(): number {
  return config.CONTEXT_WINDOW - RESPONSE_RESERVE_TOKENS - TOOL_SCHEMA_RESERVE_TOKENS;
}

export function truncateToTokenBudget(text: string, maxTokens: number): string {
  const tokens = encode(text);
  if (tokens.length <= maxTokens) return text;
  const truncatedTokens = tokens.slice(0, maxTokens - 20);
  const truncatedText = decode(truncatedTokens);
  return truncatedText + `\n\n[... truncated ${tokens.length - maxTokens} tokens to fit context window]`;
}

export function truncateToolResult(content: string, toolName: string): string {
  const maxPerResult = Math.min(Math.floor(getUsableBudget() * 0.25), 6144);
  const currentTokens = estimateTokens(content);
  if (currentTokens <= maxPerResult) return content;
  log(`Truncating ${toolName} result from ~${currentTokens} to ~${maxPerResult} tokens`, 'WARN');
  return truncateToTokenBudget(content, maxPerResult);
}

/**
 * compressMessages — synchronous context summarisation.
 * Delegates to the new compaction module.
 */
export function compressMessages(messages: ChatCompletionMessageParam[]): ChatCompletionMessageParam[] {
  // Avoid circular import: compaction.ts imports estimateTokens from here,
  // so we embed the summarisation logic here and expose it under both names.
  const budget = getUsableBudget();
  const currentTokens = estimateMessagesTokens(messages);
  if (currentTokens <= budget) return messages;

  log(`Context compression triggered: ~${currentTokens} tokens exceeds ~${budget} budget`, 'WARN');

  const PRESERVE_HEAD = 2;
  const PRESERVE_TAIL = 6;

  if (messages.length <= PRESERVE_HEAD + PRESERVE_TAIL) {
    return messages.map((msg, i) => {
      if (i === 0) return msg;
      if (typeof msg.content === 'string' && estimateTokens(msg.content) > 1024) {
        return { ...msg, content: truncateToTokenBudget(msg.content, 1024) };
      }
      return msg;
    });
  }

  const head = messages.slice(0, PRESERVE_HEAD);
  const tail = messages.slice(-PRESERVE_TAIL);
  const middle = messages.slice(PRESERVE_HEAD, messages.length - PRESERVE_TAIL);

  const summaryParts: string[] = [];
  for (const msg of middle) {
    if (msg.role === 'assistant' && typeof msg.content === 'string' && msg.content.trim()) {
      summaryParts.push(`[Agent] ${msg.content.slice(0, 150)}`);
    } else if (msg.role === 'assistant' && 'tool_calls' in msg && msg.tool_calls) {
      const calls = (msg as any).tool_calls.map((tc: any) => tc.function.name).join(', ');
      summaryParts.push(`[Agent called: ${calls}]`);
    } else if (msg.role === 'tool' && typeof msg.content === 'string') {
      const preview = msg.content.slice(0, 80);
      summaryParts.push(`[Tool result: ${preview}...]`);
    }
  }

  const summaryText = `[CONTEXT COMPRESSED - ${middle.length} messages summarized]\n` + summaryParts.join('\n');
  const summaryMessage: ChatCompletionMessageParam = {
    role: 'user',
    content: truncateToTokenBudget(summaryText, 1024),
  };

  const compressed = [...head, summaryMessage, ...tail];
  const newTokens = estimateMessagesTokens(compressed);
  log(`Context compressed: ~${currentTokens} → ~${newTokens} tokens (removed ${middle.length} messages)`, 'INFO');

  if (newTokens > budget && compressed.length > PRESERVE_HEAD + PRESERVE_TAIL + 1) {
    return compressMessages(compressed);
  }
  return compressed;
}

export function getContextStats(messages: ChatCompletionMessageParam[]) {
  const used = estimateMessagesTokens(messages);
  const total = config.CONTEXT_WINDOW;
  const usable = getUsableBudget();
  const percentage = Math.round((used / usable) * 100);
  return { used, total, usable, percentage };
}
