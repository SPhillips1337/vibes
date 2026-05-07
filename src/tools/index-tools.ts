import fs from 'fs/promises';
import path from 'path';
import { z } from 'zod';
import { ToolDefinition, resolvePath } from './index.js';
import { ToolResult } from '../agent/types.js';
import { glob } from 'glob';

export const searchSymbolsTool: ToolDefinition = {
  name: 'search_symbols',
  description: 'Search for classes, functions, and variables across the entire workspace using glob patterns.',
  parameters: z.object({
    query: z.string().describe('The symbol name or part of it to search for.'),
    include: z.string().default('**/*.{ts,tsx,js,jsx,py}'),
  }),
  execute: async ({ query, include }, context): Promise<ToolResult> => {
    try {
      const workspaceRoot = context?.workspaceRoot || process.cwd();
      const files = await glob(include, { cwd: workspaceRoot, ignore: ['**/node_modules/**', '**/dist/**', '**/.git/**'] });
      
      const results: string[] = [];
      const patterns = [
        { regex: new RegExp(`(?:export\\s+)?class\\s+(${query}\\w*)`, 'i'), label: 'CLASS' },
        { regex: new RegExp(`(?:export\\s+)?(?:async\\s+)?function\\s+(${query}\\w*)`, 'i'), label: 'FUNC' },
        { regex: new RegExp(`(?:export\\s+)?const\\s+(${query}\\w*)\\s*=\\s*(?:\\([^)]*\\)|async\\s+)?\\s*=>`, 'i'), label: 'ARROW' },
        { regex: new RegExp(`^def\\s+(${query}\\w*)\\s*\\(`, 'i'), label: 'PY_FUNC' },
        { regex: new RegExp(`^class\\s+(${query}\\w*)(?:\\(.*\\))?:`, 'i'), label: 'PY_CLASS' },
      ];

      for (const file of files) {
        const fullPath = path.join(workspaceRoot, file);
        const content = await fs.readFile(fullPath, 'utf8');
        const lines = content.split('\n');

        lines.forEach((line, index) => {
          for (const p of patterns) {
            const match = line.match(p.regex);
            if (match) {
              results.push(`${file}:L${index + 1} | [${p.label}] ${match[1]}`);
              break;
            }
          }
        });

        if (results.length > 100) {
          results.push('... too many results, please refine your query.');
          break;
        }
      }

      return { success: true, data: results.length > 0 ? results.join('\n') : 'No symbols found.' };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
};
