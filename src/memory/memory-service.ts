/**
 * Memory service — unified facade for remote (mem0ai) and local (JSONL) backends.
 * Switches based on config.LOCAL_MEMORY env var / config.yaml setting.
 */

import { log } from '../logger.js';
import { config } from '../config.js';
import { LocalMemoryService, getLocalMemoryService, type MemoryOptions } from './local-memory.js';
import { estimateTokens, truncateToTokenBudget } from '../agent/context-manager.js';

const MEMORY_CONTEXT_RATIO = 0.04;
const MIN_MEMORY_TOKENS = 1024;
const MAX_MEMORY_TOKENS = 6144;
const MAX_MEMORY_ENTRY_TOKENS = 768;

interface RemoteMemoryResult {
  memory?: string;
  data?: { memory: string } | null;
}

interface RemoteMemoryClient {
  add(
    messages: Array<{ role: 'user' | 'assistant'; content: string }>,
    options: Record<string, unknown>,
  ): Promise<unknown>;
  search(query: string, options: Record<string, unknown>): Promise<RemoteMemoryResult[]>;
}

export class UnifiedMemoryService {
  private client: RemoteMemoryClient | null = null;
  private userId: string;
  private enabled: boolean = false;
  private useLocal: boolean;
  private localService: LocalMemoryService | null = null;

  constructor(userId: string = 'default', opts?: MemoryOptions) {
    this.userId = userId;
    this.useLocal = Boolean(config.LOCAL_MEMORY);
    if (this.useLocal) {
      this.localService = getLocalMemoryService({ userId, ...opts });
    } else {
      this.initializeRemote();
    }
  }

  private async initializeRemote() {
    const apiKey = process.env.OPENAI_API_KEY || process.env.MEM0_API_KEY;
    if (!apiKey) {
      log(
        'Memory service: No MEM0_API_KEY or OPENAI_API_KEY found — remote memory disabled.\n' +
        '  → To use memory without an API key, set LOCAL_MEMORY=true in your .env.',
        'WARN',
      );
      return;
    }
    try {
      const { MemoryClient } = await import('mem0ai');
      this.client = new MemoryClient({ apiKey });
      this.enabled = true;
      log(`Remote memory initialized for user: ${this.userId}`, 'INFO');
    } catch (error: any) {
      const installHint = error?.code === 'ERR_MODULE_NOT_FOUND'
        ? ' Install the optional integration with: npm install mem0ai'
        : '';
      log(`Failed to init remote memory: ${error.message}.${installHint}`, 'ERROR');
      this.enabled = false;
    }
  }

  // ── Unified API ────────────────────────────────────────────────────────────

  async addUserPreference(preference: string, category: string = 'general'): Promise<void> {
    if (this.useLocal) {
      await this.localService?.addUserPreference(preference, category).catch(() => {});
      return;
    }
    if (!this.enabled || !this.client) return;
    try {
      await this.client.add(
        [{ role: 'user', content: `[${category}] ${preference}` }],
        { user_id: this.userId },
      );
    } catch (err: any) {
      log(`Failed to add preference: ${err.message}`, 'ERROR');
    }
  }

  async addContext(context: string, metadata?: Record<string, any>): Promise<void> {
    if (this.useLocal) {
      await this.localService?.addContext(context, metadata).catch(() => {});
      return;
    }
    if (!this.enabled || !this.client) return;
    try {
      await this.client.add(
        [{ role: 'user', content: context }],
        { user_id: this.userId, ...metadata },
      );
    } catch (err: any) {
      log(`Failed to add context: ${err.message}`, 'ERROR');
    }
  }

  async addToolUsage(toolName: string, args: Record<string, any>, result: any): Promise<void> {
    if (this.useLocal) {
      await this.localService?.addToolUsage(toolName, args, result).catch(() => {});
      return;
    }
    const content = `Used tool: ${toolName} with args: ${JSON.stringify(args)}. Result: ${JSON.stringify(result).slice(0, 200)}`;
    await this.addContext(content, { type: 'tool_usage', tool: toolName });
  }

