import { config } from '../config.js';
import { log } from '../logger.js';
import { getOllamaClient, getModel } from '../ollama-client.js';
import { extractJsonContent } from './json-repair.js';
import type {
  AgentLoopHooks,
  AfterToolCallContext,
  ShouldStopAfterTurnContext,
  TransformContextContext,
  TriageAction,
} from './types.js';

const TRIAGE_SYSTEM_PROMPT = `You are a triage observer for an AI coding agent. Analyse the recent tool results and decide if the agent needs help.

Rules:
- Be concise. The agent is mid-task, not waiting for a lecture.
- Only flag something if you see a clear, repeated pattern.
- A single failure is normal. 3+ identical failures in a row is a pattern.
- Context pressure alone is not an emergency — the main agent handles this. Only flag if pressure is high AND failures are happening.
- Never suggest code changes. You are a monitor, not a coder.
- Never answer the user's original question. That's the main agent's job.`;

const TRIAGE_FUNCTION_SCHEMA = {
  name: 'triage',
  description: 'Triage assessment of agent health',
  parameters: {
    type: 'object',
    properties: {
      assessment: {
        type: 'string',
        enum: ['normal', 'concerning', 'bad'],
        description: 'Overall assessment of agent state',
      },
      action: {
        type: 'string',
        enum: ['continue', 'compress', 'steer', 'escalate'],
        description: 'Recommended action',
      },
      reason: {
        type: 'string',
        description: 'One-sentence rationale for the action',
      },
      steering_message: {
        type: 'string',
        description: "Only if action is 'steer': brief instruction to inject as a user message",
      },
    },
    required: ['assessment', 'action', 'reason'],
  },
};

const THRASH_TOOL_FAIL_THRESHOLD = 3;
const LOOP_SAME_TOOL_THRESHOLD = 4;
const CYCLE_READ_WRITE_THRESHOLD = 3;
const CONTEXT_HIGH_PRESSURE = 0.9;
const CONTEXT_READINGS_BEFORE_FLAG = 3;
const TURN_EXHAUSTION_RATIO = 0.8;
const LOG_ERROR_THRESHOLD = 3;

const GUIDANCE_TOOL_FAIL = `You have called the same tool multiple times and it keeps failing. Try a different approach or tool instead of retrying the same thing.`;
const GUIDANCE_TOOL_LOOP = `You are repeating the same tool call without making progress. Step back and try a different strategy.`;
const GUIDANCE_CONTEXT_PRESSURE = `Context window is getting full. Consider completing the current subtask and providing a summary rather than starting new work.`;
const GUIDANCE_TURN_EXHAUSTION = `You are approaching the step limit. Wrap up the current task with whatever you have.`;
const GUIDANCE_CYCLE_REPEAT = `You have created several components in a row. If the task criteria are met, provide a summary and stop rather than looking for more things to build.`;

interface TriageSnapshot {
  toolFailures: Map<string, number>;
  contextReadings: { used: number; total: number }[];
  turnCount: number;
  maxSteps: number;
  errorLogCount: number;
}

export class TriageAgent {
  /** Set by the scheduler before each task execution. Hooks read this to tag snapshots. */
  currentTaskId = '';

  /** Pending steering message for live mid-task injection. Cleared after read. */
  pendingSteerMessage = '';

  /** Last N tool calls (name only) for loop detection. */
  private recentToolCalls: string[] = [];

  /** Last N tool call details with args for cycle detection. */
  private recentToolCallDetails: { name: string; args?: Record<string, any> }[] = [];

  private snapshots = new Map<string, TriageSnapshot>();
  private completedTaskCount = 0;
  private autoSteer: boolean;

  constructor(autoSteer: boolean) {
    this.autoSteer = autoSteer;
  }

