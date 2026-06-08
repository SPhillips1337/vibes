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
  /\bnmap\b/i,
  // Destructive filesystem ops
  /\brm\s+.*-[a-z]*r[a-z]*f/i,   // rm -rf variants
  /\bshred\b/i,
  /\bdd\s.*of=/i,
  /\bmkfs\b/i,
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
  // Sensitive paths
  // Match sensitive system directories as path roots, but NOT /dev/null which is a
  // safe standard redirect target. We match /dev only when NOT followed by /null.
  /\/(etc|var|boot|root|proc|sys)\b/i,
  /\/dev\/(?!null\b)/i,
  /\/\.ssh\b/i,
  /\/\.env\b/i, // Prevent reading root .env if possible (though agent often needs project .env)
];

// Safe I/O redirect targets that must never trigger the /dev block.
// Agents routinely emit `2>/dev/null` or `>/dev/null` to suppress output.
const SAFE_REDIRECT_RE = /(?:^|\s)[0-9]*(?:>>?|&>)\s*\/dev\/null\b/g;

function checkCommand(command: string): string | null {
  // Path traversal check
  if (command.includes('..') || /%2e/i.test(command)) {
    return 'Path traversal detected (.. or encoded variants not allowed in shell commands)';
  }

  // Strip safe redirects (>/dev/null, 2>/dev/null, &>/dev/null) before pattern
  // matching so they never falsely trigger the sensitive-path block.
  const sanitized = command.replace(SAFE_REDIRECT_RE, '');

  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(sanitized)) {
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
    // Small models (qwen3.5-2b etc.) sometimes emit timeout as {} or {total:N} instead of a number.
    // Accept any shape and coerce to a millisecond number.
    timeout: z.union([
      z.number(),
      z.object({
        total: z.number().optional(),
        ms: z.number().optional(),
        value: z.number().optional(),
      }).transform(val => val.total ?? val.ms ?? val.value ?? 30000),
      z.null().transform(() => 30000),
      z.undefined().transform(() => 30000),
    ]).default(30000).catch(30000),
    // Small models sometimes emit failOnError as {"condition":false} instead of a boolean.
    // Accept any shape and coerce to a boolean.
    failOnError: z.union([
      z.boolean(),
      z.object({
        condition: z.boolean().optional(),
        value: z.boolean().optional(),
        enabled: z.boolean().optional(),
      }).transform(val => val.condition ?? val.value ?? val.enabled ?? false),
      z.null().transform(() => false),
      z.undefined().transform(() => false),
    ]).default(false).catch(false).describe("If true, non-zero exit codes fail the tool call. Set to false if you expect non-zero exit codes (e.g. grep finding no matches)."),
  }),
  execute: async ({ command, timeout, failOnError }, context): Promise<ToolResult> => {
    // Timeout from Zod schema is already in milliseconds (default 30000).
    // No seconds-guessing heuristic: small models may pass low ms values, and
    // the schema's .catch(30000) provides a safe floor.
    const msTimeout = timeout;

    // Security check before execution
    const blockReason = checkCommand(command);
    if (blockReason) {
      log(`Shell command blocked: ${command} — ${blockReason}`, 'WARN');
      return { success: false, error: `Blocked: ${blockReason}` };
    }

    try {
      const workspaceRoot = context?.workspaceRoot || process.cwd();
      const { stdout: rawOut, stderr: rawErr } = await execAsync(command, { 
        timeout: msTimeout,
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

      // If failOnError is explicitly bypassed, we return the result as a success to the agent
      if (!failOnError) {
        return {
          success: true,
          data: { 
            stdout, 
            stderr, 
            exitCode: error.code || 1,
            message: error.message 
          }
        };
      }

      return {
        success: false,
        error: detailedError,
        data: { stdout, stderr, exitCode: error.code },
      };
    }
  },
};
