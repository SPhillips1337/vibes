import { getOllamaClient, getModel } from '../ollama-client.js';
import { Task, Mission } from './types.js';
import { log } from '../logger.js';

export class InterventionManager {
  async formulateInterventionQuestion(task: Task, mission: Mission, error: string): Promise<string> {
    log(`Formulating intervention question for task: ${task.title}`, 'DEBUG');

    const prompt = `You are an autonomous coding agent. One of your tasks has failed, and you need to ask the user for help.
    
Mission: ${mission.title}
Task: ${task.title}
Task Description: ${task.description}
Error: ${error}

Your Goal: Briefly explain what went wrong and ask a CLEAR question to the user so they can decide how to proceed (e.g. should you skip this, try a different approach, or did they manually fix something?).

Output ONLY the question text for the user. Keep it friendly and concise.`;

    try {
      const response = await getOllamaClient().chat.completions.create({
        model: getModel(),
        messages: [
          { role: 'system', content: prompt },
          { role: 'user', content: 'Formulate the question.' }
        ],
        temperature: 0.7,
      }, { timeout: 10000 }); // 10s timeout

      const msg = response.choices[0]?.message as any;
      return msg?.content || msg?.reasoning_content || `The task "${task.title}" failed with error: ${error}. How would you like to proceed?`;
    } catch (err: any) {
      log(`Failed to formulate intervention question: ${err.message}`, 'ERROR');
      return `The task "${task.title}" failed with error: ${error}. How would you like to proceed?`;
    }
  }
}