  reset(taskId: string) {
    this.snapshots.set(taskId, {
      toolFailures: new Map(),
      contextReadings: [],
      turnCount: 0,
      maxSteps: config.MAX_STEPS,
      errorLogCount: 0,
    });
    this.recentToolCalls = [];
    this.recentToolCallDetails = [];
    this.pendingSteerMessage = '';
  }

  recordToolCall(toolName: string, args?: Record<string, any>) {
    this.recentToolCalls.push(toolName);
    if (this.recentToolCalls.length > 12) this.recentToolCalls.shift();
    this.recentToolCallDetails.push({ name: toolName, args });
    if (this.recentToolCallDetails.length > 30) this.recentToolCallDetails.shift();
  }

  recordToolFailure(taskId: string, toolName: string) {
    const snap = this.snapshots.get(taskId);
    if (!snap) return;
    const current = snap.toolFailures.get(toolName) ?? 0;
    snap.toolFailures.set(toolName, current + 1);
  }

  recordContextReading(taskId: string, used: number, total: number) {
    const snap = this.snapshots.get(taskId);
    if (!snap) return;
    snap.contextReadings.push({ used, total });
    if (snap.contextReadings.length > 5) snap.contextReadings.shift();
  }

  recordTurn(taskId: string) {
    const snap = this.snapshots.get(taskId);
    if (!snap) return;
    snap.turnCount++;
  }

  recordLogError(taskId: string) {
    const snap = this.snapshots.get(taskId);
    if (!snap) return;
    snap.errorLogCount++;
  }

  /** Tier 1 live check — runs after each tool turn, no LLM call.
   *  Sets `pendingSteerMessage` if a pattern is detected. */
  checkLive(taskId: string): void {
    if (!this.autoSteer) return;
    const snap = this.snapshots.get(taskId);
    if (!snap) return;

    // Already have a pending message — don't overwrite until consumed
    if (this.pendingSteerMessage) return;

    // 1. Consecutive tool failures
    for (const [tool, count] of snap.toolFailures) {
      if (count >= THRASH_TOOL_FAIL_THRESHOLD) {
        this.pendingSteerMessage = `${GUIDANCE_TOOL_FAIL} (${tool} failed ${count}x)`;
        log(`Triage live: tool failure thrash (${tool} ${count}x)`, 'WARN');
        return;
      }
    }

    // 2. Same tool called repeatedly (loop detection)
    if (this.recentToolCalls.length >= LOOP_SAME_TOOL_THRESHOLD) {
      const last = this.recentToolCalls.slice(-LOOP_SAME_TOOL_THRESHOLD);
      if (last.every(t => t === last[0])) {
        this.pendingSteerMessage = `${GUIDANCE_TOOL_LOOP} (${last[0]} called ${LOOP_SAME_TOOL_THRESHOLD}x in a row)`;
        log(`Triage live: tool loop (${last[0]} repeated)`, 'WARN');
        return;
      }
    }

    // 3. Context pressure spike
    if (snap.contextReadings.length >= 2) {
      const last = snap.contextReadings[snap.contextReadings.length - 1];
      if (last.used / last.total > CONTEXT_HIGH_PRESSURE) {
        this.pendingSteerMessage = GUIDANCE_CONTEXT_PRESSURE;
        log(`Triage live: context pressure ${(last.used / last.total * 100).toFixed(0)}%`, 'WARN');
        return;
      }
    }

    // 4. Turn exhaustion
    const turnRatio = snap.turnCount / Math.max(snap.maxSteps, 1);
    if (turnRatio >= TURN_EXHAUSTION_RATIO) {
      this.pendingSteerMessage = GUIDANCE_TURN_EXHAUSTION;
      log(`Triage live: turn exhaustion ${(turnRatio * 100).toFixed(0)}%`, 'WARN');
      return;
    }

    // 5. Re-read+create cycle detection: research tool(s) → action tool repeated N times
    //    without the model concluding (text-only summary).  E.g. file_read → file_write
    //    cycle 3+ times = tail-chasing.
    const readTools = new Set(['file_read', 'glob', 'grep', 'list_dir', 'list_files', 'search', 'read']);
    const writeTools = new Set(['file_write', 'file_edit', 'write']);
    let cycles = 0;
    let sawResearch = false;
    for (const entry of this.recentToolCallDetails) {
      if (readTools.has(entry.name)) {
        sawResearch = true;
      } else if (writeTools.has(entry.name) && sawResearch) {
        cycles++;
        sawResearch = false;
      }
    }
    if (cycles >= CYCLE_READ_WRITE_THRESHOLD) {
      this.pendingSteerMessage = GUIDANCE_CYCLE_REPEAT;
      log(`Triage live: re-read+create cycle detected (${cycles} cycles)`, 'WARN');
      return;
    }
  }

