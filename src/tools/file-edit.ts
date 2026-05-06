import fs from 'fs/promises';
import path from 'path';
import { z } from 'zod';
import { ToolDefinition, resolvePath } from './index.js';
import { ToolResult } from '../agent/types.js';
import { log } from '../logger.js';

const BACKUP_DIR = '.vibes-backups';

async function writeBackup(fullPath: string, content: string, workspaceRoot: string): Promise<void> {
  try {
    const backupRoot = path.join(workspaceRoot, BACKUP_DIR);
    await fs.mkdir(backupRoot, { recursive: true });

    const relative = path.relative(workspaceRoot, fullPath).replace(/[/\\]/g, '__');
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFile = path.join(backupRoot, `${relative}.${ts}.bak`);
    await fs.writeFile(backupFile, content, 'utf8');
    log(`Backup created: ${backupFile}`, 'DEBUG');
  } catch (err: any) {
    log(`Backup failed (non-fatal): ${err.message}`, 'WARN');
  }
}

export const editFileTool: ToolDefinition = {
  name: 'file_edit',
  description: 'Search and replace text in a file (surgical edit). Creates a backup before modifying.',
  parameters: z.object({
    path: z.string(),
    old_string: z.string(),
    new_string: z.string(),
  }),
  execute: async ({ path: filePath, old_string, new_string }, context): Promise<ToolResult> => {
    try {
      const workspaceRoot = context?.workspaceRoot || process.cwd();
      const fullPath = resolvePath(workspaceRoot, filePath);
      const content = await fs.readFile(fullPath, 'utf8');

      if (!content.includes(old_string)) {
        return { success: false, error: `Could not find exact match for 'old_string' in ${filePath}` };
      }

      // Count occurrences — warn if ambiguous
      const occurrences = content.split(old_string).length - 1;
      if (occurrences > 1) {
        log(`file_edit: found ${occurrences} matches for old_string in ${filePath}, replacing first only`, 'WARN');
      }

      // Backup before modifying
      await writeBackup(fullPath, content, workspaceRoot);

      const updatedContent = content.replace(old_string, new_string);
      await fs.writeFile(fullPath, updatedContent, 'utf8');

      return {
        success: true,
        data: `File ${filePath} updated successfully (${occurrences} match${occurrences > 1 ? 'es found' : ''}, replaced first).`,
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
};
