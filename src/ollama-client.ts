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

const clientCache = new Map<string, OpenAI>();

export const getOllamaClient = (role: 'main' | 'planner' | 'reviewer' | 'triage' = 'main'): OpenAI => {
  let baseUrl = config.OLLAMA_BASE_URL;
  let apiKey = config.OLLAMA_API_KEY;

  if (role === 'planner' && config.PLANNER_BASE_URL) {
    baseUrl = config.PLANNER_BASE_URL;
    apiKey = config.PLANNER_API_KEY || apiKey;
  } else if (role === 'reviewer' && config.REVIEWER_BASE_URL) {
    baseUrl = config.REVIEWER_BASE_URL;
    apiKey = config.REVIEWER_API_KEY || apiKey;
  } else if (role === 'triage' && config.TRIAGE_BASE_URL) {
    baseUrl = config.TRIAGE_BASE_URL;
    apiKey = config.TRIAGE_API_KEY || apiKey;
  }

  const cacheKey = `${baseUrl}|${apiKey}`;
  
  if (clientCache.has(cacheKey)) {
    return clientCache.get(cacheKey)!;
  }

  const newClient = new OpenAI({
    baseURL: baseUrl,
    apiKey: apiKey,
    timeout: 120000, // 2 minute timeout
    maxRetries: 2,
    fetch: (url, init) => {
      const agent = String(url).startsWith('https') ? httpsAgent : httpAgent;
      return fetch(url, { ...init, agent });
    },
  });

  clientCache.set(cacheKey, newClient);
  return newClient;
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

export async function listModels(customBaseUrl?: string, customApiKey?: string) {
  try {
    const baseUrl = customBaseUrl || config.OLLAMA_BASE_URL;
    const apiKey = customApiKey || config.OLLAMA_API_KEY;
    
    // Quick cache client generation for listing
    const tempClient = new OpenAI({
      baseURL: baseUrl,
      apiKey: apiKey,
      timeout: 10000,
      fetch: (url, init) => {
        const agent = String(url).startsWith('https') ? httpsAgent : httpAgent;
        return fetch(url, { ...init, agent });
      },
    });

    const response = await tempClient.models.list();
    return response.data.map(m => m.id);
  } catch (error: any) {
    const baseUrl = customBaseUrl || config.OLLAMA_BASE_URL;
    
    if (error.code === 'ECONNREFUSED' || error.name === 'ConnectTimeoutError') {
      log(`❌ Connection failed to ${baseUrl}: ${error.message}`, 'ERROR');
    }
    
    try {
      const response = await fetch(`${baseUrl.replace(/\/v1$/, '')}/api/tags`);
      if (response.ok) {
        const data = await response.json();
        return data.models?.map((m: any) => m.name) || [];
      }
    } catch (e) {
      // Ignore fallback errors
    }
    
    log(`⚠️ Failed to fetch models from ${baseUrl}: ${error instanceof Error ? error.message : String(error)}`, 'DEBUG');
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