  async analyzeBetweenTasks(): Promise<TriageAction> {
    this.completedTaskCount++;
    if (this.completedTaskCount % config.TRIAGE_INTERVAL !== 0) return { type: 'continue' };
    const action = await this.evaluateSnapshots();
    this.snapshots.clear();
    return action;
  }

  /** Time-based analysis — doesn't increment task counter or clear snapshots. */
  async analyzeTimeBased(): Promise<TriageAction> {
    if (this.snapshots.size === 0) return { type: 'continue' };
    return this.evaluateSnapshots();
  }

  private async evaluateSnapshots(): Promise<TriageAction> {
    let totalToolFailures = 0;
    let maxConsecutiveFailures = 0;
    let worstTool = '';
    let avgPressure = 0;
    let pressureReadings = 0;
    let maxTurnRatio = 0;
    let totalLogErrors = 0;

    for (const snap of this.snapshots.values()) {
      for (const [tool, count] of snap.toolFailures) {
        totalToolFailures += count;
        if (count > maxConsecutiveFailures) {
          maxConsecutiveFailures = count;
          worstTool = tool;
        }
      }
      for (const r of snap.contextReadings) {
        avgPressure += r.used / r.total;
        pressureReadings++;
      }
      maxTurnRatio = Math.max(maxTurnRatio, snap.turnCount / Math.max(snap.maxSteps, 1));
      totalLogErrors += snap.errorLogCount;
    }
    if (pressureReadings > 0) avgPressure /= pressureReadings;

    const hasHighPressure = avgPressure >= CONTEXT_HIGH_PRESSURE && pressureReadings >= CONTEXT_READINGS_BEFORE_FLAG;
    const hasToolThrash = maxConsecutiveFailures >= THRASH_TOOL_FAIL_THRESHOLD;
    const hasTurnExhaustion = maxTurnRatio >= TURN_EXHAUSTION_RATIO;
    const hasLogErrors = totalLogErrors >= LOG_ERROR_THRESHOLD;

    if (!hasToolThrash && !hasTurnExhaustion && !hasLogErrors) {
      if (hasHighPressure) {
        log('Triage: high context pressure detected, forcing compaction', 'INFO');
        return { type: 'compress', reason: `Context at ${(avgPressure * 100).toFixed(0)}%` };
      }
      return { type: 'continue' };
    }

    const contextLines: string[] = [];
    contextLines.push(`Worst tool failure: ${worstTool} failed ${maxConsecutiveFailures}x consecutively`);
    contextLines.push(`Context pressure: ${(avgPressure * 100).toFixed(0)}% (${pressureReadings} readings)`);
    contextLines.push(`Turn exhaustion: ${(maxTurnRatio * 100).toFixed(0)}% of max steps`);
    contextLines.push(`Log errors: ${totalLogErrors}`);

    log('Triage: pattern detected, calling observer model', 'INFO');
    const action = await this.callTriageModel(contextLines.join('\n'));

    if (action.type === 'steer' && !this.autoSteer) {
      log(`Triage suggests steering but auto-steer is disabled: "${action.message}"`, 'INFO');
      return { type: 'continue' };
    }

    return action;
  }

