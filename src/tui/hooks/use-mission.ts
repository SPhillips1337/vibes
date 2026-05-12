import { useState, useCallback, useRef, useEffect } from 'react';
import { Mission, ExecutionEvent } from '../../agent/types.js';
import { MissionPlanner } from '../../agent/mission-planner.js';
import { TaskExecutor } from '../../agent/task-executor.js';
import { Scheduler, InterventionResolution } from '../../agent/scheduler.js';
import { listDirTool, readFileTool, writeFileTool, globTool, fileOutlineTool, readLinesTool } from '../../tools/file-tools.js';
import { shellTool } from '../../tools/shell-tool.js';
import { editFileTool } from '../../tools/file-edit.js';
import { log, addLogListener, removeLogListener } from '../../logger.js';
import { config } from '../../config.js';
import { getMCPService } from '../../mcp/mcp-service.js';
import { getSessionService, SessionData } from '../../agent/session-service.js';

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
  const [sessions, setSessions] = useState<SessionData[]>([]);

  // Hold a direct ref to the running scheduler so we can resolve interventions on it
  const schedulerRef = useRef<Scheduler | null>(null);
  const isYoloRef = useRef(false);
  const sessionService = getSessionService();

  // Load past sessions on mount
  useState(() => {
    sessionService.listSessions().then(setSessions);
  });

  // System Log Stream Integration
  useEffect(() => {
    const listener = (level: any, message: string, timestamp: string) => {
      setEvents(prev => [...prev, { type: 'system_log', level, message, timestamp }]);
    };
    addLogListener(listener);
    return () => removeLogListener(listener);
  }, []);

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
    
    // Auto-Git Snapshot Hack: Create a pre-mission snapshot for "Time Travel" / Undo
    try {
      const { execSync } = await import('child_process');
      const isGit = execSync('git rev-parse --is-inside-work-tree', { cwd: plan.workspace_root }).toString().trim() === 'true';
      if (isGit) {
        log(`Creating pre-mission git snapshot for ${plan.id}`, 'INFO');
        execSync(`git commit -am "vibes: pre-mission snapshot ${plan.id}" --allow-empty`, { cwd: plan.workspace_root });
      }
    } catch (err) {
      log(`Git snapshot skipped: ${err instanceof Error ? err.message : String(err)}`, 'DEBUG');
    }

    try {
      const { searchSymbolsTool } = await import('../../tools/index-tools.js');
      const { loadPluginTools } = await import('../../tools/plugin-loader.js');
      const { getMCPTools } = await import('../../mcp/index.js');
      
      const mcpTools = getMCPTools();
      const pluginTools = await loadPluginTools(plan.workspace_root);

      const tools = [
        listDirTool, 
        readFileTool, 
        writeFileTool, 
        editFileTool, 
        globTool, 
        shellTool,
        fileOutlineTool,
        readLinesTool,
        searchSymbolsTool,
        ...mcpTools,
        ...pluginTools
      ];
      const executor = new TaskExecutor(tools);

      const onEvent = (event: ExecutionEvent) => {
        if (event.type === 'context_update') {
          setContextUsage({ used: event.used, total: event.total, percentage: event.percentage });
        }
        if (event.type === 'intervention_required') {
          setPendingIntervention({ taskId: event.taskId, error: event.error, question: event.question });
        }
        if (event.type === 'steps_updated') {
          setActiveMaxSteps(config.MAX_STEPS + event.extraSteps);
        }
        
        setEvents(prev => {
          const newEvents = [...prev, event];
          
          if (schedulerRef.current) {
            const currentMission = { ...schedulerRef.current['mission'] };
            setMission(currentMission);
            // Auto-save on every event with latest events array
            sessionService.saveSession(currentMission, newEvents).then(() => {
              sessionService.listSessions().then(setSessions);
            });
          }
          
          return newEvents;
        });
      };

      const scheduler = new Scheduler(plan, executor, onEvent, () => isYoloRef.current);
      schedulerRef.current = scheduler;

      // Dynamic Proxy Handshake: Prime the proxy with task context
      try {
        const mcpService = getMCPService();
        const proxyClient = mcpService.getClients().get('dynamic-proxy');
        if (proxyClient) {
          log('Priming Dynamic MCP Proxy...', 'INFO');
          await proxyClient.callTool('proxy_handshake', {
            tech_stack: ['typescript', 'node', 'react', 'ink'],
            task_description: plan.description
          });
        }
      } catch (err) {
        log(`Proxy handshake failed: ${err instanceof Error ? err.message : String(err)}`, 'DEBUG');
      }

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

  const resetMission = useCallback(() => {
    setMission(null);
    setPendingMission(null);
    setIsPlanning(false);
    setIsExecuting(false);
    setError(null);
    setEvents([]);
    setContextUsage(null);
    setPendingIntervention(null);
    setActiveMaxSteps(config.MAX_STEPS);
  }, []);

  const loadSession = useCallback((session: SessionData) => {
    setMission(session.mission);
    setEvents(session.events);
    setError(null);
    setPendingMission(null);
    setPendingIntervention(null);
    setIsPlanning(false);
    setIsExecuting(false);
  }, []);

  const deleteSession = useCallback(async (id: string) => {
    await sessionService.deleteSession(id);
    const updated = await sessionService.listSessions();
    setSessions(updated);
  }, []);

  const undoMission = useCallback(async () => {
    if (!mission) return;
    try {
      const { execSync } = await import('child_process');
      log(`Undoing mission ${mission.id} via git reset`, 'WARN');
      execSync(`git reset --hard HEAD~1`, { cwd: mission.workspace_root });
      resetMission();
    } catch (err: any) {
      setError(`Undo failed: ${err.message}`);
    }
  }, [mission, resetMission]);

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
    sessions,
    startMission,
    approveMission,
    rejectMission,
    resolveIntervention,
    toggleYoloMode,
    resetMission,
    undoMission,
    loadSession,
    deleteSession,
  };
};
