/**
 * Trace recorder — persists execution events to a JSONL trace file.
 * This is a secondary persistence layer alongside the in-memory onEvent callback.
 */

import fs from 'fs/promises';
import path from 'path';
import type { ExecutionEvent } from './types.js';

export interface TraceRecorder {
  event(evt: ExecutionEvent): Promise<void>;
}

/**
 * Creates a trace recorder that appends events as JSONL to
 * `.vibes/traces/<taskId>.jsonl`.
 */
export function createTraceRecorder(taskId: string, _sessionType: string): TraceRecorder {
  const traceDir = path.join(process.cwd(), '.vibes', 'traces');
  const traceFile = path.join(traceDir, `${taskId}.jsonl`);

  let dirEnsured = false;

  const ensureDir = async () => {
    if (dirEnsured) return;
    await fs.mkdir(traceDir, { recursive: true });
    dirEnsured = true;
  };

  return {
    async event(evt: ExecutionEvent): Promise<void> {
      try {
        await ensureDir();
        const line = JSON.stringify({ timestamp: new Date().toISOString(), ...evt }) + '\n';
        await fs.appendFile(traceFile, line, 'utf8');
      } catch {
        // Silently ignore trace write failures (non-critical)
      }
    },
  };
}