  async retrieveRelevant(query: string, topK: number = 5): Promise<string[]> {
    if (this.useLocal) return this.localService?.retrieveRelevant(query, topK) || [];
    if (!this.enabled || !this.client) return [];
    try {
      const results = await this.client.search(query, { user_id: this.userId, limit: topK });
      return results
        .map((result) => result.memory ?? result.data?.memory)
        .filter((memory): memory is string => Boolean(memory));
    } catch (err: any) {
      log(`Memory retrieve error: ${err.message}`, 'ERROR');
      return [];
    }
  }

  async getUserPreferences(): Promise<string[]> {
    return this.retrieveRelevant('user preference settings', 10);
  }

  async getRecentContext(limit: number = 10): Promise<string[]> {
    return this.retrieveRelevant('code context file structure workspace', limit);
  }

  formatMemoriesForPrompt(memories: string[]): string {
    if (memories.length === 0) return '';

    const totalBudget = Math.min(
      MAX_MEMORY_TOKENS,
      Math.max(MIN_MEMORY_TOKENS, Math.floor(config.CONTEXT_WINDOW * MEMORY_CONTEXT_RATIO)),
    );
    const header = '\nRelevant memories from previous sessions:\n';
    const footer = '\n';
    const selected: string[] = [];

    for (const memory of memories) {
      const entry = truncateToTokenBudget(memory, MAX_MEMORY_ENTRY_TOKENS);
      const numberedEntry = `${selected.length + 1}. ${entry}`;
      const candidate = `${header}${[...selected, numberedEntry].join('\n')}${footer}`;

      if (estimateTokens(candidate) <= totalBudget) {
        selected.push(numberedEntry);
        continue;
      }

      const current = `${header}${selected.join('\n')}${selected.length ? '\n' : ''}`;
      const entryPrefix = `${selected.length + 1}. `;
      const remainingTokens = totalBudget
        - estimateTokens(current)
        - estimateTokens(entryPrefix)
        - estimateTokens(footer);
      if (remainingTokens >= 64) {
        selected.push(
          `${entryPrefix}${truncateToTokenBudget(memory, remainingTokens)}`,
        );
      }
      break;
    }

    if (selected.length === 0) return '';

    const formatted = `${header}${selected.join('\n')}${footer}`;
    log(
      `Memory injection: ${selected.length}/${memories.length} entries, ~${estimateTokens(formatted)}/${totalBudget} tokens`,
      'DEBUG',
    );
    return formatted;
  }

  async addConversationTurn(role: 'user' | 'assistant', content: string): Promise<void> {
    const prefix = role === 'user' ? 'User said:' : 'Assistant responded:';
    await this.addContext(`${prefix} ${content}`, { type: 'conversation', role });
  }

  async addMissionSummary(missionTitle: string, tasksCompleted: string[]): Promise<void> {
    await this.addContext(
      `Completed mission: ${missionTitle}. Tasks: ${tasksCompleted.join(', ')}`,
      { type: 'mission', title: missionTitle },
    );
  }

  isEnabled(): boolean {
    return this.useLocal ? (this.localService?.isEnabled() ?? false) : this.enabled;
  }

  /** Expose local flag for factory initialisation. */
  get _useLocal(): boolean {
    return this.useLocal;
  }

  /** Expose local service instance for factory initialisation. */
  get _localService(): LocalMemoryService | null {
    return this.localService;
  }
}

let globalMemoryService: UnifiedMemoryService | null = null;

/** No-op stub returned when MEMORY_ENABLED=false, so callers never need null-checks. */
const _disabledService = new UnifiedMemoryService('disabled');

export function getMemoryService(userId?: string, opts?: MemoryOptions): UnifiedMemoryService {
  // Respect the MEMORY_ENABLED flag — the constructor was previously always run
  // regardless, which caused misleading "memory disabled" log spam on every task.
  if (!config.MEMORY_ENABLED) return _disabledService;

  if (!globalMemoryService) {
    globalMemoryService = new UnifiedMemoryService(userId || config.MEMORY_USER_ID || 'default_user', opts);
    // Await local backend initialization so isEnabled() is true before tasks run.
    // Fire-and-forget was the original pattern, but it caused a race where the
    // first task saw isEnabled()=false and skipped memory entirely.
    if (globalMemoryService._useLocal && globalMemoryService._localService) {
      globalMemoryService._localService.initialize().catch((err) => {
        log(`Local memory initialization failed: ${err?.message ?? err}`, 'ERROR');
      });
    }
  }
  return globalMemoryService;
}
