import OpenAI from 'openai';
import { config } from './config.js';

export const ollama = new OpenAI({
  baseURL: config.OLLAMA_BASE_URL,
  apiKey: config.OLLAMA_API_KEY,
  timeout: 120000, // 2 minute timeout
  maxRetries: 2,
});

export const MODEL = config.OLLAMA_MODEL;
export const CONTEXT_WINDOW = config.CONTEXT_WINDOW;

export async function listModels() {
  try {
    const response = await ollama.models.list();
    return response.data.map(m => m.id);
  } catch (error) {
    // Fallback for raw Ollama /api/tags if the OpenAI endpoint isn't available
    try {
      const response = await fetch(`${config.OLLAMA_BASE_URL.replace(/\/v1$/, '')}/api/tags`);
      if (response.ok) {
        const data = await response.json();
        return data.models?.map((m: any) => m.name) || [];
      }
    } catch (e) {
      // Ignore fallback errors
    }
    
    console.error('⚠️ Failed to fetch models:', error instanceof Error ? error.message : String(error));
    return [];
  }
}
