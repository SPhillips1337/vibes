import { useState, useCallback, useRef } from 'react';
import { Mission, ExecutionEvent } from '../../agent/types.js';
import { MissionPlanner } from '../../agent/mission-planner.js';
import { TaskExecutor } from '../../agent/task-executor.js';
import { Scheduler, InterventionResolution } from '../../agent/scheduler.js';
import { listDirTool, readFileTool, writeFileTool, globTool } from '../../tools/file-tools.js';
import { shellTool } from '../../tools/shell-tool.js';
import { editFileTool } from '../../tools/file-edit.js';
import { config } from '../../config.js';

export const useMission = () => {
  const [mission, setMission] = useState<Mission | null>(null);
  const [pendingMission, setPendingMission] = useState<Mission | null>(null);
  const [isPlanning, setIsPlanning] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<ExecutionEvent[]>([]);
  const [contextUsage, setContextUsage] = useState<{ used: number; total: number; percentage: number } | null>(null);
  const [pendingIntervention, setPendingIntervention] = useState<{ taskId: string; error: string; question: string } | null>(null);
  const [activeMaxSteps, setActiveMaxSteps] = useState(config.MAX_STEPS);
  const [isYoloMode, setIsYoloMode] = useState(false);

  // Hold a direct ref to the running scheduler so we can resolve interventions on it
  const schedulerRef = useRef<Scheduler | null>(null);
  const isYoloRef = useRef(false);

  const toggleYoloMode = useCallback(() => {
    setIsYoloMode(prev => {
      const newVal = !prev;
      isYoloRef.current = newVal;
      return newVal;
    });
  }, []);

  const startMission = useCallback(async (description: string, workspaceRoot: string = process.cwd()) => {
    setIsPlanning(true);
    setError(null);
    setEvents([]);
    setContextUsage(null);
    setPendingMission(null);
    setPendingIntervention(null);
    setActiveMaxSteps(config.MAX_STEPS);
    try {
      const planner = new MissionPlanner();
      const plan = await planner.planMission(description, workspaceRoot);
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
        if (event.type === 'intervention_required') {
          setPendingIntervention({ taskId: event.taskId, error: event.error, question: event.question });
        }
        if (event.type === 'steps_updated') {
          // Update the displayed max steps in the footer
          setActiveMaxSteps(config.MAX_STEPS + event.extraSteps);
        }
        setEvents(prev => [...prev, event]);
        // Keep mission state in sync with scheduler's internal state
        if (schedulerRef.current) {
          setMission({ ...schedulerRef.current['mission'] });
        }
      };

      const scheduler = new Scheduler(plan, executor, onEvent, () => isYoloRef.current);
      schedulerRef.current = scheduler;
      const completedMission = await scheduler.run();
      setMission({ ...completedMission });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsExecuting(false);
      setPendingIntervention(null);
      schedulerRef.current = null;
    }
  }, [pendingMission]);

  /**
   * Called by the UI — passes resolution DIRECTLY to the running scheduler.
   * No React state mutation needed for the task; the scheduler owns the task objects.
   */
  const resolveIntervention = useCallback((action: InterventionResolution['action'], message?: string) => {
    setPendingIntervention(null);
    if (schedulerRef.current) {
      schedulerRef.current.resolveIntervention({ action, message });
    }
  }, []);

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
    pendingIntervention,
    activeMaxSteps,
    isYoloMode,
    startMission,
    approveMission,
    rejectMission,
    resolveIntervention,
    toggleYoloMode,
  };
};