  private async callTriageModel(context: string): Promise<TriageAction> {
    const model = config.TRIAGE_MODEL || getModel();
    const client = getOllamaClient('triage');
    const systemMsg = { role: 'system' as const, content: TRIAGE_SYSTEM_PROMPT };
    const userMsg = { role: 'user' as const, content: context };

    // Attempt 1: function calling (structured output)
    try {
      const response = await client.chat.completions.create({
        model,
        messages: [systemMsg, userMsg],
        tools: [{ type: 'function', function: TRIAGE_FUNCTION_SCHEMA }],
        tool_choice: { type: 'function', function: { name: 'triage' } },
        max_tokens: 1024,
        temperature: 0,
      });
      const call = response.choices[0]?.message?.tool_calls?.[0];
      if (call?.function?.arguments) {
        const parsed = JSON.parse(call.function.arguments);
        return mapRawToAction(parsed);
      }
    } catch {
      // Fall through to fallback
    }

    // Attempt 2: JSON-in-prompt (portable, works with any provider)
    try {
      const prompt = `${TRIAGE_SYSTEM_PROMPT}\n\n${context}\n\nRespond with ONLY a JSON object matching this schema:\n${JSON.stringify(TRIAGE_FUNCTION_SCHEMA, null, 2)}`;
      const response = await client.chat.completions.create({
        model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 1024,
        temperature: 0,
      });
      const msg = response.choices[0]?.message as any;
      const text = msg?.content || msg?.reasoning_content || '';
      const extracted = extractJsonContent(text);
      if (extracted) {
        const parsed = JSON.parse(extracted);
        return mapRawToAction(parsed);
      }
    } catch {
      // Safe fallback
    }

    return { type: 'continue' };
  }
}

function mapRawToAction(raw: any): TriageAction {
  const action = String(raw.action || 'continue');
  switch (action) {
    case 'compress':
      return { type: 'compress', reason: String(raw.reason || 'Triage recommendation') };
    case 'steer':
      return { type: 'steer', message: String(raw.steering_message || raw.reason || 'Adjust approach') };
    case 'escalate':
      return { type: 'escalate', reason: String(raw.reason || 'Triage escalation') };
    default:
      return { type: 'continue' };
  }
}

export function withTriageHooks(
  baseHooks: AgentLoopHooks,
  triage: TriageAgent,
): AgentLoopHooks {
  return {
    ...baseHooks,

    reset() {
      baseHooks.reset?.();
      if (triage.currentTaskId) triage.reset(triage.currentTaskId);
    },

    async afterToolCall(ctx: AfterToolCallContext) {
      const baseResult = await baseHooks.afterToolCall?.(ctx);
      const toolName = (ctx.toolCall as any)?.function?.name || 'unknown';
      triage.recordToolCall(toolName, (ctx.toolCall as any)?.function?.arguments);
      if (triage.currentTaskId && !ctx.result?.success) {
        triage.recordToolFailure(triage.currentTaskId, toolName);
      }
      return baseResult;
    },

    async shouldStopAfterTurn(ctx: ShouldStopAfterTurnContext) {
      const baseResult = await baseHooks.shouldStopAfterTurn?.(ctx);
      if (baseResult) return true;
      if (triage.currentTaskId) {
        triage.recordTurn(triage.currentTaskId);
        triage.checkLive(triage.currentTaskId);
      }
      return false;
    },

    async getSteeringMessage() {
      const msg = triage.pendingSteerMessage;
      if (msg) {
        triage.pendingSteerMessage = '';
        return msg;
      }
      return null;
    },

    async transformContext(ctx: TransformContextContext) {
      if (triage.currentTaskId) {
        const total = config.CONTEXT_WINDOW;
        const used = ctx.estimatedTokens;
        triage.recordContextReading(triage.currentTaskId, used, total);
      }
      return baseHooks.transformContext?.(ctx) ?? ctx.messages;
    },
  };
}
