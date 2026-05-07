import { log, logObject } from '../logger.js';
import { ToolResult } from '../agent/types.js';
import fs from 'fs';
import path from 'path';
import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';

export interface MCPServerConfig {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
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

  constructor(config: MCPServerConfig) {
    super();
    this.serverName = config.name;
    this.startProcess(config);
  }

  private startProcess(config: MCPServerConfig) {
    log(`Starting MCP server: ${config.name}`, 'INFO');

    this.process = spawn(config.command, config.args || [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...config.env },
    });

    this.process.stdout?.on('data', (data: Buffer) => {
      this.handleMessage(data.toString());
    });

    this.process.stderr?.on('data', (data: Buffer) => {
      log(`[MCP ${config.name}] ${data.toString()}`, 'DEBUG');
    });

    this.process.on('error', (error) => {
      log(`MCP server ${config.name} error: ${error.message}`, 'ERROR');
      this.emit('error', error);
    });

    this.process.on('exit', (code) => {
      log(`MCP server ${config.name} exited with code ${code}`, 'INFO');
      this.emit('exit', code);
    });
  }

  private handleMessage(data: string) {
    const lines = data.split('\n').filter(l => l.trim());
    
    for (const line of lines) {
      try {
        const response: MCPResponse = JSON.parse(line);
        
        if (response.id && this.pendingRequests.has(response.id)) {
          const { resolve, reject } = this.pendingRequests.get(response.id)!;
          this.pendingRequests.delete(response.id);
          
          if (response.error) {
            reject(new Error(response.error.message || 'MCP error'));
          } else {
            resolve(response.result);
          }
        } else if (response.method?.startsWith('notifications/') || response.method?.startsWith('tool/')) {
          this.emit('notification', response);
        }
      } catch (e) {
        // Not JSON, ignore
      }
    }
  }

  private async sendRequest(method: string, params?: any): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.process?.connected) {
        reject(new Error('MCP process not connected'));
        return;
      }

      const id = ++this.requestId;
      const request: MCPRequest = { jsonrpc: '2.0', id, method, params };

      this.pendingRequests.set(id, { resolve, reject });

      this.process.stdin?.write(JSON.stringify(request) + '\n');

      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`MCP request ${method} timed out`));
        }
      }, 30000);
    });
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
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
    return this.process?.connected || false;
  }

  async shutdown(): Promise<void> {
    try {
      await this.sendRequest('shutdown');
    } catch (e) {
      // Ignore shutdown errors
    }
    
    this.process?.kill();
    this.process = null;
    this.initialized = false;
    log(`MCP server ${this.serverName} shut down`, 'INFO');
  }
}

export class MCPService {
  private clients: Map<string, MCPClient> = new Map();
  private mcpConfigPath: string;

  constructor(mcpConfigPath?: string) {
    this.mcpConfigPath = mcpConfigPath || path.join(process.cwd(), '.vibes', 'mcp.json');
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
    if (!fs.existsSync(this.mcpConfigPath)) {
      log(`MCP config not found: ${this.mcpConfigPath}`, 'DEBUG');
      return;
    }

    try {
      const content = fs.readFileSync(this.mcpConfigPath, 'utf-8');
      const rawConfig = JSON.parse(content);
      
      // Expand environment variables in the config (e.g. ${GITHUB_TOKEN})
      const config = this.expandEnvVars(rawConfig);

      if (config.mcpServers && typeof config.mcpServers === 'object') {
        for (const [name, serverConfig] of Object.entries(config.mcpServers)) {
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
    } catch (error: any) {
      log(`Failed to load MCP config: ${error.message}`, 'ERROR');
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