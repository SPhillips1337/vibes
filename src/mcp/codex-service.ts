import { execFile } from 'child_process';
import { promisify } from 'util';
import { config } from '../config.js';
import { log } from '../logger.js';

const execAsync = promisify(execFile);

const CODEX_SCRIPT = '/home/stephen/Documents/www/LLM-Codex-Reference-Vault/codex_search.py';
const PYTHON = '/home/stephen/Documents/www/LLM-Codex-Reference-Vault/venv/bin/python';

export interface CodexResult {
  document: string;
  text: string;
  code_snippets: { lang: string; code: string }[];
  score: number;
}

export interface CodexSearchResponse {
  results: CodexResult[];
  count: number;
}

class CodexService {
  private enabled = false;

  init(): void {
    this.enabled = config.CODEX_ENABLED;
    if (this.enabled) {
      log('Codex service initialized (Neo4j semantic search RAG)', 'INFO');
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  async search(query: string, topK?: number): Promise<CodexSearchResponse> {
    const k = topK ?? config.CODEX_TOP_K;
    try {
      const { stdout, stderr } = await execAsync(PYTHON, [CODEX_SCRIPT, query, String(k)], {
        timeout: 30000,
        env: {
          ...process.env,
          CODEX_OLLAMA_HOST: 'http://192.168.5.157:1234',
        },
      });
      if (stderr) {
        log(`Codex search stderr: ${stderr.slice(0, 200)}`, 'DEBUG');
      }
      const parsed: CodexSearchResponse = JSON.parse(stdout);
      log(`Codex search: "${query.slice(0, 60)}" → ${parsed.count} results`, 'INFO');
      return parsed;
    } catch (err: any) {
      log(`Codex search failed: ${err.message}`, 'WARN');
      return { results: [], count: 0 };
    }
  }

  formatForPrompt(query: string): string {
    return `[CODEX REFERENCE PATTERNS — Retrieved from Neo4j Knowledge Graph for: "${query}"]`;
  }

  async retrieveAndFormat(query: string): Promise<string> {
    if (!this.enabled) return '';

    const response = await this.search(query, config.CODEX_TOP_K);
    if (response.count === 0) return '';

    let result = `\n\n[CODEX REFERENCE PATTERNS — Retrieved from Neo4j Knowledge Graph for: "${query}"]\n`;
    for (let i = 0; i < response.results.length; i++) {
      const r = response.results[i];
      result += `\n--- Reference ${i + 1} (Score: ${r.score}) | Source: ${r.document} ---\n`;
      result += r.text.slice(0, 600);
      if (r.text.length > 600) result += '...';
      if (r.code_snippets.length > 0) {
        result += '\n\nExample code:\n';
        for (const s of r.code_snippets.slice(0, 2)) {
          result += `\`\`\`${s.lang}\n${s.code.slice(0, 400)}`;
          if (s.code.length > 400) result += '\n...';
          result += '\n```\n';
        }
      }
    }
    result += '\n\n[END CODEX REFERENCE PATTERNS]';
    return result;
  }
}

let instance: CodexService | undefined;

export function getCodexService(): CodexService {
  if (!instance) {
    instance = new CodexService();
    instance.init();
  }
  return instance;
}
