import { log, logObject } from '../logger.js';
import { ToolResult } from '../agent/types.js';
import fs from 'fs';
import path from 'path';
import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import os from 'os';

export interface MCPServerConfig {
  name: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string; // For SSE support
}

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: any;
}

interface MCPRequest {
  jsonrpc: string;
  id: number;
  method: string;
  params?: any;
}

interface MCPResponse {
  jsonrpc: string;
  id?: number;
  method?: string;
  result?: any;
  error?: any;
}

export class MCPClient extends EventEmitter {
  private process: ChildProcess | null = null;
  private requestId = 0;
  private pendingRequests: Map<number, { resolve: Function; reject: Function }> = new Map();
  private tools: MCPTool[] = [];
  private serverName: string;
  private initialized = false;
  private transport: 'stdio' | 'sse' = 'stdio';
  private sseUrl: string | null = null;
  private postUrl: string | null = null;
  private abortController: AbortController | null = null;
  private fatalError: Error | null = null;

  constructor(config: MCPServerConfig) {
    super();
    this.serverName = config.name;
    this.on('error', () => {}); // Prevent crash from unhandled 'error' events
    if (config.url) {
      this.transport = 'sse';
      this.sseUrl = config.url;
      this.startSSE(config);
    } else if (config.command) {
      this.transport = 'stdio';
      this.startProcess(config);
    }
  }

  private startProcess(config: MCPServerConfig) {
    log(`Starting MCP server: ${config.name}`, 'INFO');

    this.process = spawn(config.command!, config.args || [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...config.env },
    });

    this.process?.stdout?.on('data', (data: Buffer) => {
      this.handleMessage(data.toString());
    });

    this.process?.stderr?.on('data', (data: Buffer) => {
      log(`[MCP ${config.name}] ${data.toString()}`, 'DEBUG');
    });

    this.process?.on('error', (error) => {
      log(`MCP server ${config.name} error: ${error.message}`, 'ERROR');
      this.fatalError = error;
      this.process = null;
    });

