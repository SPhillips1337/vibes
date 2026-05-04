import { z } from 'zod';
import { ToolResult } from '../agent/types.js';
import path from 'path';

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: z.ZodObject<any>;
  execute: (args: any, context?: { workspaceRoot: string }) => Promise<ToolResult>;
}

export function resolvePath(workspaceRoot: string, targetPath: string): string {
  if (path.isAbsolute(targetPath)) return targetPath;
  return path.resolve(workspaceRoot, targetPath);
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
