import { exec } from 'child_process';
import { promisify } from 'util';
import { z } from 'zod';
import { ToolDefinition } from './index.js';
import { ToolResult } from '../agent/types.js';
import { log } from '../logger.js';

const execAsync = promisify(exec);

// Maximum characters of stdout/stderr to return — prevents context flooding
const MAX_OUTPUT_CHARS = 8000;

// Commands that are never permitted, regardless of workspace
const BLOCKED_PATTERNS: RegExp[] = [
  // Key & credential generation
  /\bopenssl\b/i,
  /\bssh-keygen\b/i,
  /\bgpg\b.*--gen-key/i,
  // Network exfiltration / external calls
  /\bcurl\s/i,
  /\bwget\s/i,
  /\bscp\s/i,
  /\brsync\s/i,
  /\bsftp\s/i,
  /\btelnet\s/i,
  /\bnc\s/i,        // netcat
  // Destructive filesystem ops
  /\brm\s+.*-[a-z]*r[a-z]*f/i,   // rm -rf variants
  /\bshred\b/i,
  /\bdd\s.*of=/i,
  // Privilege escalation
  /\bsudo\b/i,
  /\bsu\s/i,
  /\bchown\b/i,
  /\bchmod\s+[0-7]*[67]\s/i,     // world/group-writable
  // Global package installs
  /\bnpm\s+i(nstall)?\s+-g\b/i,
  /\bnpm\s+i(nstall)?\s+--global\b/i,
  /\byarn\s+global\s+add\b/i,
  /\bpip\s+install\s+--system\b/i,
  /\bpip3?\s+install\s+--system\b/i,
  // Git operations that touch remote
  /\bgit\s+push\b/i,
  /\bgit\s+remote\s+add\b/i,
  /\bgit\s+clone\b/i,
  // Docker / container management
  /\bdocker\s+(run|push|pull|exec|build)\b/i,
  /\bkubectl\b/i,
];

function checkCommand(command: string): string | null {
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(command)) {
      return `Command blocked by security policy (matched: ${pattern.source})`;
    }
  }
  return null;
}

function truncateOutput(text: string, label: string): string {
  if (!text || text.length <= MAX_OUTPUT_CHARS) return text;
  const truncated = text.slice(0, MAX_OUTPUT_CHARS);
  const omitted = text.length - MAX_OUTPUT_CHARS;
  log(`Shell ${label} truncated: ${text.length} → ${MAX_OUTPUT_CHARS} chars (${omitted} omitted)`, 'WARN');
  return `${truncated}\n[... ${omitted} chars truncated]`;
}

export const shellTool: ToolDefinition = {
  name: 'shell',
  description: 'Execute a shell command within the workspace directory. Network calls, key generation, sudo, global installs, and destructive operations are not permitted.',
  parameters: z.object({
    command: z.string(),
    timeout: z.number().default(30000),
  }),
  execute: async ({ command, timeout }, context): Promise<ToolResult> => {
    // Security check before execution
    const blockReason = checkCommand(command);
    if (blockReason) {
      log(`Shell command blocked: ${command} — ${blockReason}`, 'WARN');
      return { success: false, error: `Blocked: ${blockReason}` };
    }

    try {
      const workspaceRoot = context?.workspaceRoot || process.cwd();
      const { stdout: rawOut, stderr: rawErr } = await execAsync(command, { 
        timeout,
        killSignal: 'SIGKILL',
        cwd: workspaceRoot,
      });

      const stdout = truncateOutput(rawOut, 'stdout');
      const stderr = truncateOutput(rawErr, 'stderr');

      return { success: true, data: { stdout, stderr } };
    } catch (error: any) {
      const stdout = truncateOutput(error.stdout ?? '', 'stdout');
      const stderr = truncateOutput(error.stderr ?? '', 'stderr');
      
      // Combine error message with output for better agent visibility
      let detailedError = error.message;
      if (stderr) detailedError += `\n\n[STDERR]:\n${stderr}`;
      if (stdout) detailedError += `\n\n[STDOUT]:\n${stdout}`;

      return {
        success: false,
        error: detailedError,
        data: { stdout, stderr },
      };
    }
  },
};
