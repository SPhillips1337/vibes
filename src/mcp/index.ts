import { getMCPService } from './mcp-service.js';
import { ToolDefinition } from '../tools/index.js';
import { z } from 'zod';

export function getMCPTools(): ToolDefinition[] {
  const service = getMCPService();
  const rawTools = service.getAllTools();
  
  return rawTools.map(({ server, tool }) => ({
    name: `mcp_${server}_${tool.name}`,
    description: `[MCP: ${server}] ${tool.description}`,
    parameters: z.object({}), // Placeholder, we use jsonSchema
    jsonSchema: tool.inputSchema,
    execute: async (args) => {
      return service.callTool(server, tool.name, args);
    }
  }));
}