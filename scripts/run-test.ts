import { MissionPlanner } from '../src/agent/mission-planner.js';
import { TaskExecutor, createDefaultHooks } from '../src/agent/task-executor.js';
import { Scheduler } from '../src/agent/scheduler.js';
import { listDirTool, readFileTool, writeFileTool, globTool, fileOutlineTool, readLinesTool } from '../src/tools/file-tools.js';
import { editFileTool } from '../src/tools/file-edit.js';
import { shellTool } from '../src/tools/shell-tool.js';
import { config } from '../src/config.js';
import { log } from '../src/logger.js';
import { getSessionService } from '../src/agent/session-service.js';

async function main() {
  const description = process.argv[2];
  const workspaceRoot = process.argv[3] || process.cwd();

  if (!description) {
    console.error('Usage: npx tsx scripts/run-test.ts <description> [workspace]');
    process.exit(1);
  }

  const planner = new MissionPlanner();
  const plan = await planner.planMission(description, workspaceRoot);
  log(`Planned mission: ${plan.title} with ${plan.milestones.reduce((a, m) => a + m.tasks.length, 0)} tasks`, 'INFO');

  const { searchSymbolsTool } = await import('../src/tools/index-tools.js');
  const { loadPluginTools } = await import('../src/tools/plugin-loader.js');
  const { getMCPTools } = await import('../src/mcp/index.js');

  const mcpTools = getMCPTools();
  const pluginTools = await loadPluginTools(plan.workspace_root);

  const tools = [
    listDirTool, readFileTool, writeFileTool, editFileTool,
    globTool, shellTool, fileOutlineTool, readLinesTool,
    searchSymbolsTool, ...mcpTools, ...pluginTools,
  ];

  const executor = new TaskExecutor(tools, {
    getYoloMode: () => config.YOLO_MODE,
    hooks: createDefaultHooks(() => config.YOLO_MODE),
  });

  const scheduler = new Scheduler(plan, executor, (event) => {
    if (event.type === 'task_started') log(`Task started: ${event.title}`, 'INFO');
    if (event.type === 'task_completed') log(`Task completed: ${event.title}`, 'INFO');
    if (event.type === 'task_failed') log(`Task failed: ${event.title} - ${event.error}`, 'ERROR');
  }, () => config.YOLO_MODE);

  const completedMission = await scheduler.run();
  
  const sessionService = getSessionService();
  await sessionService.saveSession(completedMission, [], { readFiles: [], modifiedFiles: [] });
  
  console.log('\n=== MISSION COMPLETE ===');
  console.log(`Status: ${completedMission.status}`);
  for (const m of completedMission.milestones) {
    console.log(`\nMilestone: ${m.title}`);
    for (const t of m.tasks) {
      console.log(`  [${t.status === 'done' ? '✓' : t.status === 'failed' ? '✗' : '○'}] ${t.title}`);
      if (t.status === 'failed' && t.error) console.log(`    Error: ${t.error}`);
    }
  }
  
  process.exit(0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
