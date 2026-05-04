import { exec } from 'child_process';
import { promisify } from 'util';
import { z } from 'zod';
import { ToolDefinition } from './index.js';
import { ToolResult } from '../agent/types.js';

const execAsync = promisify(exec);

export const shellTool: ToolDefinition = {
  name: 'shell',
  description: 'Execute a shell command',
  parameters: z.object({
    command: z.string(),
    timeout: z.number().default(30000),
  }),
  execute: async ({ command, timeout }, context): Promise<ToolResult> => {
    try {
      const workspaceRoot = context?.workspaceRoot || process.cwd();
      const { stdout, stderr } = await execAsync(command, { 
        timeout,
        cwd: workspaceRoot 
      });
      return {
        success: true,
        data: {
          stdout,
          stderr,
        },
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        data: {
          stdout: error.stdout,
          stderr: error.stderr,
        },
      };
    }
  },
};
