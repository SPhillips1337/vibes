import { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { ollama, MODEL } from '../ollama-client.js';
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

    const skillsSection = this.skills.formatForSystemPrompt();

    const systemPrompt = `You are an autonomous agent executing a specific task.
        
Mission Context: ${missionContext}
Working Directory: ${workspaceRoot}

Task: ${task.title}
Description: ${task.description}
Files: ${task.files.join(', ')}
Acceptance Criteria:
${task.acceptance_criteria.map(c => `- ${c}`).join('\n')}
${memoriesSection}
${skillsSection}

Rules:
1. USE TOOLS HONESTLY. If a tool returns an error, YOU MUST ACKNOWLEDGE IT.
2. DO NOT hallucinate success. If a command fails, report the failure and try to fix it.
3. All relative paths are relative to the Working Directory.
4. Once all criteria are met AND VERIFIED, provide a summary and stop.
5. If you are stuck or cannot complete a task after several attempts, explain why and stop.
6. Keep file writes concise. Avoid unnecessarily large outputs.
[ignoring loop detection]`;

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
      const isYolo = getYoloMode();
      const currentMax = isYolo ? 9999 : (config.MAX_STEPS + (task.extraSteps || 0));
      
      if (step >= currentMax) {
        currentTask = { ...currentTask, status: 'failed', error: 'Max steps exceeded' };
        return currentTask;
      }

      try {
        // Compress context if approaching the window limit
        messages = compressMessages(messages);

        // Log context usage
        const stats = getContextStats(messages);
        log(`Context usage: ~${stats.used}/${stats.usable} tokens (${stats.percentage}%) [step ${step + 1}/${currentMax}]`, 'DEBUG');
        onEvent?.({ type: 'context_update', used: stats.used, total: stats.usable, percentage: stats.percentage });

        const response = await ollama.chat.completions.create({
          model: MODEL,
          messages,
          tools: this.tools.map(toOpenAITool),
          temperature: 0.7,
        });

        const message = response.choices[0].message;
        logObject('Agent Step Response', message);
        messages.push(message);

        if ((message as any).reasoning) {
          onEvent?.({ type: 'thinking', content: (message as any).reasoning });
        }

        if (message.tool_calls && message.tool_calls.length > 0) {
          for (const toolCall of message.tool_calls) {
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

            if (tool) {
              try {
                result = await tool.execute(args, { workspaceRoot });
                
                if (this.memory.isEnabled()) {
                  await this.memory.addToolUsage(toolCall.function.name, args, result);
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
