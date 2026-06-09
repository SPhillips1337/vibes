import OpenAI from 'openai';
import { config } from './config.js';
import { log } from './logger.js';
import fetch from 'node-fetch';
import HttpAgent from 'agentkeepalive';

const HttpKeepAliveAgent = HttpAgent;
const HttpsKeepAliveAgent = HttpAgent.HttpsAgent;

/**
 * Custom HTTP/HTTPS agents allowing up to 4 concurrent TCP connections.
 * The OpenAI SDK creates a single shared agentkeepalive agent internally;
 * by providing our own via a custom `fetch` function we ensure concurrent
 * inference requests open separate connections instead of sharing one.
 */
const httpAgent = new HttpKeepAliveAgent({
  keepAlive: true,
  maxSockets: 4,
  timeout: 5 * 60 * 1000,
});
const httpsAgent = new HttpsKeepAliveAgent({
  keepAlive: true,
  maxSockets: 4,
  timeout: 5 * 60 * 1000,
});

export const getModel = () => config.OLLAMA_MODEL;
export const getContextWindow = () => config.CONTEXT_WINDOW;

let cachedClient: OpenAI | null = null;
let cachedBaseUrl = '';
let cachedApiKey = '';

export const getOllamaClient = (): OpenAI => {
  if (cachedClient && cachedBaseUrl === config.OLLAMA_BASE_URL && cachedApiKey === config.OLLAMA_API_KEY) {
    return cachedClient;
  }

  cachedBaseUrl = config.OLLAMA_BASE_URL;
  cachedApiKey = config.OLLAMA_API_KEY;
  cachedClient = new OpenAI({
    baseURL: config.OLLAMA_BASE_URL,
    apiKey: config.OLLAMA_API_KEY,
    timeout: 120000, // 2 minute timeout
    maxRetries: 2,
    fetch: (url, init) => {
      const agent = String(url).startsWith('https') ? httpsAgent : httpAgent;
      return fetch(url, { ...init, agent });
    },
  });

  return cachedClient;
};

export function formatModelProviderError(error: unknown): string {
  const rawMessage = error instanceof Error ? error.message : String(error);
  const normalized = rawMessage.toLowerCase();

  if (
    normalized.includes('speculativedecoding capability gap')
    || normalized.includes('predictions do not support native draft-model speculative decoding')
  ) {
    return [
      'Model server configuration error: speculative decoding is enabled with a native draft model,',
      'but this prediction protocol does not support it.',
      'Disable the Draft Model / Speculative Decoding setting for the loaded model in LM Studio,',
      'or switch to a compatible engine/runtime, then retry.',
    ].join(' ');
  }

  return rawMessage;
}

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
