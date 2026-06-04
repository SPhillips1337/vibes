import { v4 as uuidv4 } from 'uuid';
import { getOllamaClient, getModel } from '../ollama-client.js';
import { config } from '../config.js';
import { Mission, MissionSchema } from './types.js';
import { logObject, log } from '../logger.js';
import { repairJson } from './json-repair.js';
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
          "type": "code"
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
7. STOP when the acceptance criteria are met. Do not add extra polish, build pipelines, or deployment steps unless explicitly requested.
8. **STRICT BOUNDARIES** — plans MUST NOT include tasks that:
- Generate SSL/TLS certificates, SSH keys, API keys, secrets, or any credentials.
- Run network tools: curl, wget, scp, rsync, ssh, sftp, nc.
- Push to or clone from remote git repositories.
- Install global packages (npm -g, pip --system, yarn global).
- Use sudo, su, chown, or escalate privileges.
- Create Docker, Kubernetes, CI/CD, or deployment infrastructure (unless the user's request explicitly mentions deployment).
- Write files outside the provided workspace directory.
- Use openssl, ssh-keygen, gpg, or any cryptography tooling.

9. A request for a "web app" means: HTML, CSS, and JavaScript files only. Not a build pipeline, not a service worker, not a deployment config — unless explicitly asked.`;

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

    let content = response.choices[0]?.message?.content;
    logObject('Planner Raw Response', content);

    if (!content) {
      throw new Error('Failed to get response from mission planner');
    }

    let rawPlan;
    try {
      rawPlan = JSON.parse(content);
    } catch (e) {
      log('Initial JSON parse failed, attempting repair...', 'WARN');
      try {
        const repaired = repairJson(content);
        logObject('Repaired JSON', repaired);
        rawPlan = JSON.parse(repaired);
      } catch (err: any) {
        log(`JSON Repair failed: ${err.message}`, 'ERROR');
        throw new Error(`Invalid JSON from model: ${err.message}\nRaw content: ${content.slice(0, 100)}...`);
      }
    }

    try {
      // Inject IDs
      const planWithIds = {
        ...rawPlan,
        id: uuidv4(),
        status: 'planning',
        workspace_root: workspaceRoot,
        tech_stack: stack.length > 0 ? stack : undefined,
        milestones: rawPlan.milestones.map((m: any) => ({
          ...m,
          id: uuidv4(),
          description: m.description || m.title || '',
          tasks: m.tasks.map((t: any) => ({
            ...t,
            id: uuidv4(),
            type: ['code', 'config', 'research', 'unknown'].includes(t.type) ? t.type : 'code',
            status: 'todo',
            depends_on: [],
          })),
        })),
      };

      return MissionSchema.parse(planWithIds);
    } catch (error: any) {
      log(`Failed to process mission plan: ${error.message}`, 'ERROR');
      throw error;
    }
  }
}
