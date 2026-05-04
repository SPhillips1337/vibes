import fs from 'fs/promises';
import path from 'path';
import { z } from 'zod';
import { ToolDefinition, resolvePath } from './index.js';
import { ToolResult } from '../agent/types.js';
import { glob } from 'glob';

export const listDirTool: ToolDefinition = {
  name: 'list_dir',
  description: 'List files and directories in a path',
  parameters: z.object({
    path: z.string(),
  }),
  execute: async ({ path: dirPath }, context): Promise<ToolResult> => {
    try {
      const fullPath = resolvePath(context?.workspaceRoot || process.cwd(), dirPath);
      const entries = await fs.readdir(fullPath, { withFileTypes: true });
      const data = entries.map(e => ({
        name: e.name,
        type: e.isDirectory() ? 'directory' : 'file',
      }));
      return { success: true, data };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
};

export const readFileTool: ToolDefinition = {
  name: 'file_read',
  description: 'Read the contents of a file',
  parameters: z.object({
    path: z.string(),
    encoding: z.string().default('utf8'),
  }),
  execute: async ({ path: filePath, encoding }, context): Promise<ToolResult> => {
    try {
      const fullPath = resolvePath(context?.workspaceRoot || process.cwd(), filePath);
      const content = await fs.readFile(fullPath, encoding as BufferEncoding);
      return { success: true, data: content };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
};

export const writeFileTool: ToolDefinition = {
  name: 'file_write',
  description: 'Write or overwrite a file with content',
  parameters: z.object({
    path: z.string(),
    content: z.string(),
  }),
  execute: async ({ path: filePath, content }, context): Promise<ToolResult> => {
    try {
      const fullPath = resolvePath(context?.workspaceRoot || process.cwd(), filePath);
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, content, 'utf8');
      return { success: true, data: `File written to ${fullPath}` };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
};

export const globTool: ToolDefinition = {
  name: 'glob',
  description: 'Find files matching a glob pattern',
  parameters: z.object({
    pattern: z.string(),
  }),
  execute: async ({ pattern }, context): Promise<ToolResult> => {
    try {
      const workspaceRoot = context?.workspaceRoot || process.cwd();
      const files = await glob(pattern, { cwd: workspaceRoot });
      return { success: true, data: files };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
};
