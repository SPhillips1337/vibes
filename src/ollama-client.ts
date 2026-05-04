import OpenAI from 'openai';
import { config } from './config.js';

export const ollama = new OpenAI({
  baseURL: config.OLLAMA_BASE_URL,
  apiKey: config.OLLAMA_API_KEY,
});

export const MODEL = config.OLLAMA_MODEL;
export const CONTEXT_WINDOW = config.CONTEXT_WINDOW;
