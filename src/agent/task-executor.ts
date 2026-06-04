import { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { getOllamaClient, getModel } from '../ollama-client.js';
import { Task, ToolResult, OnEvent, AgentLoopHooks, BeforeToolCallResult, AfterToolCallResult, ShouldStopAfterTurnContext, TransformContextContext, ExecutionEvent, ToolExecutionMode } from './types.js';
import { ToolDefinition, toOpenAITool } from '../tools/index.js';
import { config } from '../config.js';
import { log, logObject } from '../logger.js';
import { getMemoryService } from '../memory/index.js';
import { getSkillsService } from '../skills/index.js';
import { getCodexService } from '../mcp/codex-service.js';
import { detectTechStack } from './tech-stack.js';
import {
  truncateToolResult,
  compressMessages,
  getContextStats,
  estimateMessagesTokens,
} from './context-manager.js';
import { compact } from './compaction/compaction.js';

/** Type guard — narrows `BeforeToolCallResult | void | undefined` to `BeforeToolCallResult`. */
function isBlockResult(v: BeforeToolCallResult | void | undefined): v is BeforeToolCallResult {
  return !!v && typeof v === 'object' && 'block' in v;
}

/**
 * Build default AgentLoopHooks from config.
 * These are the Pi-inspired defaults: thrash detection, reasoning strip,
 * context compaction, and tool-result validation.
 */
export function createDefaultHooks(getYoloMode: () => boolean, emit?: (evt: ExecutionEvent) => void): AgentLoopHooks {
  return {
    // beforeToolCall: no-op by default (validation is done inline via Zod)
    beforeToolCall: async () => undefined,

    // afterToolCall: record failed tool usage to memory
    afterToolCall: async ({ result, isError }) => {
      if (!isError) return undefined;
      return undefined;
    },

  // shouldStopAfterTurn: inline thrash detection (same logic as legacy path)
  shouldStopAfterTurn: async ({ message, toolResults, newMessages }) => {
    const assistantMsg = message as any;
    if (!assistantMsg?.tool_calls?.length) return false;
    // Build callHistory from ALL previous accumulated messages in newMessages,
    // not just the current turn — so thrash detection spans the whole session.
    const callHistory: string[] = [];
    if (Array.isArray(newMessages)) {
      for (const msg of newMessages) {
        // Exclude the current message to avoid double-counting it during repeats check
        if ((msg as any) === (message as any)) continue;
        const tc = (msg as any)?.tool_calls as any[] | undefined;
        if (Array.isArray(tc)) {
          for (const t of tc) {
            const callHash = `${t.function.name}:${JSON.stringify(t.function.arguments)}`;
            if (callHash) callHistory.push(callHash);
          }
        }
      }
    }
    const threshold = getYoloMode() ? 10 : 3;
    for (const tc of assistantMsg.tool_calls) {
      const callHash = `${tc.function.name}:${JSON.stringify(tc.function.arguments)}`;
      callHistory.push(callHash);
      const repeats = callHistory.filter(h => h === callHash).length;
      if (repeats >= threshold) {
        return true;
      }
    }
    return false;
  },

    // transformContext: compact context via Pi-style HEAD + summary + TAIL
    transformContext: async ({ messages }) => {
      return await compact(messages as any);
    },
  };
}

export class TaskExecutor {
  private tools: ToolDefinition[];
  private memory = getMemoryService();
  private skills = getSkillsService();
  private hooks?: AgentLoopHooks;
  // Legacy inline thrash state (used when no shouldStopAfterTurn hook)
  private callHistory: string[] = [];
  private maxHistory = 30;

  constructor(
    tools: ToolDefinition[],
    options?: {
      /** Hook callbacks. When omitted, built-in invariant behaviours still run. */
      hooks?: AgentLoopHooks;
      /** YOLO mode getter (injected at runtime). Defaults to () => config.YOLO_MODE. */
      getYoloMode?: () => boolean;
    },
  ) {
    this.tools = tools;
    this.hooks = options?.hooks ?? createDefaultHooks(options?.getYoloMode ?? (() => config.YOLO_MODE));
    this.getYoloMode = options?.getYoloMode ?? (() => config.YOLO_MODE);
  }

  private getYoloMode: () => boolean;

  // ── Hook Invocation Helpers ─────────────────────────────────────────────

  /** Calls beforeToolCall hook. Hook errors become tool-result errors. */
  private async invokeBeforeToolCall(
    toolCall: any,
    validatedArgs: any,
    assistantMessage: any,
  ): Promise<void> {
    if (!this.hooks?.beforeToolCall) return;
    try {
      const r = await this.hooks.beforeToolCall({
        assistantMessage,
        toolCall,
        args: validatedArgs,
        context: {},
      });
      if (isBlockResult(r)) {
        throw new Error(r.reason || 'Tool execution blocked by hook');
      }
    } catch (err: any) {
      // Hook or block
      throw err;
    }
  }

  /** Calls afterToolCall hook and returns the (possibly overridden) result. */
  private async invokeAfterToolCall(
    tool: ToolDefinition | undefined,
    toolCall: any,
    args: any,
    result: ToolResult,
    isError: boolean,
    assistantMessage: any,
  ): Promise<ToolResult> {
    // Default: record memory
    if (isError && this.memory.isEnabled()) {
      await this.memory.addToolUsage(toolCall.function.name, args, result).catch(() => {});
    }
    if (!this.hooks?.afterToolCall) return result;

    try {
      const override = await this.hooks.afterToolCall({
        assistantMessage,
        toolCall,
        args,
        result,
        isError,
        context: {},
      });
      if (!override) return result;
      return {
        ...result,
        success: override.isError !== undefined ? !override.isError : result.success,
        error: override.content ?? result.error,
        metadata: override.details ? { ...result.metadata, ...override.details } : result.metadata,
      };
    } catch (err: any) {
      log(`afterToolCall hook error (${toolCall.function.name}): ${err.message}`, 'WARN');
      return result;
    }
  }

  /** Calls shouldStopAfterTurn hook. Returns true to end the agent run. */
  private async invokeShouldStopAfterTurn(
    message: any,
    toolResults: ToolResult[],
    newMessages: any[],
  ): Promise<boolean> {
    if (!this.hooks?.shouldStopAfterTurn) return false;
    try {
      return await this.hooks.shouldStopAfterTurn({
        message,
        toolResults,
        context: {},
        newMessages: newMessages as any,
      });
    } catch (err: any) {
      log(`shouldStopAfterTurn hook error: ${err.message}`, 'WARN');
      return false;
    }
  }

  async executeTask(
    task: Task,
    missionContext: string,
    workspaceRoot: string,
    onEvent?: OnEvent,
    getYoloMode: () => boolean = () => config.YOLO_MODE,
  ): Promise<Task> {
    log(`Executing task: ${task.title}`, 'INFO');

    // Trace: initialise recorder for this run
    const { createTraceRecorder } = await import('./trace.js') as typeof import('./trace.js');
    const trace = createTraceRecorder(task.id, 'session');

    /** Emit to both the live TUI and the persistent trace file. */
    const emit = (evt: ExecutionEvent) => {
      onEvent?.(evt);
      trace.event(evt).catch(() => {});
    };

    let memoriesSection = '';
    if (this.memory.isEnabled()) {
      const relevantMemories = await this.memory.retrieveRelevant(
        `${task.title} ${task.description} ${task.files.join(' ')}`,
        5,
      );
      memoriesSection = this.memory.formatMemoriesForPrompt(relevantMemories);
    }

    const isYolo = getYoloMode();
    const skillsSection = this.skills.formatForSystemPrompt();

    // Codex Context: Retrieve relevant patterns from Neo4j knowledge graph
    let codexSection = '';
    const codex = getCodexService();
    if (codex.isEnabled()) {
      const stack = detectTechStack(workspaceRoot);
      const stackPrefix = stack.length > 0 ? `[tech-stack: ${stack.join(', ')}] ` : '';
      const codexQuery = `${stackPrefix}${task.title} ${task.description} ${task.files.join(' ')}`;
      codexSection = await codex.retrieveAndFormat(codexQuery);
    }

    // Project Rules Discovery: Look for AGENTS.md, .cursorrules, or PROMPT.md
    let projectRules = '';
    const ruleFiles = ['AGENTS.md', '.cursorrules', 'PROMPT.md', 'DESIGN.md', 'GEMINI.md', 'CLAUDE.md', 'VIBES.md'];
    try {
      const fs = await import('fs/promises');
      const path = await import('path');
      for (const file of ruleFiles) {
        // DATA_SHARING guard: skip external dirs when mode is 'none'
        if (config.DATA_SHARING_MODE === 'none') {
          const resolved = path.resolve(workspaceRoot, file);
          const workspaceAbs = path.resolve(workspaceRoot);
          if (!resolved.startsWith(workspaceAbs + path.sep) && resolved !== workspaceAbs) continue;
        }
        const fullPath = path.join(workspaceRoot, file);
        try {
          const content = await fs.readFile(fullPath, 'utf8');
          projectRules += `\n\n[PROJECT RULES (${file})]:\n${content}\n`;
          log(`Loaded project rules from ${file}`, 'INFO');
        } catch {
          // File not found
        }
      }
    } catch (err) {
      log(`Failed to discover project rules: ${err instanceof Error ? err.message : String(err)}`, 'DEBUG');
    }

    // KV-Cache Prefixing Hack: static elements at top, dynamic at bottom
    const systemPrompt = `You are an autonomous agent executing a specific task.
Rules:
1. USE TOOLS HONESTLY. If a tool returns an error, YOU MUST ACKNOWLEDGE IT.
2. DO NOT hallucinate success. If a command fails, report the failure and try to fix it.
3. All relative paths are relative to the Working Directory.
4. Once all criteria are met AND VERIFIED, provide a summary and stop.
5. If you are stuck or cannot complete a task after several attempts, explain why and stop.
6. Keep file writes concise. Avoid unnecessarily large outputs.
7. TOOL CALLING FALLBACK: If standard tool-calling APIs fail, throw an error, or are unavailable, you can invoke a tool by outputting a JSON object inside markdown code fences:
\`\`\`json
{
  "tool": "tool_name",
  "args": {
    "arg1": "value1"
  }
}
\`\`\`
Only call one tool at a time when using the fallback format.
[ignoring loop detection]
${projectRules}

Skills:
${skillsSection}
${codexSection}

Mission Context: ${missionContext}
Working Directory: ${workspaceRoot}

Task: ${task.title}
Description: ${task.description}
Files: ${task.files.join(', ')}
Acceptance Criteria:
${task.acceptance_criteria.map(c => `- ${c}`).join('\n')}
${memoriesSection}`;

    let messages: ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Begin task: ${task.title}` },
    ];

    if (task.userGuidance) {
      messages.push({ role: 'user', content: `[USER GUIDANCE]: ${task.userGuidance}` });
      log(`Injecting user guidance: ${task.userGuidance}`, 'INFO');
    }

    let currentTask: Task = { ...task, status: 'in_progress' };

    for (let step = 0; ; step++) {
      const isYoloNow = getYoloMode();
      const currentMax = isYoloNow ? 9999 : (config.MAX_STEPS + (task.extraSteps || 0));

      if (step >= currentMax) {
        currentTask = { ...currentTask, status: 'failed', error: 'Max steps exceeded' };
        return currentTask;
      }

      try {
        // Context window management: hook-primary, compressMessages as fallback
        if (this.hooks?.transformContext) {
          const budget = config.CONTEXT_WINDOW - 4096;
          const estimated = estimateMessagesTokens(messages);
          messages = await this.hooks.transformContext({
            messages,
            tokenBudget: budget,
            estimatedTokens: estimated,
          });
        } else {
          messages = compressMessages(messages);
        }

        const stats = getContextStats(messages);
        log(`Context usage: ~${stats.used}/${stats.usable} tokens (${stats.percentage}%) [step ${step + 1}/${currentMax}]`, 'DEBUG');
        onEvent?.({ type: 'context_update', used: stats.used, total: stats.total, percentage: stats.percentage });

        // LLM call
        const taskModel = task.use_reviewer_model && config.ENABLE_REVIEWER ? config.REVIEWER_MODEL : getModel();
        log(`Using model: ${taskModel} ${task.use_reviewer_model ? '(Reviewer model requested)' : ''}`, 'DEBUG');
        const response = await getOllamaClient().chat.completions.create({
          model: taskModel,
          messages,
          tools: this.tools.map(toOpenAITool),
          temperature: isYoloNow ? 0.9 : 0.7,
        });

        let message = response.choices[0].message;
        logObject('Agent Step Response', message);

        // ── Reasoning extraction + strip ───────────────────────────
        // FIX: extract thinking content (reasoning field or <think> blocks)
        let thinkingContent: string | undefined;
        if ((message as any).reasoning) {
          thinkingContent = (message as any).reasoning;
        }
        if (typeof message.content === 'string' && message.content.includes('<think>')) {
          const thinkMatch = message.content.match(/<think>([\s\S]*?)<\/think>/);
          if (thinkMatch) {
            thinkingContent = (thinkingContent ?? '') + ' ' + thinkMatch[1].trim();
          }
        }
        if (thinkingContent) {
          onEvent?.({ type: 'thinking', content: thinkingContent.trim() });
        }

        // Strip <think> blocks and reasoning field from the message before saving to context
        if (typeof message.content === 'string') {
          message = {
            ...message,
            content: message.content.replace(/<think>[\s\S]*?<\/think>/, '').trim(),
          } as any;
        }
        if ((message as any).reasoning) {
          delete (message as any).reasoning;
        }
        // ── Manual/Markdown Tool Call Fallback ──────────────────────
        if (!message.tool_calls?.length && typeof message.content === 'string' && message.content.trim()) {
          const manualCalls = parseMarkdownToolCalls(message.content);
          if (manualCalls) {
            log(`Parsed ${manualCalls.length} manual/markdown tool call(s) from message content.`, 'INFO');
            message.tool_calls = manualCalls as any;
          }
        }
        // ────────────────────────────────────────────────────────────

        messages.push(message as ChatCompletionMessageParam);

        // shouldStopAfterTurn on text-only answers (when no tool calls)
        if (!message.tool_calls?.length && message.content) {
          const stop = await this.invokeShouldStopAfterTurn(message, [], messages);
          if (stop) {
 log('shouldStopAfterTurn hook stopped after text answer', 'INFO');
            currentTask = { ...currentTask, status: 'done', output: message.content };
            return currentTask;
          }
        }

        if (message.tool_calls && message.tool_calls.length > 0) {
          // ── Preflight pass — parse args, run hooks, validate (always sequential) ──
          // Each entry carries a per-tool result slot; tool.execute() may be deferred.
          const preflight: Array<{
            toolCall: any;
            args: any;
            parsed: boolean;
            tool: ToolDefinition | undefined;
            validatedArgs: any;
            execError: string | undefined;
            preResult: ToolResult;
            run: () => Promise<ToolResult>;
          }> = [];

          for (const toolCall of message.tool_calls) {
            let args: any;
            let parsed = false;
            let preResult: ToolResult = { success: false, error: 'Unknown error' };

            try {
              args = JSON.parse(toolCall.function.arguments);
              parsed = true;
            } catch (parseError: any) {
              preResult = { success: false, error: `JSON parse error: ${parseError.message}` };
            }

            onEvent?.({
              type: 'tool_call',
              tool: toolCall.function.name,
              args: parsed ? args : toolCall.function.arguments,
            });

            if (!parsed) {
              onEvent?.({ type: 'tool_result', tool: toolCall.function.name, result: preResult });
              logObject(`Tool Parse Error [${toolCall.function.name}]`, preResult);
              messages.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: JSON.stringify(preResult),
              });
              continue;
            }

            const tool = this.tools.find(t => t.name === toolCall.function.name);
            if (!tool) {
              preResult = { success: false, error: `Tool ${toolCall.function.name} not found` };
              onEvent?.({ type: 'tool_result', tool: toolCall.function.name, result: preResult });
              messages.push({ role: 'tool', tool_call_id: toolCall.id, content: JSON.stringify(preResult) });
              continue;
            }

            let validatedArgs: any = args;
            let execError: string | undefined;

            try {
              // Severity-blocked beforeToolCall hook
              await this.invokeBeforeToolCall(toolCall, args, message);

              // Validate
              const parseResult = tool.parameters.safeParse(args);
              if (parseResult.success) {
                validatedArgs = parseResult.data;
              } else {
                preResult = { success: false, error: `Invalid tool arguments: ${parseResult.error.message}` };
                onEvent?.({ type: 'tool_result', tool: toolCall.function.name, result: preResult });
                messages.push({ role: 'tool', tool_call_id: toolCall.id, content: JSON.stringify(preResult) });
                continue;
              }

              // afterToolCall hook preflight (run per-tool by default, still sequential)
              try {
                await this.invokeAfterToolCall(tool, toolCall, validatedArgs, preResult, true, message);
              } catch (hookErr: any) {
                // Non-fatal: log but carry on
                log(`afterToolCall hook error [${toolCall.function.name}]: ${hookErr.message}`, 'WARN');
              }
            } catch (err: any) {
              preResult = { success: false, error: err.message || 'Tool execution error' };
              execError = err.message || 'Tool execution error';
            }

            // Build the deferred runner: executes all actual tool.execute() calls concurrently
            const entry = {
              toolCall,
              args,
              parsed,
              tool,
              validatedArgs,
              execError,
              preResult,
              run: async (): Promise<ToolResult> => {
                if (entry.execError) {
                  return entry.preResult;
                }
                let result: ToolResult;
                try {
                  result = await tool!.execute(entry.validatedArgs, { workspaceRoot });
                } catch (execErr: any) {
                  entry.execError = execErr.message;
                  result = { success: false, error: `Execution error: ${execErr.message}` };
                }
                try {
                  const final = entry.execError
                    ? result
                    : await this.invokeAfterToolCall(tool, toolCall, entry.validatedArgs, result, !result.success, message);
                  result = final;
                } catch (hookErr: any) {
                  log(`afterToolCall hook error [${toolCall.function.name}]: ${hookErr.message}`, 'WARN');
                }
                return result;
              },
            };
            preflight.push(entry);
          }

          if (preflight.length === 0) {
            // nothing valid to execute; already logged above
          } else {
            const turnResults: ToolResult[] = [];

            if (config.TOOL_EXECUTION_MODE === ToolExecutionMode.PARALLEL) {
              // ── PARALLEL EXECUTION pass ────────────────────────────────────────
              // Hoist 'results' into the enclosing for-loop scope so the
              // post-loop accommodation (see below) can reference it.
              let results: ToolResult[] = [];
              const started = Date.now();
              const settled = await Promise.allSettled(preflight.map(e => e.run().catch(err => ({ success: false, error: err.message || 'Promise rejection' } as ToolResult))));
              const elapsedMs = Date.now() - started;

              // build result array (defined in outer scope) with preserved indices
              results = preflight.map((entry, i) => {
                const payload = (settled[i] as PromiseFulfilledResult<ToolResult>).value;
                entry.execError = entry.execError || (!payload.success ? payload.error : undefined);
                return entry.execError ? entry.preResult : payload;
              });
              turnResults.push(...results);

              // ── Post-parallel: emit events + truncate + append in fallback ────────
              for (let i = 0; i < preflight.length; i++) {
                const entry   = preflight[i];
                const result  = results as ToolResult[];

                onEvent?.({ type: 'tool_result', tool: entry.toolCall.function.name, result: result[i] });
                logObject(`Tool Result [${entry.toolCall.function.name}] (parallel, ${elapsedMs} ms total)`, result[i]);
                const resultStr = JSON.stringify(result[i]);
                const truncatedResult = truncateToolResult(resultStr, entry.toolCall.function.name);
                messages.push({
                  role: 'tool',
                  tool_call_id: entry.toolCall.id,
                  content: truncatedResult,
                });
              }
            } else {
              // ── SEQUENTIAL pass ─────────────────────────────────────────────────
              for (const entry of preflight) {
                const result = await entry.run();
                turnResults.push(result);
                onEvent?.({ type: 'tool_result', tool: entry.toolCall.function.name, result });
                logObject(`Tool Result [${entry.toolCall.function.name}]`, result);
                const resultStr = JSON.stringify(result);
                const truncatedResult = truncateToolResult(resultStr, entry.toolCall.function.name);
                messages.push({
                  role: 'tool',
                  tool_call_id: entry.toolCall.id,
                  content: truncatedResult,
                });
              }
            }

            // Invoke shouldStopAfterTurn hook
            const stop = await this.invokeShouldStopAfterTurn(message, turnResults, messages);
            if (stop) {
              log('shouldStopAfterTurn hook stopped execution after tool results (thrash detection)', 'WARN');
              currentTask = { ...currentTask, status: 'failed', error: 'Agent loop stopped by thrash detection (potential infinite loop)' };
              return currentTask;
            }
          }
        } else if (message.content) {
          log(`Task output: ${message.content.slice(0, 100)}...`, 'INFO');
          onEvent?.({ type: 'output', content: message.content });
          currentTask = { ...currentTask, status: 'done', output: message.content };
          return currentTask;
        }
      } catch (error: any) {
        log(`Task error: ${error.message}`, 'ERROR');
        onEvent?.({ type: 'error', message: error.message });
        currentTask = { ...currentTask, status: 'failed', error: error.message };
        return currentTask;
      }
    }

    currentTask = { ...currentTask, status: 'failed', error: 'Max steps exceeded' };
    return currentTask;
  }
}

function parseMarkdownToolCalls(content: string): any[] | null {
  const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const textToParse = jsonMatch ? jsonMatch[1].trim() : content.trim();

  const start = textToParse.indexOf('{');
  const startArr = textToParse.indexOf('[');

  let jsonString = '';
  if (startArr !== -1 && (start === -1 || startArr < start)) {
    const endArr = textToParse.lastIndexOf(']');
    if (endArr !== -1) {
      jsonString = textToParse.slice(startArr, endArr + 1);
    }
  } else if (start !== -1) {
    const end = textToParse.lastIndexOf('}');
    if (end !== -1) {
      jsonString = textToParse.slice(start, end + 1);
    }
  }

  if (!jsonString) return null;

  try {
    const parsed = JSON.parse(jsonString);
    if (Array.isArray(parsed)) {
      const calls: any[] = [];
      for (const item of parsed) {
        if (item && typeof item === 'object' && (item.tool || item.tool_name)) {
          calls.push({
            id: `manual_${Math.random().toString(36).substr(2, 9)}`,
            type: 'function',
            function: {
              name: item.tool || item.tool_name,
              arguments: typeof item.args === 'string' ? item.args : JSON.stringify(item.args || item.arguments || {})
            }
          });
        }
      }
      return calls.length > 0 ? calls : null;
    } else if (parsed && typeof parsed === 'object' && (parsed.tool || parsed.tool_name)) {
      return [{
        id: `manual_${Math.random().toString(36).substr(2, 9)}`,
        type: 'function',
        function: {
          name: parsed.tool || parsed.tool_name,
          arguments: typeof parsed.args === 'string' ? parsed.args : JSON.stringify(parsed.args || parsed.arguments || {})
        }
      }];
    }
  } catch (e) {
    // JSON parse error
  }
  return null;
}
