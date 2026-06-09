import { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { getModel, getOllamaClient } from '../ollama-client.js';
import { ToolDefinition, toOpenAITool } from '../tools/index.js';
import { log, logObject } from '../logger.js';

export enum AgentRole {
  PLANNER = 'planner',
  CODER = 'coder',
  REVIEWER = 'reviewer',
  SUPERVISOR = 'supervisor',
}

export interface AgentConfig {
  role: AgentRole;
  name: string;
  systemPrompt: string;
  tools?: ToolDefinition[];
  maxSteps?: number;
}

export interface AgentMessage {
  from: AgentRole;
  to: AgentRole;
  content: string;
  timestamp: number;
}

export interface MultiAgentResult {
  success: boolean;
  messages: AgentMessage[];
  finalOutput?: string;
  error?: string;
}

export class BaseAgent {
  protected role: AgentRole;
  protected name: string;
  protected systemPrompt: string;
  protected tools: ToolDefinition[];
  protected maxSteps: number;
  protected messageHistory: ChatCompletionMessageParam[] = [];

  constructor(config: AgentConfig) {
    this.role = config.role;
    this.name = config.name;
    this.systemPrompt = config.systemPrompt;
    this.tools = config.tools || [];
    this.maxSteps = config.maxSteps || 10;
  }

  protected async chat(userMessage: string, useTools: boolean = true): Promise<string> {
    const messages: ChatCompletionMessageParam[] = [
      { role: 'system', content: this.systemPrompt },
      ...this.messageHistory,
      { role: 'user', content: userMessage },
    ];

    try {
      const response = await getOllamaClient().chat.completions.create({
        model: getModel(),
        messages,
        tools: useTools && this.tools.length > 0 ? this.tools.map(toOpenAITool) : undefined,
        temperature: 0.7,
      });

      const message = response.choices[0]?.message;
      const rawMsg = message as any;
      const text = message?.content || rawMsg?.reasoning_content || '';
      if (text) {
        this.messageHistory.push({ role: 'user', content: userMessage });
        this.messageHistory.push({ ...message, content: text });
        return text;
      }
      return '';
    } catch (error: any) {
      log(`Agent ${this.role} error: ${error.message}`, 'ERROR');
      throw error;
    }
  }

  resetHistory() {
    this.messageHistory = [];
  }

  getRole(): AgentRole {
    return this.role;
  }
}

export class PlannerAgent extends BaseAgent {
  constructor() {
    super({
      role: AgentRole.PLANNER,
      name: 'Planner',
      systemPrompt: `You are a mission planning agent. Your job is to break down user requests into clear, actionable tasks.

Output format: Return a JSON object with:
{
  "milestones": [
    {
      "title": "Milestone name",
      "tasks": [
        {
          "title": "Task name",
          "description": "What to do",
          "files": ["file paths"],
          "acceptance_criteria": ["success conditions"]
        }
      ]
    }
  ]
}

Constraints:
- MAX 3 milestones
- MAX 5 tasks per milestone
- Keep descriptions short
- Focus on the primary goal first
- No extra text, just the JSON`,
      maxSteps: 5,
    });
  }

  async plan(description: string): Promise<any> {
    const result = await this.chat(description, false);
    try {
      const parsed = JSON.parse(result);
      return parsed;
    } catch {
      return JSON.parse(result.replace(/```json|```/g, '').trim());
    }
  }
}

export class CoderAgent extends BaseAgent {
  constructor(tools: ToolDefinition[]) {
    super({
      role: AgentRole.CODER,
      name: 'Coder',
      systemPrompt: `You are a coding agent. Your job is to execute tasks using the available tools.

Mission: Complete the assigned task
Working Directory: Provided in context

Rules:
1. Use tools honestly - acknowledge errors
2. Don't hallucinate success
3. All paths are relative to working directory
4. Once criteria are met AND verified, stop
5. If stuck after several attempts, explain why`,
      tools,
      maxSteps: 15,
    });
  }

  async execute(taskDescription: string, workspaceRoot: string): Promise<string> {
    const context = `Working Directory: ${workspaceRoot}\n\nTask: ${taskDescription}`;
    return this.chat(context);
  }
}

export class ReviewerAgent extends BaseAgent {
  constructor() {
    super({
      role: AgentRole.REVIEWER,
      name: 'Reviewer',
      systemPrompt: `You are a code review agent. Your job is to analyze code changes and provide feedback.

Review criteria:
1. Does the code meet the acceptance criteria?
2. Are there obvious bugs or issues?
3. Is the code maintainable?
4. Are there security concerns?
5. Does it follow best practices?

Output format: Return a JSON object:
{
  "approved": boolean,
  "issues": ["issue 1", "issue 2"],
  "suggestions": ["suggestion 1"],
  "summary": "Overall assessment"
}

If approved is false, provide specific issues that need fixing.`,
      maxSteps: 5,
    });
  }

  async review(codeChanges: string, criteria: string[]): Promise<any> {
    const prompt = `Review the following code changes:\n\nCode:\n${codeChanges}\n\nAcceptance Criteria:\n${criteria.join('\n')}`;
    const result = await this.chat(prompt, false);
    try {
      return JSON.parse(result);
    } catch {
      return JSON.parse(result.replace(/```json|```/g, '').trim());
    }
  }
}

export class SupervisorAgent extends BaseAgent {
  private planner: PlannerAgent;
  private coder: CoderAgent;
  private reviewer: ReviewerAgent;
  private pendingReviews: Map<string, string> = new Map();

  constructor(tools: ToolDefinition[]) {
    super({
      role: AgentRole.SUPERVISOR,
      name: 'Supervisor',
      systemPrompt: `You are a supervisor agent coordinating multiple specialized agents.

Agents available:
- Planner: Creates task plans
- Coder: Executes coding tasks
- Reviewer: Reviews code changes

Your job is to:
1. Understand the user's request
2. Delegate to appropriate agents
3. Coordinate their work
4. Ensure quality through review loops
5. Provide final output to user`,
      maxSteps: 20,
    });

    this.planner = new PlannerAgent();
    this.coder = new CoderAgent(tools);
    this.reviewer = new ReviewerAgent();
  }

  async runMission(description: string, workspaceRoot: string): Promise<MultiAgentResult> {
    const messages: AgentMessage[] = [];
    const startTime = Date.now();

    try {
      log(`Supervisor: Starting mission planning`, 'INFO');
      messages.push({
        from: AgentRole.SUPERVISOR,
        to: AgentRole.PLANNER,
        content: description,
        timestamp: Date.now(),
      });

      const plan = await this.planner.plan(description);
      messages.push({
        from: AgentRole.PLANNER,
        to: AgentRole.SUPERVISOR,
        content: JSON.stringify(plan),
        timestamp: Date.now(),
      });

      let finalOutput = '';

      for (const milestone of plan.milestones || []) {
        for (const task of milestone.tasks || []) {
          log(`Supervisor: Executing task - ${task.title}`, 'INFO');
          messages.push({
            from: AgentRole.SUPERVISOR,
            to: AgentRole.CODER,
            content: task.description,
            timestamp: Date.now(),
          });

          const taskResult = await this.coder.execute(task.description, workspaceRoot);
          messages.push({
            from: AgentRole.CODER,
            to: AgentRole.SUPERVISOR,
            content: taskResult,
            timestamp: Date.now(),
          });

          log(`Supervisor: Reviewing task - ${task.title}`, 'INFO');
          messages.push({
            from: AgentRole.SUPERVISOR,
            to: AgentRole.REVIEWER,
            content: taskResult,
            timestamp: Date.now(),
          });

          const review = await this.reviewer.review(taskResult, task.acceptance_criteria || []);
          messages.push({
            from: AgentRole.REVIEWER,
            to: AgentRole.SUPERVISOR,
            content: JSON.stringify(review),
            timestamp: Date.now(),
          });

          if (!review.approved) {
            log(`Supervisor: Task ${task.title} needs revision`, 'WARN');
            const retryResult = await this.coder.execute(
              `Fix these issues: ${review.issues.join(', ')}\n\nOriginal task: ${task.description}`,
              workspaceRoot
            );
            
            const retryReview = await this.reviewer.review(retryResult, task.acceptance_criteria || []);
            if (!retryReview.approved) {
              return {
                success: false,
                messages,
                error: `Task ${task.title} failed review after retry: ${retryReview.issues.join(', ')}`,
              };
            }
            finalOutput += `\n--- ${task.title} ---\n${retryResult}`;
          } else {
            finalOutput += `\n--- ${task.title} ---\n${taskResult}`;
          }
        }
      }

      log(`Supervisor: Mission completed successfully`, 'INFO');
      return {
        success: true,
        messages,
        finalOutput,
      };
    } catch (error: any) {
      log(`Supervisor: Mission failed - ${error.message}`, 'ERROR');
      return {
        success: false,
        messages,
        error: error.message,
      };
    }
  }
}