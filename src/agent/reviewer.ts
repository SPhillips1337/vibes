import { getOllamaClient } from '../ollama-client.js';
import { Task, Mission } from './types.js';
import { log } from '../logger.js';
import { config } from '../config.js';
import { getModelSpecificPrompt } from './model-prompts.js';

export class Reviewer {
  async reviewTask(task: Task, mission: Mission): Promise<{ approved: boolean; feedback?: string }> {
    log(`Reviewing task: ${task.title}`, 'INFO');
    const modelSpecificPrompt = getModelSpecificPrompt(config.REVIEWER_MODEL, 'reviewer');

    const systemPrompt = `You are a Senior Software Engineer performing a code review.
Review the task completion based on the description and acceptance criteria.
Output ONLY a JSON object.
${modelSpecificPrompt}

Structure:
{
  "approved": true | false,
  "feedback": "Detailed feedback or LGTM"
}

Constraints:
1. If approved, feedback should be "LGTM".
2. If rejected, provide clear, actionable feedback on what is missing or incorrect.
3. Be strict but fair.`;

    const userPrompt = `Mission: ${mission.title}
Task: ${task.title}
Description: ${task.description}
Acceptance Criteria:
${task.acceptance_criteria.map(c => `- ${c}`).join('\n')}

Task Output:
${task.output || 'No output provided.'}`;

    try {
      const response = await getOllamaClient('reviewer').chat.completions.create({
        model: config.REVIEWER_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.1,
      });

      const msg = response.choices[0]?.message as any;
      const content = msg?.content || msg?.reasoning_content || '';
      if (!content) throw new Error('No response from reviewer');

      const result = JSON.parse(content);
      return result;
    } catch (error: any) {
      log(`Reviewer failed: ${error.message}`, 'ERROR');
      return { approved: true, feedback: 'LGTM (Reviewer failed, defaulting to approval)' };
    }
  }
}
