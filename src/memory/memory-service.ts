/**
 * Memory service — unified facade for remote (mem0ai) and local (JSONL) backends.
 * Switches based on config.LOCAL_MEMORY env var / config.yaml setting.
 */

import { MemoryClient } from 'mem0ai';
import { log } from '../logger.js';
import { config } from '../config.js';
import { LocalMemoryService, getLocalMemoryService, type MemoryOptions } from './local-memory.js';

export class UnifiedMemoryService {
  private client: MemoryClient | null = null;
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
      log('Memory service: No API key found, remote memory disabled', 'WARN');
      return;
    }
    try {
      this.client = new MemoryClient({ apiKey });
      this.enabled = true;
      log(`Remote memory initialized for user: ${this.userId}`, 'INFO');
    } catch (error: any) {
      log(`Failed to init remote memory: ${error.message}`, 'ERROR');
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
      return results.map((r: any) => r.content) || [];
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
    const formatted = memories.map((m, i) => `${i + 1}. ${m}`).join('\n');
    return `\nRelevant memories from previous sessions:\n${formatted}\n`;
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

export function getMemoryService(userId?: string, opts?: MemoryOptions): UnifiedMemoryService {
  if (!globalMemoryService) {
    globalMemoryService = new UnifiedMemoryService(userId || 'default_user', opts);
    // Init local backend if needed (remote is sync in constructor)
    if (globalMemoryService._useLocal) {
      globalMemoryService._localService?.initialize().catch(() => {});
    }
  }
  return globalMemoryService;
}
