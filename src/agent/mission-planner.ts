import { v4 as uuidv4 } from 'uuid';
import { ollama, MODEL } from '../ollama-client.js';
import { Mission, MissionSchema } from './types.js';
import { logObject, log } from '../logger.js';
import { repairJson } from './json-repair.js';

export class MissionPlanner {
  async planMission(description: string, workspaceRoot: string = process.cwd()): Promise<Mission> {
    log(`Planning mission: ${description}`, 'INFO');
    const systemPrompt = `You are a mission planning agent. Break the mission into milestones and tasks.
Output ONLY a JSON object.

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
          "acceptance_criteria": ["criteria 1", "criteria 2"]
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
5. No extra text or preamble.`;

    const response = await ollama.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: description },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1,
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
        milestones: rawPlan.milestones.map((m: any) => ({
          ...m,
          id: uuidv4(),
          tasks: m.tasks.map((t: any) => ({
            ...t,
            id: uuidv4(),
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
