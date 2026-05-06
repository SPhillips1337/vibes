import { z } from 'zod';
import { ToolResult } from '../agent/types.js';
import path from 'path';
import { log } from '../logger.js';

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: z.ZodObject<any>;
  execute: (args: any, context?: { workspaceRoot: string }) => Promise<ToolResult>;
}

export function resolvePath(workspaceRoot: string, targetPath: string): string {
  const jail = path.resolve(workspaceRoot);
  const resolved = path.isAbsolute(targetPath)
    ? path.resolve(targetPath)
    : path.resolve(workspaceRoot, targetPath);

  if (!resolved.startsWith(jail + path.sep) && resolved !== jail) {
    log(`Path escape blocked: "${targetPath}" resolved to "${resolved}" (outside "${jail}")`, 'WARN');
    throw new Error(`Access denied: path "${targetPath}" is outside the workspace root.`);
  }

  return resolved;
}

export function toOpenAITool(tool: ToolDefinition) {
  const { name, description, parameters } = tool;
  
  const jsonSchema: any = {
    type: 'object',
    properties: {},
    required: [],
  };

  const shape = parameters.shape;
  for (const key in shape) {
    const field = shape[key];
    jsonSchema.properties[key] = {
      type: field instanceof z.ZodString ? 'string' : 
            field instanceof z.ZodNumber ? 'number' :
            field instanceof z.ZodBoolean ? 'boolean' :
            field instanceof z.ZodArray ? 'array' : 'object',
      description: (field as any)._def?.description || '',
    };
    if (!field.isOptional()) {
      jsonSchema.required.push(key);
    }
  }

  return {
    type: 'function' as const,
    function: {
      name,
      description,
      parameters: jsonSchema,
    },
  };
}
