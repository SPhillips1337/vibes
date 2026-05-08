import { FastMCP } from 'fastmcp';
import { MissionPlanner } from '../agent/mission-planner.js';
import { TaskExecutor } from '../agent/task-executor.js';
import { Scheduler } from '../agent/scheduler.js';
import { listDirTool, readFileTool, writeFileTool, globTool, fileOutlineTool, readLinesTool } from '../tools/file-tools.js';
import { shellTool } from '../tools/shell-tool.js';
import { editFileTool } from '../tools/file-edit.js';
import { log } from '../logger.js';
import { Mission } from '../agent/types.js';

import { z } from 'zod';

const mcp = new FastMCP({ name: 'Vibes', version: '1.0.0' });

let currentMission: Mission | null = null;

mcp.addTool({
  name: 'execute_mission',
  description: 'Plan and execute a mission in the current workspace.',
  parameters: z.object({
    description: z.string().describe('The mission description or task to perform.'),
    workspace_root: z.string().optional().describe('Absolute path to the workspace root.'),
  }),
  execute: async ({ description, workspace_root }) => {
    try {
      const root = workspace_root || process.cwd();
      const planner = new MissionPlanner();
      const plan = await planner.planMission(description, root);
      
      currentMission = plan;
      
      const tools = [
        listDirTool, readFileTool, writeFileTool, editFileTool, 
        globTool, shellTool, fileOutlineTool, readLinesTool
      ];
      const executor = new TaskExecutor(tools);
      
      const scheduler = new Scheduler(plan, executor, (event) => {
        log(`[MCP Mission Event] ${event.type}`, 'DEBUG');
      });
      
      const result = await scheduler.run();
      currentMission = result;
      
      return `Mission ${result.status}. Completed ${result.milestones.flatMap(m => m.tasks).filter(t => t.status === 'done').length}/${result.milestones.flatMap(m => m.tasks).length} tasks.`;
    } catch (error: any) {
      return `Mission failed: ${error.message}`;
    }
  }
});

mcp.addTool({
  name: 'query_status',
  description: 'Query the status of the current or last mission.',
  parameters: z.object({}),
  execute: async () => {
    if (!currentMission) return 'No mission in progress.';
    
    const progress = currentMission.milestones.map(m => {
      const done = m.tasks.filter(t => t.status === 'done').length;
      return `${m.title}: ${done}/${m.tasks.length}`;
    }).join(', ');

    return `Mission: ${currentMission.title}\nStatus: ${currentMission.status}\nProgress: ${progress}`;
  }
});

mcp.start();