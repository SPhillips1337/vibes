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
      const content = await fs.readFile(fullPath, (encoding as BufferEncoding) || 'utf8');
      return { success: true, data: content };
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return { success: false, error: `File not found: ${filePath}. Hint: Use list_dir or glob to verify the file exists and check its exact name/path.` };
      }
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

export const fileOutlineTool: ToolDefinition = {
  name: 'file_outline',
  description: 'Get a map of classes, functions, and definitions in a file with line numbers.',
  parameters: z.object({
    path: z.string(),
  }),
  execute: async ({ path: filePath }, context): Promise<ToolResult> => {
    try {
      const fullPath = resolvePath(context?.workspaceRoot || process.cwd(), filePath);
      const content = await fs.readFile(fullPath, 'utf8');
      const lines = content.split('\n');
      const outline: string[] = [];

      // Basic regex for JS/TS/Python definitions
      const patterns = [
        { regex: /^(?:export\s+)?class\s+(\w+)/, label: 'CLASS' },
        { regex: /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/, label: 'FUNC' },
        { regex: /^(?:export\s+)?const\s+(\w+)\s*=\s*(?:\([^)]*\)|async\s+)?\s*=>/, label: 'ARROW' },
        { regex: /^\s*(?:private|public|protected)?\s*(?:async\s+)?(\w+)\s*\([^)]*\)\s*(?::|{)/, label: 'METHOD' },
        { regex: /^def\s+(\w+)\s*\(/, label: 'PY_FUNC' },
        { regex: /^class\s+(\w+)(?:\(.*\))?:/, label: 'PY_CLASS' },
      ];

      lines.forEach((line, index) => {
        for (const p of patterns) {
          const match = line.match(p.regex);
          if (match) {
            outline.push(`L${index + 1}: [${p.label}] ${match[1]} | ${line.trim().slice(0, 50)}`);
            break;
          }
        }
      });

      return { success: true, data: outline.length > 0 ? outline.join('\n') : 'No definitions found.' };
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return { success: false, error: `File not found: ${filePath}. Hint: Use list_dir or glob to verify the path.` };
      }
      return { success: false, error: error.message };
    }
  },
};

export const readLinesTool: ToolDefinition = {
  name: 'read_lines',
  description: 'Read a specific range of lines from a file.',
  parameters: z.object({
    path: z.string(),
    start: z.number().describe('Start line number (1-indexed)'),
    end: z.number().describe('End line number (1-indexed, inclusive)'),
  }),
  execute: async ({ path: filePath, start, end }, context): Promise<ToolResult> => {
    try {
      const fullPath = resolvePath(context?.workspaceRoot || process.cwd(), filePath);
      const content = await fs.readFile(fullPath, 'utf8');
      const lines = content.split('\n');
      
      const startIdx = Math.max(0, start - 1);
      const endIdx = Math.min(lines.length, end);
      
      const requestedLines = lines.slice(startIdx, endIdx);
      return { 
        success: true, 
        data: requestedLines.join('\n'),
        metadata: {
          total_lines: lines.length,
          start_line: startIdx + 1,
          end_line: endIdx,
        }
      };
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return { success: false, error: `File not found: ${filePath}. Hint: Use list_dir or glob to verify the path.` };
      }
      return { success: false, error: error.message };
    }
  },
};
