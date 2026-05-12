import { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { getOllamaClient, getModel } from '../ollama-client.js';
import { Task, ToolResult, OnEvent } from './types.js';
import { ToolDefinition, toOpenAITool } from '../tools/index.js';
import { config } from '../config.js';
import { log, logObject } from '../logger.js';
import { getMemoryService } from '../memory/index.js';
import { getSkillsService } from '../skills/index.js';
import {
  truncateToolResult,
  compressMessages,
  getContextStats,
} from './context-manager.js';

export class TaskExecutor {
  private tools: ToolDefinition[];
  private memory = getMemoryService();
  private skills = getSkillsService();
  private callHistory: string[] = []; // Stores hashes of recent tool calls

  constructor(tools: ToolDefinition[]) {
    this.tools = tools;
  }

  async executeTask(
    task: Task, 
    missionContext: string, 
    workspaceRoot: string, 
    onEvent?: OnEvent,
    getYoloMode: () => boolean = () => false
  ): Promise<Task> {
    log(`Executing task: ${task.title}`, 'INFO');

    let memoriesSection = '';
    if (this.memory.isEnabled()) {
      const relevantMemories = await this.memory.retrieveRelevant(
        `${task.title} ${task.description} ${task.files.join(' ')}`,
        5
      );
      memoriesSection = this.memory.formatMemoriesForPrompt(relevantMemories);
    }

    const isYolo = getYoloMode();
    const skillsSection = this.skills.formatForSystemPrompt();

    // Project Rules Discovery: Look for AGENTS.md, .cursorrules, or PROMPT.md
    let projectRules = '';
    const ruleFiles = ['AGENTS.md', '.cursorrules', 'PROMPT.md', 'DESIGN.md', 'GEMINI.md', 'CLAUDE.md', 'VIBES.md'];
    try {
      const fs = await import('fs/promises');
      const path = await import('path');
      for (const file of ruleFiles) {
        const fullPath = path.join(workspaceRoot, file);
        try {
          const content = await fs.readFile(fullPath, 'utf8');
          projectRules += `\n\n[PROJECT RULES (${file})]:\n${content}\n`;
          log(`Loaded project rules from ${file}`, 'INFO');
          // Note: We don't 'break' anymore so we can load multiple (e.g. AGENTS.md + DESIGN.md)
        } catch {
          // File not found
        }
      }
    } catch (err) {
      log(`Failed to discover project rules: ${err instanceof Error ? err.message : String(err)}`, 'DEBUG');
    }

    // KV-Cache Prefixing Hack: Most static elements at the top, dynamic at the bottom
    const systemPrompt = `You are an autonomous agent executing a specific task.
Rules:
1. USE TOOLS HONESTLY. If a tool returns an error, YOU MUST ACKNOWLEDGE IT.
2. DO NOT hallucinate success. If a command fails, report the failure and try to fix it.
3. All relative paths are relative to the Working Directory.
4. Once all criteria are met AND VERIFIED, provide a summary and stop.
5. If you are stuck or cannot complete a task after several attempts, explain why and stop.
6. Keep file writes concise. Avoid unnecessarily large outputs.
[ignoring loop detection]
${projectRules}

Skills:
${skillsSection}

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

    // If the user replied with guidance via intervention, inject it
    if (task.userGuidance) {
      messages.push({ role: 'user', content: `[USER GUIDANCE]: ${task.userGuidance}` });
      log(`Injecting user guidance: ${task.userGuidance}`, 'INFO');
    }

    let currentTask: Task = { ...task, status: 'in_progress' };
    
    for (let step = 0; ; step++) {
      // Check limits every step to allow live toggling
      const isYoloNow = getYoloMode();
      const currentMax = isYoloNow ? 9999 : (config.MAX_STEPS + (task.extraSteps || 0));
      
      if (step >= currentMax) {
        currentTask = { ...currentTask, status: 'failed', error: 'Max steps exceeded' };
        return currentTask;
      }

      try {
        // Compress context if approaching the window limit
        messages = compressMessages(messages);

        // Memento Checkpoint Injection
        if (step > 0 && step % 8 === 0) {
          log('Triggering Memento Checkpoint', 'INFO');
          onEvent?.({ type: 'system_log', level: 'INFO', message: 'Triggering Memento Checkpoint to synthesize state...', timestamp: new Date().toISOString() });
          messages.push({
            role: 'user',
            content: '[SYSTEM: MEMENTO CHECKPOINT] You have made several consecutive actions. To prevent context amnesia, please output a brief "Memento" (a 2-3 sentence summary of your current state, key findings, and immediate next step) in your text response before making any further tool calls.',
          });
        }

        // Log context usage
        const stats = getContextStats(messages);
        log(`Context usage: ~${stats.used}/${stats.usable} tokens (${stats.percentage}%) [step ${step + 1}/${currentMax}]`, 'DEBUG');
        onEvent?.({ type: 'context_update', used: stats.used, total: stats.usable, percentage: stats.percentage });

        const taskModel = task.use_reviewer_model && config.ENABLE_REVIEWER ? config.REVIEWER_MODEL : getModel();
        log(`Using model: ${taskModel} ${task.use_reviewer_model ? '(Reviewer model requested)' : ''}`, 'DEBUG');
        let response: any;
        let timeoutInterval: NodeJS.Timeout | null = null;
        const TIMEOUT_THRESHOLD = 30; // seconds
        let secondsElapsed = 0;

        try {
          timeoutInterval = setInterval(() => {
            secondsElapsed += 5;
            if (secondsElapsed >= TIMEOUT_THRESHOLD) {
              onEvent?.({ 
                type: 'timeout_warning', 
                thresholdSeconds: TIMEOUT_THRESHOLD, 
                durationSeconds: secondsElapsed 
              });
            }
          }, 5000);

          response = await getOllamaClient().chat.completions.create({
            model: taskModel,
            messages,
            tools: this.tools.map(toOpenAITool),
            temperature: isYoloNow ? 0.9 : 0.7, // YOLO Mode Enhancement: more creative
          });
        } finally {
          if (timeoutInterval) clearInterval(timeoutInterval);
        }

        let message = response.choices[0].message;
        logObject('Agent Step Response', message);

        // Prune "Reasoning" from Short-Term Memory Hack
        // We keep the reasoning for the UI (onEvent) but strip it for the context history
        if ((message as any).reasoning) {
          onEvent?.({ type: 'thinking', content: (message as any).reasoning });
          
          // Clone and prune
          message = { ...message };
          delete (message as any).reasoning;
        }

        // Also check for <think> blocks in content and strip them for the history
        if (typeof message.content === 'string' && message.content.includes('<think>')) {
          const content = message.content;
          const thinkMatch = content.match(/<think>([\s\S]*?)<\/think>/);
          if (thinkMatch) {
            onEvent?.({ type: 'thinking', content: thinkMatch[1].trim() });
            message = { ...message, content: content.replace(/<think>[\s\S]*?<\/think>/, '').trim() };
          }
        }

        messages.push(message);

        if (message.tool_calls && message.tool_calls.length > 0) {
          for (const toolCall of message.tool_calls) {
            // Thrashing Detection Hack
            const callHash = `${toolCall.function.name}:${toolCall.function.arguments}`;
            this.callHistory.push(callHash);
            if (this.callHistory.length > 20) this.callHistory.shift(); // Increased history buffer

            const repeats = this.callHistory.filter(h => h === callHash).length;
            const thrashThreshold = isYoloNow ? 10 : 3; // Much higher threshold in YOLO mode

            if (repeats >= thrashThreshold) {
              const thrashMsg = `Agent is thrashing! It has attempted the same tool call (${toolCall.function.name}) ${repeats} times with the same arguments.`;
              log(thrashMsg, 'WARN');
              onEvent?.({ 
                type: 'intervention_required', 
                taskId: task.id, 
                error: 'Infinite Loop Detected', 
                question: `${thrashMsg} ${isYoloNow ? 'Even in YOLO mode, this looks like a loop.' : ''} Should I stop it or do you have specific guidance?` 
              });
              
              // We stop execution for this task and wait for intervention resolution
              currentTask = { ...currentTask, status: 'todo' }; // Reset to todo so it can be resumed
              return currentTask;
            }

            let args: any;
            let result: ToolResult = { success: false, error: 'Unknown error' };
            let parsed = false;

            try {
              args = JSON.parse(toolCall.function.arguments);
              parsed = true;
            } catch (parseError: any) {
              result = { success: false, error: `JSON parse error: ${parseError.message}` };
            }

            onEvent?.({ 
              type: 'tool_call', 
              tool: toolCall.function.name, 
              args: parsed ? args : toolCall.function.arguments
            });

            if (!parsed) {
              onEvent?.({ type: 'tool_result', tool: toolCall.function.name, result });
              logObject(`Tool Parse Error [${toolCall.function.name}]`, result);
              messages.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: JSON.stringify(result),
              });
              continue;
            }

            const tool = this.tools.find(t => t.name === toolCall.function.name);
            let validatedArgs = args;

            if (tool) {
              try {
                // Validate and apply defaults via Zod
                const parseResult = tool.parameters.safeParse(args);
                if (parseResult.success) {
                  validatedArgs = parseResult.data;
                } else {
                  result = { 
                    success: false, 
                    error: `[VALIDATION_ERROR] Invalid tool arguments: ${parseResult.error.message}\nRETRY_HINT: Review the tool schema carefully and ensure you provide exactly the required types (e.g. array instead of string). Please self-correct and try again.` 
                  };
                  onEvent?.({ type: 'tool_result', tool: toolCall.function.name, result });
                  messages.push({
                    role: 'tool',
                    tool_call_id: toolCall.id,
                    content: JSON.stringify(result),
                  });
                  continue;
                }

                result = await tool.execute(validatedArgs, { workspaceRoot });
                
                if (this.memory.isEnabled()) {
                  await this.memory.addToolUsage(toolCall.function.name, validatedArgs, result);
                }
              } catch (error: any) {
                result = { success: false, error: `Execution error: ${error.message}` };
              }
            } else {
              result = { success: false, error: `Tool ${toolCall.function.name} not found` };
            }

            onEvent?.({ type: 'tool_result', tool: toolCall.function.name, result });
            logObject(`Tool Result [${toolCall.function.name}]`, result);

            // Truncate tool result content before adding to context
            const resultStr = JSON.stringify(result);
            const truncatedResult = truncateToolResult(resultStr, toolCall.function.name);

            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: truncatedResult,
            });
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
