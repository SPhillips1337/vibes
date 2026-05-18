import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
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
  use_reviewer_model: z.boolean().optional(),
  status: TaskStatusSchema.default('todo'),
  output: z.string().optional(),
  error: z.string().optional(),
  // Set by intervention system when user replies with guidance
  userGuidance: z.string().optional(),
  // Extra steps granted on retry (added to MAX_STEPS)
  extraSteps: z.number().optional(),
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
  | { type: 'steps_updated'; taskId: string; extraSteps: number }
  | { type: 'task_started'; taskId: string; title: string }
  | { type: 'task_completed'; taskId: string; title: string }
  | { type: 'system_log'; level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG'; message: string; timestamp: string }
  | { type: 'timeout_warning'; thresholdSeconds: number; durationSeconds: number };

export type OnEvent = (event: ExecutionEvent) => void;

// ── Hook System ──────────────────────────────────────────────────────────────

/** Controls how multiple tool calls from one assistant message are executed. */
export enum ToolExecutionMode {
  SEQUENTIAL = 'sequential',
  PARALLEL = 'parallel',
}

/** Controls how many queued user messages the loop drains at each turn boundary. */
export enum QueueMode {
  ALL = 'all',
  ONE_AT_A_TIME = 'one-at-a-time',
}

/** Result of `beforeToolCall` — returning `{ block: true }` prevents execution. */
export interface BeforeToolCallResult {
  block?: boolean;
  reason?: string;
}

/** Merge-override returned from `afterToolCall`. Omitted fields keep original values. */
export interface AfterToolCallResult {
  content?: string;
  details?: Record<string, unknown>;
  isError?: boolean;
  /** Hint: every finalized tool result in batch has this → agent stops after turn */
  terminate?: boolean;
}

/** Context passed to `beforeToolCall`. */
export interface BeforeToolCallContext {
  /** The assistant message that requested this tool call. */
  assistantMessage: Record<string, unknown>;
  /** The raw tool call block. */
  toolCall: Record<string, unknown>;
  /** Validated tool arguments. */
  args: unknown;
  /** Current agent context at call time. */
  context: Record<string, unknown>;
}

/** Context passed to `afterToolCall`. */
export interface AfterToolCallContext extends BeforeToolCallContext {
  /** The executed tool result before any overrides. */
  result: ToolResult;
  /** Whether the result was treated as an error. */
  isError: boolean;
}

/** Context passed to `shouldStopAfterTurn`. */
export interface ShouldStopAfterTurnContext {
  /** The assistant message that completed this turn. */
  message: Record<string, unknown>;
  /** Tool results from this turn. */
  toolResults: ToolResult[];
  /** Full agent context after turn. */
  context: Record<string, unknown>;
  /** Messages this loop will return if it exits now. */
  newMessages: ExecutionEvent[];
}

/** Context passed to `transformContext` — receives and returns the message array. */
export interface TransformContextContext {
  /** All messages accumulated so far (raw OpenAI message params). */
  messages: ChatCompletionMessageParam[];
  /** Current usable token budget. */
  tokenBudget: number;
  /** Estimated current token usage. */
  estimatedTokens: number;
}

/** Task execution compaction details stored in session. */
export interface CompactionDetails {
  /** Files read during the compacted window. */
  readFiles: string[];
  /** Files written during the compacted window. */
  modifiedFiles: string[];
}

/** All agent-loop hooks. Every field is optional — unset hooks are no-ops. */
export interface AgentLoopHooks {
  /**
   * Called before each tool call. Return `{ block: true }` to prevent execution.
   * Throwing or rejecting propagates as a tool-error result (loop does not crash).
   */
  beforeToolCall?: (ctx: BeforeToolCallContext) => Promise<BeforeToolCallResult | void>;

  /**
   * Called after each tool call. Return overrides to replace the result,
   * or `{ terminate: true }` to signal a hard stop after this batch.
   */
  afterToolCall?: (ctx: AfterToolCallContext) => Promise<AfterToolCallResult | void>;

  /**
   * Called after every turn (assistant response + tool results processed).
   * Return `true` to request a graceful stop after this turn.
   */
  shouldStopAfterTurn?: (ctx: ShouldStopAfterTurnContext) => Promise<boolean>;

  /**
   * Given the full message array, return a pruned/transformed version.
   * Runs BEFORE messages are sent to the LLM (after truncation/compaction).
   * Use for: session-injection, custom summarisation, message filtering.
   * Must NOT throw — return `messages` unchanged on error.
   */
  transformContext?: (ctx: TransformContextContext) => Promise<ChatCompletionMessageParam[]>;

  /**
   * Inject mid-run messages (steering). Called after each turn completes,
   * before the next LLM call. Return `[]` when nothing to inject.
   */
  getSteeringMessages?: () => Promise<ExecutionEvent[]>;

  /**
   * Follow-up messages after the agent would otherwise stop.
   * Return `[]` to let the agent end normally.
   */
  getFollowUpMessages?: () => Promise<ExecutionEvent[]>;
}

/** Aggregated hook configuration for TaskExecutor. */
export interface ExecutorHooksConfig {
  hooks: AgentLoopHooks;
  /** YOLO / no-limit mode — passed through so hooks can change their thresholds. */
  getYoloMode: () => boolean;
}
