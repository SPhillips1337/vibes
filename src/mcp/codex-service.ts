import { execFile } from 'child_process';
import { existsSync } from 'fs';
import { promisify } from 'util';
import { config } from '../config.js';
import { log } from '../logger.js';

const execAsync = promisify(execFile);

const CODEX_SCRIPT = process.env.CODEX_SCRIPT_PATH || '/home/stephen/Documents/www/LLM-Codex-Reference-Vault/codex_search.py';
const PYTHON = process.env.CODEX_PYTHON_PATH || '/home/stephen/Documents/www/LLM-Codex-Reference-Vault/venv/bin/python';

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
  private inited = false;
  private offline = false;
  private lastOfflineCheck = 0;

  init(): void {
    if (!existsSync(CODEX_SCRIPT)) {
      log(`Codex script not found: ${CODEX_SCRIPT}. Set CODEX_SCRIPT_PATH env var or set CODEX_ENABLED=false.`, 'WARN');
    }
    if (!existsSync(PYTHON)) {
      log(`Codex python not found: ${PYTHON}. Set CODEX_PYTHON_PATH env var or set CODEX_ENABLED=false.`, 'WARN');
    }
    this.inited = true;
    log('Codex service initialized (Neo4j semantic search RAG)', 'INFO');
  }

  isEnabled(): boolean {
    return config.CODEX_ENABLED;
  }

  private async runCodexSearch(query: string, topK: number, embeddingHostOverride?: string): Promise<CodexSearchResponse> {
    const { stdout, stderr } = await execAsync(PYTHON, [CODEX_SCRIPT, query, String(topK)], {
      timeout: 30000,
      env: {
        ...process.env,
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        ...(embeddingHostOverride ? { OLLAMA_EMBEDDING_HOST: embeddingHostOverride } : {}),
      },
    });

    if (stderr) {
      log(`Codex search stderr${embeddingHostOverride ? ` [${embeddingHostOverride}]` : ''}: ${stderr.slice(0, 400)}`, 'DEBUG');
    }

    const parsed: CodexSearchResponse = JSON.parse(stdout);
    log(`Codex search${embeddingHostOverride ? ` [${embeddingHostOverride}]` : ''}: "${query.slice(0, 60)}" → ${parsed.count} results`, 'INFO');
    return parsed;
  }

  async search(query: string, topK?: number): Promise<CodexSearchResponse> {
    if (!this.isEnabled()) return { results: [], count: 0 };

    if (this.offline) {
      if (Date.now() - this.lastOfflineCheck < 300000) { // 5 minutes backoff
        return { results: [], count: 0 };
      }
      this.offline = false;
    }

    const k = topK ?? config.CODEX_TOP_K;
    const hostCandidates = [
      undefined,
      'http://127.0.0.1:11434',
      'http://localhost:11434',
    ];

    let lastErr: unknown;
    for (const host of hostCandidates) {
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          return await this.runCodexSearch(query, k, host);
        } catch (err: any) {
          lastErr = err;
          const stderr = err?.stderr ? String(err.stderr) : '';
          const stdout = err?.stdout ? String(err.stdout) : '';
          const message = String(err?.message ?? err);

          const isConnectionError = /Connection refused|Couldn't connect|neo4j|ECONNREFUSED/i.test(
            `${message}\n${stderr}\n${stdout}`
          );

          if (isConnectionError) {
            log(`Codex search failed due to Neo4j/network connection error. Temporarily disabling Codex search for 5 minutes.`, 'WARN');
            this.offline = true;
            this.lastOfflineCheck = Date.now();
            return { results: [], count: 0 };
          }

          const transient = /timeout|timed out|ECONNRESET|ETIMEDOUT|EAI_AGAIN|503|502|429|temporarily/i.test(
            `${message}\n${stderr}\n${stdout}`,
          );
          log(
            `Codex search failed${host ? ` [${host}]` : ''} (attempt ${attempt}/2): ${message}`,
            transient ? 'WARN' : 'ERROR',
          );
          if (stderr) log(`Codex search stderr${host ? ` [${host}]` : ''}: ${stderr.slice(0, 600)}`, 'WARN');
          if (stdout) log(`Codex search stdout${host ? ` [${host}]` : ''}: ${stdout.slice(0, 600)}`, 'WARN');
          if (!transient || attempt === 2) break;
          await new Promise(resolve => setTimeout(resolve, 250 * attempt));
        }
      }
    }

    if (lastErr instanceof Error) {
      log(`Codex search giving up after retries: ${lastErr.message}`, 'WARN');
    }
    return { results: [], count: 0 };
  }

  formatForPrompt(query: string): string {
    return `[CODEX REFERENCE PATTERNS — Retrieved from Neo4j Knowledge Graph for: "${query}"]`;
  }

  async retrieveAndFormat(query: string): Promise<string> {
    if (!this.isEnabled()) return '';

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