    this.process?.on('exit', (code) => {
      log(`MCP server ${config.name} exited with code ${code}`, 'INFO');
      if (code !== 0 && !this.fatalError) {
        this.fatalError = new Error(`Process exited with code ${code}`);
      }
      this.process = null;
    });
  }

  private async startSSE(config: MCPServerConfig) {
    log(`Connecting to MCP SSE server: ${config.name} at ${this.sseUrl}`, 'INFO');
    this.abortController = new AbortController();

    try {
      const response = await fetch(this.sseUrl!, {
        signal: this.abortController.signal,
        headers: { 'Accept': 'text/event-stream' },
      });

      if (!response.ok) {
        throw new Error(`SSE connection failed: ${response.statusText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('Response body is not readable');

      const decoder = new TextDecoder();
      let buffer = '';
      let currentEvent = '';

      // Set initialized to true for SSE once connected
      // but we still need to wait for the postUrl to send requests
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) {
            currentEvent = '';
            continue;
          }

          if (trimmed.startsWith('event: ')) {
            currentEvent = trimmed.slice(7);
          } else if (trimmed.startsWith('data: ')) {
            const data = trimmed.slice(6);
            if (currentEvent === 'endpoint') {
              this.postUrl = data;
              log(`SSE endpoint received for ${this.serverName}: ${this.postUrl}`, 'INFO');
              this.emit('connected');
            } else {
              this.handleMessage(data);
            }
          }
        }
      }
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        log(`SSE error for ${this.serverName}: ${error.message}`, 'ERROR');
        this.fatalError = error;
      }
    }
  }

  private handleMessage(data: string) {
    try {
      const response: MCPResponse = JSON.parse(data);
      
      if (response.id && this.pendingRequests.has(response.id)) {
        const { resolve, reject } = this.pendingRequests.get(response.id)!;
        this.pendingRequests.delete(response.id);
        
        if (response.error) {
          reject(new Error(response.error.message || 'MCP error'));
        } else {
          resolve(response.result);
        }
      } else if (response.method) {
        this.emit('notification', response);
      }
    } catch (e) {
      // Not JSON or parse error, log if not empty
      if (data.trim()) {
        log(`[MCP ${this.serverName} Raw] ${data}`, 'DEBUG');
      }
    }
  }

  private async sendRequest(method: string, params?: any): Promise<any> {
    const id = ++this.requestId;
    const request: MCPRequest = { jsonrpc: '2.0', id, method, params };

    if (this.transport === 'stdio') {
      return new Promise((resolve, reject) => {
        if (!this.process) {
          reject(new Error('MCP process not started'));
          return;
        }

        this.pendingRequests.set(id, { resolve, reject });
        this.process.stdin?.write(JSON.stringify(request) + '\n');

        setTimeout(() => {
          if (this.pendingRequests.has(id)) {
            this.pendingRequests.delete(id);
            reject(new Error(`MCP request ${method} timed out (stdio)`));
          }
        }, 60000); // 60s timeout
      });
    } else {
      // SSE Transport
      if (!this.postUrl) {
        throw new Error('SSE postUrl not yet received from server');
      }

      return new Promise(async (resolve, reject) => {
        this.pendingRequests.set(id, { resolve, reject });
        
        try {
          const response = await fetch(this.postUrl!, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(request),
          });

          if (!response.ok) {
            this.pendingRequests.delete(id);
            const text = await response.text();
            reject(new Error(`SSE POST failed: ${response.statusText} - ${text}`));
            return;
          }

          // In SSE, the response might be 202 Accepted and the actual result comes via the event stream
          // OR it might return the result directly. MCP spec says it should come via SSE stream.
          // So we wait for the result in handleMessage.
        } catch (error: any) {
          this.pendingRequests.delete(id);
          reject(error);
        }

        setTimeout(() => {
          if (this.pendingRequests.has(id)) {
            this.pendingRequests.delete(id);
            reject(new Error(`MCP request ${method} timed out (sse)`));
          }
        }, 60000);
      });
    }
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Short wait for spawn error to surface (e.g. ENOENT)
    await new Promise(r => setTimeout(r, 100));

    if (this.fatalError) {
      throw this.fatalError;
    }

    if (!this.process && this.transport === 'stdio') {
      throw new Error(`MCP process failed to start`);
    }

    try {
      // For SSE, wait until we have the POST endpoint
      if (this.transport === 'sse' && !this.postUrl) {
        log(`Waiting for SSE endpoint for ${this.serverName}...`, 'DEBUG');
        await new Promise<void>((resolve, reject) => {
          const onConnected = () => {
            this.off('error', onError);
            resolve();
          };
          const onError = (err: Error) => {
            this.off('connected', onConnected);
            reject(err);
          };
          this.once('connected', onConnected);
          this.once('error', onError);
          
          // Timeout if no endpoint received
          setTimeout(() => {
            this.off('connected', onConnected);
            this.off('error', onError);
            reject(new Error('SSE connection timeout (no endpoint received)'));
          }, 15000);
        });
      }

      const result = await this.sendRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'vibes', version: '1.0.0' },
      });

      this.initialized = true;
      log(`MCP server ${this.serverName} initialized`, 'INFO');

      await this.listTools();
    } catch (error: any) {
      log(`Failed to initialize MCP server ${this.serverName}: ${error.message}`, 'ERROR');
      throw error;
    }
  }

  async listTools(): Promise<MCPTool[]> {
    try {
      const result = await this.sendRequest('tools/list');
      this.tools = result.tools || [];
      log(`MCP server ${this.serverName} has ${this.tools.length} tools`, 'INFO');
      return this.tools;
    } catch (error: any) {
      log(`Failed to list tools from ${this.serverName}: ${error.message}`, 'ERROR');
      return [];
    }
  }

  async callTool(toolName: string, args: any): Promise<ToolResult> {
    try {
      const result = await this.sendRequest('tools/call', {
        name: toolName,
        arguments: args,
      });

      return { success: true, data: result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  getTools(): MCPTool[] {
    return this.tools;
  }

  getServerName(): string {
    return this.serverName;
  }

  isConnected(): boolean {
    return !this.fatalError && (this.process?.connected || false);
  }

  async shutdown(): Promise<void> {
    try {
      await this.sendRequest('shutdown');
    } catch (e) {
      // Ignore shutdown errors
    }
    
    if (this.transport === 'stdio') {
      this.process?.kill();
      this.process = null;
    } else {
      this.abortController?.abort();
      this.abortController = null;
    }
    this.initialized = false;
    log(`MCP server ${this.serverName} shut down`, 'INFO');
  }
}

export class MCPService {
  private clients: Map<string, MCPClient> = new Map();
  private mcpConfigPaths: string[];

  constructor(mcpConfigPath?: string) {
    if (mcpConfigPath) {
      this.mcpConfigPaths = [mcpConfigPath];
    } else {
      const homeDir = os.homedir();
      this.mcpConfigPaths = [
        path.join(process.cwd(), '.vibes', 'mcp.json'),
        path.join(homeDir, '.vibes', 'mcp.json'),
        path.join(homeDir, '.config', 'vibes', 'mcp.json'),
        // Support standard Claude Desktop config location as a fallback
        path.join(homeDir, '.config', 'Claude', 'config.json'),
      ];
    }
    this.loadServers();
  }

  private expandEnvVars(value: any): any {
    if (typeof value === 'string') {
      return value.replace(/\${([^}]+)}/g, (_, name) => process.env[name] || '');
    }
    if (Array.isArray(value)) {
      return value.map(item => this.expandEnvVars(item));
    }
    if (value && typeof value === 'object') {
      const expanded: any = {};
      for (const [k, v] of Object.entries(value)) {
        expanded[k] = this.expandEnvVars(v);
      }
      return expanded;
    }
    return value;
  }

  private async loadServers() {
    const mergedServers: Record<string, any> = {};

    for (const configPath of this.mcpConfigPaths) {
      if (!fs.existsSync(configPath)) continue;

      try {
        log(`Loading MCP config from: ${configPath}`, 'DEBUG');
        const content = fs.readFileSync(configPath, 'utf-8');
        const rawConfig = JSON.parse(content);
        
        // Handle both Vibes-style { mcpServers: ... } and Claude-style { mcpServers: ... }
        const servers = rawConfig.mcpServers || {};
        Object.assign(mergedServers, servers);
      } catch (error: any) {
        log(`Failed to load MCP config from ${configPath}: ${error.message}`, 'ERROR');
      }
    }

    if (Object.keys(mergedServers).length === 0) {
      log('No MCP servers found in any config location', 'DEBUG');
      return;
    }

    // Expand environment variables in the merged config
    const expandedServers = this.expandEnvVars(mergedServers);

    for (const [name, serverConfig] of Object.entries(expandedServers)) {
      if (this.clients.has(name)) continue; // Already loaded

      const client = new MCPClient({
        name,
        ...serverConfig as any,
      });
      
      try {
        await client.initialize();
        this.clients.set(name, client);
        log(`Connected to MCP server: ${name}`, 'INFO');
      } catch (error: any) {
        log(`Failed to connect to MCP server ${name}: ${error.message}`, 'ERROR');
      }
    }
  }

  getClients(): Map<string, MCPClient> {
    return this.clients;
  }

  getAllTools(): Array<{ server: string; tool: MCPTool }> {
    const allTools: Array<{ server: string; tool: MCPTool }> = [];
    
    for (const [serverName, client] of this.clients) {
      for (const tool of client.getTools()) {
        allTools.push({ server: serverName, tool });
      }
    }

    return allTools;
  }

  async callTool(serverName: string, toolName: string, args: any): Promise<ToolResult> {
    const client = this.clients.get(serverName);
    if (!client) {
      return { success: false, error: `MCP server ${serverName} not found` };
    }

    return client.callTool(toolName, args);
  }

  async shutdownAll(): Promise<void> {
    for (const [name, client] of this.clients) {
      await client.shutdown();
    }
    this.clients.clear();
    log('All MCP servers shut down', 'INFO');
  }
}

let globalMCPService: MCPService | null = null;

export function getMCPService(): MCPService {
  if (!globalMCPService) {
    globalMCPService = new MCPService();
  }
  return globalMCPService;
}