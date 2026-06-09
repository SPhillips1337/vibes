import { v4 as uuidv4 } from 'uuid';
import { getOllamaClient, getModel } from '../ollama-client.js';
import { config } from '../config.js';
import { Mission, MissionSchema } from './types.js';
import { logObject, log } from '../logger.js';
import { repairJson, extractJsonContent } from './json-repair.js';
import { getMemoryService } from '../memory/index.js';
import { detectTechStack } from './tech-stack.js';

export class MissionPlanner {
  private memory = getMemoryService();

  async planMission(description: string, workspaceRoot: string = process.cwd()): Promise<Mission> {
    log(`Planning mission: ${description}`, 'INFO');

    let memoriesSection = '';
    if (this.memory.isEnabled()) {
      const relevantMemories = await this.memory.retrieveRelevant(
        `${workspaceRoot} ${description}`,
        5
      );
      memoriesSection = this.memory.formatMemoriesForPrompt(relevantMemories);
    }

    // Project Rules Discovery Hack
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
          log(`Loaded project rules for planning from ${file}`, 'INFO');
        } catch {
          // File not found
        }
      }
    } catch (err) {
      log(`Failed to discover project rules for planning: ${err instanceof Error ? err.message : String(err)}`, 'DEBUG');
    }

    // Tech Stack Detection
    const stack = detectTechStack(workspaceRoot);
    log(`Mission planner: detected tech stack: ${stack.join(', ') || 'unknown'}`, 'INFO');
    const stackContext = stack.length > 0
      ? `\n[WORKSPACE TECH STACK]: ${stack.join(', ')}\nTailor all task file paths, languages, and implementation approaches to this stack.\n`
      : '';

    const systemPrompt = `You are a mission planning agent. Break the mission into milestones and tasks.
Output ONLY a JSON object.
${memoriesSection}
${projectRules}
${stackContext}

Structure:
{
  "title": "Mission Title",
  "description": "Short overview",
  "milestones": [
    {
      "title": "Milestone Title",
      "description": "Short desc",
      "tasks": [
        {
          "title": "Task Title",
          "description": "Actionable steps",
          "files": ["file/path"],
          "acceptance_criteria": ["criteria 1", "criteria 2"],
          "use_reviewer_model": true,
          "type": "code",
          "depends_on": ["Prerequisite Task Title"]
        }
      ]
    }
  ]
}

Constraints:
1. MAX 3 milestones.
2. MAX 5 tasks per milestone.
3. Keep descriptions very short.
4. Focus on the primary goal first.
5. If a task is particularly complex (e.g. refactoring core logic, multi-file changes), set "use_reviewer_model" to true.
6. Classify each task's "type": "code" (writing code), "config" (changing configs, package.json, env files), or "research" (analysis, reading files, gathering info). Only "code" tasks trigger automated review.
7. No extra text or preamble.
8. STOP when the acceptance criteria are met. Do not add extra polish, build pipelines, or deployment steps unless explicitly requested.
9. **ATOMIC TASKS** — Each task must be atomic with clearly bounded scope. Avoid open-ended descriptions like "multiple shapes" — enumerate specific, discrete deliverables instead (e.g. "Create a SkeletonCircle component" not "Add multiple shapes"). If a requirement implies open-ended work, break it into one task per concrete deliverable.
10. **STRICT BOUNDARIES** — plans MUST NOT include tasks that:
- Generate SSL/TLS certificates, SSH keys, API keys, secrets, or any credentials.
- Run network tools: curl, wget, scp, rsync, ssh, sftp, nc.
- Push to or clone from remote git repositories.
- Install global packages (npm -g, pip --system, yarn global).
- Use sudo, su, chown, or escalate privileges.
- Create Docker, Kubernetes, CI/CD, or deployment infrastructure (unless the user's request explicitly mentions deployment).
- Write files outside the provided workspace directory.
- Use openssl, ssh-keygen, gpg, or any cryptography tooling.

11. A request for a "web app" means: HTML, CSS, and JavaScript files only. Not a build pipeline, not a service worker, not a deployment config — unless explicitly asked.
12. Define task dependencies in the "depends_on" field using the exact titles of prerequisite tasks in the plan. If there are no prerequisites, use an empty array. Design the plan so that file creation, code implementation, test suites, and manual verifications follow a logical sequence.`;

    const plannerModel = config.PLANNER_MODEL || getModel();
    const response = await getOllamaClient().chat.completions.create({
      model: plannerModel,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Please plan a mission for the following request:\n\n<request>\n${description}\n</request>` },
      ],
      temperature: 0.1,
      max_tokens: 4096,
    });

    const message = response.choices[0]?.message as any;
    // Reasoning models (phi-4-mini-reasoning, DeepSeek-R1, Gemma-QAT, etc.)
    // emit their output in `reasoning_content` or `reasoning` with empty `content`.
    let content: string | null | undefined =
      message?.content
      || message?.reasoning_content
      || message?.reasoning;

    logObject('Planner Raw Response', message);

    if (!content) {
      const presentKeys = Object.keys(message ?? {}).join(', ');
      throw new Error(
        `Failed to get response from mission planner — model returned no usable content. ` +
        `Present keys: [${presentKeys}]. Finish reason: ${response.choices[0]?.finish_reason ?? 'unknown'}.`
      );
    }
    content = content as string;

    // Strip reasoning blocks before attempting any JSON parse.
    // Reasoning models (DeepSeek-R1, Qwen-QwQ, etc.) prepend <think>...</think>
    // to their output. extractJsonContent handles both closed and unclosed tags.
    content = extractJsonContent(content);
    log(`Planner content after think-strip (first 120 chars): ${content.slice(0, 120)}`, 'DEBUG');

    let rawPlan;
    // Retry once with a more forceful prompt if the model returns no JSON at all
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        // First attempt already has content; retry must make a new API call
        if (attempt === 1) {
          log('Retrying planner with stronger JSON-only prompt...', 'WARN');
          const retryResponse = await getOllamaClient('planner').chat.completions.create({
            model: plannerModel,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'assistant', content: content },
              { role: 'user', content: `Your previous response was not valid JSON. Output ONLY a raw JSON object, no markdown, no explanation, no thinking tags.\n\nPlease plan a mission for:\n\n${description}` },
            ],
            temperature: 0.1,
            max_tokens: 4096,
          });
          const retryMsg = retryResponse.choices[0]?.message as any;
          content = extractJsonContent(
            (retryMsg?.content || retryMsg?.reasoning_content || retryMsg?.reasoning || content) as string
          );
        }

        try {
          rawPlan = JSON.parse(content);
        } catch (e) {
          log('Initial JSON parse failed, attempting repair...', 'WARN');
          const repaired = repairJson(content);
          if (repaired === null) {
            throw new Error(`Model returned no JSON content. Raw: ${content.slice(0, 100)}...`);
          }
          logObject('Repaired JSON', repaired);
          rawPlan = JSON.parse(repaired);
        }
        break; // success
      } catch (err: any) {
        if (attempt === 1) {
          log(`JSON parse failed after retry: ${err.message}`, 'ERROR');
          throw new Error(`Invalid JSON from model: ${err.message}\nRaw content: ${content.slice(0, 100)}...`);
        }
        log(`JSON parse failed (attempt ${attempt + 1}): ${err.message}`, 'WARN');
      }
    }

    try {
      // Unwrap common model mis-wrappings:
      //   { "plan": { "milestones": [...] } }
      //   { "mission": { "milestones": [...] } }
      //   [ { "milestones": [...] } ]  (array-wrapped)
      if (rawPlan && !Array.isArray(rawPlan.milestones)) {
        const inner = rawPlan.plan ?? rawPlan.mission ?? rawPlan.result ?? rawPlan.output;
        if (inner && Array.isArray(inner.milestones)) {
          rawPlan = inner;
        }
      }

      if (!rawPlan || !Array.isArray(rawPlan.milestones)) {
        throw new Error(
          `Model returned JSON without a "milestones" array. ` +
          `Got top-level keys: [${Object.keys(rawPlan ?? {}).join(', ')}]. ` +
          `Raw (first 200 chars): ${content.slice(0, 200)}`
        );
      }

      // 1. Assign a unique ID to every task and build a mapping of normalized title -> ID
      const taskTitleToIdMap = new Map<string, string>();
      const taskList: any[] = [];

      rawPlan.milestones.forEach((m: any) => {
        if (m.tasks && Array.isArray(m.tasks)) {
          m.tasks.forEach((t: any) => {
            const taskId = uuidv4();
            t.id = taskId;
            taskTitleToIdMap.set(t.title.trim().toLowerCase(), taskId);
            taskList.push(t);
          });
        }
      });

      // 2. Map string dependencies in depends_on to task UUIDs
      rawPlan.milestones.forEach((m: any) => {
        if (m.tasks && Array.isArray(m.tasks)) {
          m.tasks.forEach((t: any) => {
            const resolvedDeps: string[] = [];
            if (t.depends_on && Array.isArray(t.depends_on)) {
              t.depends_on.forEach((depTitle: string) => {
                const depTitleNorm = depTitle.trim().toLowerCase();
                const matchedId = taskTitleToIdMap.get(depTitleNorm);
                if (matchedId) {
                  resolvedDeps.push(matchedId);
                } else {
                  // Fallback: search for a task title that contains or matches closely
                  let found = false;
                  for (const [title, id] of taskTitleToIdMap.entries()) {
                    if (title.includes(depTitleNorm) || depTitleNorm.includes(title)) {
                      resolvedDeps.push(id);
                      found = true;
                      break;
                    }
                  }
                  if (!found) {
                    log(`Warning: Could not resolve dependency "${depTitle}" for task "${t.title}"`, 'WARN');
                  }
                }
              });
            }
            t.depends_on = resolvedDeps;
          });
        }
      });

      // 3. Fallback sequential milestone dependencies: If a task in milestone M > 0 
      // has no resolved dependencies, make it depend on all tasks in milestone M-1.
      for (let i = 1; i < rawPlan.milestones.length; i++) {
        const prevMilestone = rawPlan.milestones[i - 1];
        const currentMilestone = rawPlan.milestones[i];
        const prevMilestoneTaskIds = Array.isArray(prevMilestone.tasks)
          ? prevMilestone.tasks.map((t: any) => t.id)
          : [];

        if (Array.isArray(currentMilestone.tasks)) {
          currentMilestone.tasks.forEach((t: any) => {
            if (!t.depends_on || t.depends_on.length === 0) {
              t.depends_on = [...prevMilestoneTaskIds];
            }
          });
        }
      }

      // Assemble final mission plan
      const planWithIds = {
        ...rawPlan,
        id: uuidv4(),
        status: 'planning',
        workspace_root: workspaceRoot,
        tech_stack: stack.length > 0 ? stack : undefined,
        milestones: rawPlan.milestones.map((m: any) => ({
          ...m,
          id: m.id || uuidv4(),
          description: m.description || m.title || '',
          tasks: Array.isArray(m.tasks) ? m.tasks.map((t: any) => ({
            ...t,
            type: ['code', 'config', 'research', 'unknown'].includes(t.type) ? t.type : 'code',
            status: 'todo',
            depends_on: t.depends_on || [],
          })) : [],
        })),
      };

      return MissionSchema.parse(planWithIds);
    } catch (error: any) {
      log(`Failed to process mission plan: ${error.message}`, 'ERROR');
      throw error;
    }
  }
}
