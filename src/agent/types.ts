import { z } from 'zod';

export const TaskStatusSchema = z.enum(['todo', 'in_progress', 'done', 'failed']);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const TaskSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  files: z.array(z.string()).default([]),
  acceptance_criteria: z.array(z.string()).default([]),
  depends_on: z.array(z.string()).default([]),
  status: TaskStatusSchema.default('todo'),
  output: z.string().optional(),
  error: z.string().optional(),
  // Set by intervention system when user replies with guidance
  userGuidance: z.string().optional(),
  // Extra steps granted on retry (added to MAX_STEPS)
  extraSteps: z.number().optional(),
  // Model override for this task (e.g. for high-difficulty tasks)
  model: z.string().optional(),
});

export type Task = z.infer<typeof TaskSchema>;

export const MilestoneSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  tasks: z.array(TaskSchema),
});

export type Milestone = z.infer<typeof MilestoneSchema>;

export const MissionSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  workspace_root: z.string().default(process.cwd()),
  milestones: z.array(MilestoneSchema),
  status: z.enum(['planning', 'executing', 'completed', 'failed', 'awaiting_intervention']).default('planning'),
});

export type Mission = z.infer<typeof MissionSchema>;

export interface ToolResult {
  success: boolean;
  error?: string;
  data?: any;
  metadata?: any;
}

export type ExecutionEvent = 
  | { type: 'thinking'; content: string }
  | { type: 'tool_call'; tool: string; args: any }
  | { type: 'tool_result'; tool: string; result: ToolResult }
  | { type: 'output'; content: string }
  | { type: 'error'; message: string }
  | { type: 'context_update'; used: number; total: number; percentage: number }
  | { type: 'intervention_required'; taskId: string; error: string; question: string }
  | { type: 'steps_updated'; taskId: string; extraSteps: number };

export type OnEvent = (event: ExecutionEvent) => void;
