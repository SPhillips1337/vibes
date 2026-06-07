/**
 * LocalMemoryService — persistent JSONL-backed memory store.
 * Used as a local-only fallback when no remote (mem0ai) API key is available.
 */

import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';

export interface MemoryOptions {
  userId?: string;
  /** Optional override for the memory storage directory. Defaults to `.antigravity/memories/`. */
  storageDir?: string;
}

interface MemoryEntry {
  id: string;
  content: string;
  category: string;
  metadata?: Record<string, any>;
  timestamp: string;
}

export class LocalMemoryService {
  private storageDir: string;
  private userId: string;
  private initialized = false;
  private memoryCache: MemoryEntry[] = [];

  constructor(userId: string = 'default', opts?: MemoryOptions) {
    this.userId = userId;
    this.storageDir = opts?.storageDir ?? path.join(process.cwd(), '.antigravity', 'memories');
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    await fs.mkdir(this.storageDir, { recursive: true });
    await this.loadFromDisk();
    this.initialized = true;
  }

  /** Ensure service is initialized before any operation. */
  private async ensureReady(): Promise<void> {
    if (!this.initialized) await this.initialize();
  }

  /** User-scoped file path. */
  private get filePath(): string {
    return path.join(this.storageDir, `${this.userId}.jsonl`);
  }

  /** Load existing memory entries from disk. */
  private async loadFromDisk(): Promise<void> {
    try {
      const content = await fs.readFile(this.filePath, 'utf8');
      this.memoryCache = content
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as MemoryEntry);
    } catch {
      this.memoryCache = [];
    }
  }

  /** Append a single entry to disk and cache. */
  private async persistEntry(entry: MemoryEntry): Promise<void> {
    const line = JSON.stringify(entry) + '\n';
    await fs.appendFile(this.filePath, line, 'utf8');
    this.memoryCache.push(entry);
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  async addUserPreference(preference: string, category: string = 'general'): Promise<void> {
    await this.ensureReady();
    const entry: MemoryEntry = {
      id: randomUUID(),
      content: `[${category}] ${preference}`,
      category: `preference.${category}`,
      metadata: { type: 'user_preference' },
      timestamp: new Date().toISOString(),
    };
    await this.persistEntry(entry);
  }

  async addContext(context: string, metadata?: Record<string, any>): Promise<void> {
    await this.ensureReady();
    const entry: MemoryEntry = {
      id: randomUUID(),
      content: context,
      category: 'context',
      metadata: { ...metadata, type: metadata?.type || 'context' },
      timestamp: new Date().toISOString(),
    };
    await this.persistEntry(entry);
  }

  async addToolUsage(toolName: string, args: Record<string, any>, result: any): Promise<void> {
    const context = `Used tool: ${toolName} with args: ${JSON.stringify(args)}. Result: ${JSON.stringify(result).slice(0, 200)}`;
    await this.addContext(context, { type: 'tool_usage', tool: toolName });
  }

  async retrieveRelevant(query: string, topK: number = 5): Promise<string[]> {
    await this.ensureReady();
    if (this.memoryCache.length === 0) return [];

    const queryLower = query.toLowerCase();
    const queryTerms = queryLower.split(/\s+/).filter((t) => t.length > 2);

    const scored = this.memoryCache.map((entry) => {
      const contentLower = entry.content.toLowerCase();
      let score = 0;
      for (const term of queryTerms) {
        if (contentLower.includes(term)) {
          score += term.length;
        }
      }
      return { entry, score };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored
      .filter((item) => item.score > 0)
      .slice(0, topK)
      .map((item) => item.entry.content);
  }

  isEnabled(): boolean {
    return this.initialized;
  }
}

// ── Singleton factory ─────────────────────────────────────────────────────────

let globalLocalService: LocalMemoryService | null = null;

export function getLocalMemoryService(opts?: MemoryOptions): LocalMemoryService {
  if (!globalLocalService || opts?.storageDir || opts?.userId) {
    globalLocalService = new LocalMemoryService(opts?.userId ?? 'default', opts);
  }
  return globalLocalService;
}
