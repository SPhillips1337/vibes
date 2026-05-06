import { useState, useCallback } from 'react';
import { Mission, Task, Milestone, ExecutionEvent } from '../../agent/types.js';
import { MissionPlanner } from '../../agent/mission-planner.js';
import { TaskExecutor } from '../../agent/task-executor.js';
import { Scheduler } from '../../agent/scheduler.js';
import { listDirTool, readFileTool, writeFileTool, globTool } from '../../tools/file-tools.js';
import { shellTool } from '../../tools/shell-tool.js';
import { editFileTool } from '../../tools/file-edit.js';

export const useMission = () => {
  const [mission, setMission] = useState<Mission | null>(null);
  const [pendingMission, setPendingMission] = useState<Mission | null>(null); // awaiting approval
  const [isPlanning, setIsPlanning] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<ExecutionEvent[]>([]);
  const [contextUsage, setContextUsage] = useState<{ used: number; total: number; percentage: number } | null>(null);

  const startMission = useCallback(async (description: string, workspaceRoot: string = process.cwd()) => {
    setIsPlanning(true);
    setError(null);
    setEvents([]);
    setContextUsage(null);
    setPendingMission(null);
    try {
      const planner = new MissionPlanner();
      const plan = await planner.planMission(description, workspaceRoot);
      // Don't execute yet — present plan for approval
      setPendingMission(plan);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsPlanning(false);
    }
  }, []);

  const approveMission = useCallback(async () => {
    if (!pendingMission) return;
    const plan = pendingMission;
    setPendingMission(null);
    setMission(plan);
    setIsExecuting(true);

    try {
      const tools = [listDirTool, readFileTool, writeFileTool, editFileTool, globTool, shellTool];
      const executor = new TaskExecutor(tools);

      const onEvent = (event: ExecutionEvent) => {
        if (event.type === 'context_update') {
          setContextUsage({ used: event.used, total: event.total, percentage: event.percentage });
        }
        setEvents(prev => [...prev, event]);
      };

      const scheduler = new Scheduler(plan, executor, onEvent);
      const completedMission = await scheduler.run();
      setMission({ ...completedMission });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsExecuting(false);
    }
  }, [pendingMission]);

  const rejectMission = useCallback(() => {
    setPendingMission(null);
    setError(null);
  }, []);

  return {
    mission,
    pendingMission,
    isPlanning,
    isExecuting,
    error,
    events,
    contextUsage,
    startMission,
    approveMission,
    rejectMission,
  };
};
