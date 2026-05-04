import fs from 'fs/promises';
import { z } from 'zod';
import { ToolDefinition, resolvePath } from './index.js';
import { ToolResult } from '../agent/types.js';

export const editFileTool: ToolDefinition = {
  name: 'file_edit',
  description: 'Search and replace text in a file (surgical edit)',
  parameters: z.object({
    path: z.string(),
    old_string: z.string(),
    new_string: z.string(),
  }),
  execute: async ({ path: filePath, old_string, new_string }, context): Promise<ToolResult> => {
    try {
      const fullPath = resolvePath(context?.workspaceRoot || process.cwd(), filePath);
      const content = await fs.readFile(fullPath, 'utf8');
      
      if (!content.includes(old_string)) {
        return { success: false, error: `Could not find exact match for 'old_string' in ${filePath}` };
      }

      const updatedContent = content.replace(old_string, new_string);
      await fs.writeFile(fullPath, updatedContent, 'utf8');
      
      return { success: true, data: `File ${filePath} updated successfully.` };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
};
