import { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { ollama, MODEL } from '../ollama-client.js';
import { Task, ToolResult, OnEvent } from './types.js';
import { ToolDefinition, toOpenAITool } from '../tools/index.js';
import { config } from '../config.js';
import { log, logObject } from '../logger.js';

export class TaskExecutor {
  private tools: ToolDefinition[];

  constructor(tools: ToolDefinition[]) {
    this.tools = tools;
  }

  async executeTask(task: Task, missionContext: string, workspaceRoot: string, onEvent?: OnEvent): Promise<Task> {
    log(`Executing task: ${task.title}`, 'INFO');
    const messages: ChatCompletionMessageParam[] = [
      {
        role: 'system',
        content: `You are an autonomous agent executing a specific task.
        
Mission Context: ${missionContext}
Working Directory: ${workspaceRoot}

Task: ${task.title}
Description: ${task.description}
Files: ${task.files.join(', ')}
Acceptance Criteria:
${task.acceptance_criteria.map(c => `- ${c}`).join('\n')}

Rules:
1. USE TOOLS HONESTLY. If a tool returns an error, YOU MUST ACKNOWLEDGE IT.
2. DO NOT hallucinate success. If a command fails, report the failure and try to fix it.
3. All relative paths are relative to the Working Directory.
4. Once all criteria are met AND VERIFIED, provide a summary and stop.
5. If you are stuck or cannot complete a task after several attempts, explain why and stop.`,
      },
      { role: 'user', content: `Begin task: ${task.title}` },
    ];

    let currentTask: Task = { ...task, status: 'in_progress' };

    for (let step = 0; step < config.MAX_STEPS; step++) {
      try {
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
            onEvent?.({ 
              type: 'tool_call', 
              tool: toolCall.function.name, 
              args: JSON.parse(toolCall.function.arguments) 
            });

            const tool = this.tools.find(t => t.name === toolCall.function.name);
            let result: ToolResult;

            if (tool) {
              try {
                const args = JSON.parse(toolCall.function.arguments);
                result = await tool.execute(args, { workspaceRoot });
              } catch (error: any) {
                result = { success: false, error: `Execution error: ${error.message}` };
              }
            } else {
              result = { success: false, error: `Tool ${toolCall.function.name} not found` };
            }

            onEvent?.({ type: 'tool_result', tool: toolCall.function.name, result });
            logObject(`Tool Result [${toolCall.function.name}]`, result);

            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: JSON.stringify(result),
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
