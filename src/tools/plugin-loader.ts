import fs from 'fs';
import path from 'path';
import { ToolDefinition } from '../tools/index.js';
import { log } from '../logger.js';
import { pathToFileURL } from 'url';

export async function loadPluginTools(workspaceRoot: string): Promise<ToolDefinition[]> {
  const pluginsDir = path.join(workspaceRoot, '.vibes', 'tools');
  if (!fs.existsSync(pluginsDir)) return [];

  const tools: ToolDefinition[] = [];
  try {
    const files = fs.readdirSync(pluginsDir).filter(f => f.endsWith('.js') || f.endsWith('.ts'));
    
    for (const file of files) {
      const fullPath = path.join(pluginsDir, file);
      try {
        // Use pathToFileURL for Windows compatibility and ESM dynamic import
        const module = await import(pathToFileURL(fullPath).href);
        if (module.default && module.default.name && module.default.execute) {
          tools.push(module.default);
          log(`Loaded plugin tool: ${module.default.name} from ${file}`, 'INFO');
        } else if (module.tool && module.tool.name && module.tool.execute) {
          tools.push(module.tool);
          log(`Loaded plugin tool: ${module.tool.name} from ${file}`, 'INFO');
        }
      } catch (err: any) {
        log(`Failed to load plugin tool ${file}: ${err.message}`, 'ERROR');
      }
    }
  } catch (err: any) {
    log(`Error reading plugins directory: ${err.message}`, 'ERROR');
  }

  return tools;
}
