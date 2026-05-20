import { FastMCP } from 'fastmcp';
import { MissionPlanner } from '../agent/mission-planner.js';
import { TaskExecutor } from '../agent/task-executor.js';
import { Scheduler } from '../agent/scheduler.js';
import { listDirTool, readFileTool, writeFileTool, globTool, fileOutlineTool, readLinesTool } from '../tools/file-tools.js';
import { shellTool } from '../tools/shell-tool.js';
import { editFileTool } from '../tools/file-edit.js';
import { log, addLogListener } from '../logger.js';
import { Mission } from '../agent/types.js';

import { z } from 'zod';

// Forward logs to stderr for the dashboard to capture
addLogListener((level, message) => {
  console.error(`[${level}] ${message}`);
});

const mcp = new FastMCP({ name: 'Vibes', version: '1.0.0' });

let currentMission: Mission | null = null;
let currentScheduler: Scheduler | null = null;

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
        if (event.type === 'task_started') {
          console.error(`[TASK_STATUS] {"name": ${JSON.stringify((event as any).title)}, "status": "in-progress"}`);
        } else if (event.type === 'task_completed') {
          console.error(`[TASK_STATUS] {"name": ${JSON.stringify((event as any).title)}, "status": "complete"}`);
        } else if (event.type === 'task_failed') {
          console.error(`[TASK_STATUS] {"name": ${JSON.stringify((event as any).title)}, "status": "failed"}`);
        }
      });
      
      currentScheduler = scheduler;
      const result = await scheduler.run();
      currentScheduler = null;
      currentMission = result;
      
      return `Mission ${result.status}. Completed ${result.milestones.flatMap(m => m.tasks).filter(t => t.status === 'done').length}/${result.milestones.flatMap(m => m.tasks).length} tasks.`;
    } catch (error: any) {
      currentScheduler = null;
      return `Mission failed: ${error.message}`;
    }
  }
});

mcp.addTool({
  name: 'plan_mission',
  description: 'Plan a mission and return the tasks as JSON without executing them.',
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
      
      const flatTasks = plan.milestones.flatMap(m => m.tasks);
      return JSON.stringify(flatTasks.map((t, i) => ({ id: i + 1, name: t.title, status: t.status === 'done' ? 'complete' : 'pending' })));
    } catch (error: any) {
      return `Mission planning failed: ${error.message}`;
    }
  }
});

mcp.addTool({
  name: 'start_execution',
  description: 'Execute the currently planned mission.',
  parameters: z.object({}),
  execute: async () => {
    if (!currentMission) return 'No mission has been planned.';
    try {
      const tools = [
        listDirTool, readFileTool, writeFileTool, editFileTool, 
        globTool, shellTool, fileOutlineTool, readLinesTool
      ];
      const executor = new TaskExecutor(tools);
      
      const scheduler = new Scheduler(currentMission, executor, (event) => {
        log(`[MCP Mission Event] ${event.type}`, 'DEBUG');
        if (event.type === 'task_started') {
          console.error(`[TASK_STATUS] {"name": ${JSON.stringify((event as any).title)}, "status": "in-progress"}`);
        } else if (event.type === 'task_completed') {
          console.error(`[TASK_STATUS] {"name": ${JSON.stringify((event as any).title)}, "status": "complete"}`);
        } else if (event.type === 'task_failed') {
          console.error(`[TASK_STATUS] {"name": ${JSON.stringify((event as any).title)}, "status": "failed"}`);
        }
      });
      
      currentScheduler = scheduler;
      const result = await scheduler.run();
      currentScheduler = null;
      currentMission = result;
      
      return `Mission ${result.status}. Completed ${result.milestones.flatMap(m => m.tasks).filter(t => t.status === 'done').length}/${result.milestones.flatMap(m => m.tasks).length} tasks.`;
    } catch (error: any) {
      currentScheduler = null;
      return `Mission execution failed: ${error.message}`;
    }
  }
});

mcp.addTool({
  name: 'resolve_intervention',
  description: 'Resolve a pending user intervention request.',
  parameters: z.object({
    action: z.enum(['retry', 'skip', 'fail', 'reply']),
    message: z.string().optional(),
    retryFromTaskId: z.string().optional(),
  }),
  execute: async ({ action, message, retryFromTaskId }) => {
    if (!currentScheduler) return 'No active scheduler to resolve intervention for.';
    currentScheduler.resolveIntervention({ action, message, retryFromTaskId } as any);
    return 'Intervention resolved.';
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