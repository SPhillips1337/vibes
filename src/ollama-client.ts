import OpenAI from 'openai';
import { config } from './config.js';
import { log } from './logger.js';

export const getModel = () => config.OLLAMA_MODEL;
export const getContextWindow = () => config.CONTEXT_WINDOW;
export const getOllamaClient = () => new OpenAI({
  baseURL: config.OLLAMA_BASE_URL,
  apiKey: config.OLLAMA_API_KEY,
  timeout: 120000, // 2 minute timeout
  maxRetries: 2,
});

export async function listModels() {
  try {
    const response = await getOllamaClient().models.list();
    return response.data.map(m => m.id);
  } catch (error: any) {
    // Better error logging for connection issues
    if (error.code === 'ECONNREFUSED' || error.name === 'ConnectTimeoutError') {
      log(`❌ Connection failed to ${config.OLLAMA_BASE_URL}: ${error.message}`, 'ERROR');
    }
    
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
    
    log(`⚠️ Failed to fetch models from ${config.OLLAMA_BASE_URL}: ${error instanceof Error ? error.message : String(error)}`, 'DEBUG');
    return [];
  }
}

export async function testConnection(): Promise<{ success: boolean; message: string }> {
  try {
    const start = Date.now();
    await getOllamaClient().models.list();
    const duration = Date.now() - start;
    return { success: true, message: `Connected successfully (${duration}ms)` };
  } catch (error: any) {
    let msg = error.message;
    if (error.code === 'ECONNREFUSED') msg = 'Connection refused. Is the server running?';
    if (error.name === 'ConnectTimeoutError') msg = 'Connection timed out. Check your firewall/network.';
    return { success: false, message: msg };
  }
}
