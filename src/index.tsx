import React from 'react';
import { render, Box, Text, useInput, useApp } from 'ink';
import { TextInput } from '@inkjs/ui';
import { useMission } from './tui/hooks/use-mission.js';
import { useUpdateCheck } from './tui/hooks/use-update-check.js';
import { useSettings } from './tui/hooks/use-settings.js';
import { Dashboard } from './tui/components/dashboard.js';
import { MissionView } from './tui/components/mission-view.js';
import { TaskView } from './tui/components/task-view.js';
import { SettingsView } from './tui/components/settings-view.js';
import { ApprovalView } from './tui/components/approval-view.js';
import { InterventionView } from './tui/components/intervention-view.js';
import { UpdateNotification } from './tui/components/update-notification.js';
import { initLogger } from './logger.js';
import path from 'path';

const App = () => {
  const {
    mission, pendingMission, isPlanning, isExecuting,
    error, events, contextUsage, pendingIntervention, activeMaxSteps,
    isYoloMode, toggleYoloMode, sessions,
    startMission, approveMission, rejectMission, resolveIntervention, resetMission, undoMission,
    loadSession, deleteSession,
  } = useMission();

  const { exit } = useApp();
  const {
    updateInfo, status: updateStatus, error: updateError,
    dismissed: updateDismissed, updateLog,
    performUpdate, dismiss: dismissUpdate, resetStatus: resetUpdateStatus,
  } = useUpdateCheck();

  const { settings, availableModels, saveSettings } = useSettings();

  const [workspace, setWorkspace] = React.useState(process.env.VIBES_LAUNCH_DIR || process.cwd());
  const [view, setView] = React.useState<'dashboard' | 'mission' | 'task' | 'settings' | 'history'>('dashboard');
  const [focusIndex, setFocusIndex] = React.useState(0);

  const isIdle = !mission && !isPlanning && !pendingMission;

  useInput((input, key) => {
    if (key.ctrl && input === 'q') exit();

    // Update notification keys (priority, use Alt to avoid typing conflict)
    if (key.meta && input === 'u' && updateInfo?.available && !updateDismissed && updateStatus === 'idle') {
      performUpdate();
      return;
    }
    if (key.meta && input === 'x' && updateInfo?.available && !updateDismissed) {
      dismissUpdate();
      return;
    }

    // Suppress other global shortcuts while typing in a text field
    const isTyping = isIdle && view === 'dashboard'; 
    if (isTyping) {
      if (key.tab) setFocusIndex(prev => (prev === 0 ? 1 : 0));
      return; 
    }

    if (view === 'history') {
      if (key.upArrow) setFocusIndex(prev => Math.max(2, prev - 1));
      if (key.downArrow) setFocusIndex(prev => Math.min(sessions.length + 1, prev + 1));
      if (key.return) {
        const session = sessions[focusIndex - 2];
        if (session) {
          loadSession(session);
          setView('mission');
        }
      }
      if (key.delete || key.backspace) {
        const session = sessions[focusIndex - 2];
        if (session) deleteSession(session.mission.id);
      }
      return;
    }

    // Suppress nav/toggle keys while modal views or update process are active
    if (pendingMission || pendingIntervention || updateStatus === 'updating') return;

    if (key.meta) {
      if (input === 'd') { setView('dashboard'); return; }
      if (input === 'm') { setView('mission'); return; }
      if (input === 't') { setView('task'); return; }
      if (input === 's') { setView(prev => prev === 'settings' ? 'dashboard' : 'settings'); return; }
      if (input === 'h') { setView(prev => prev === 'history' ? 'dashboard' : 'history'); return; }
      if (input === 'y') { toggleYoloMode(); return; }
      if (input === 'n') {
        resetMission();
        setView('dashboard');
        setFocusIndex(1);
        return;
      }
      if (input === 'z') {
        undoMission();
        setView('dashboard');
        return;
      }
    }
  });

  const handleSubmit = (val: string) => {
    if (val.trim()) {
      const absolutePath = path.isAbsolute(workspace)
        ? workspace
        : path.resolve(process.cwd(), workspace);
      startMission(val, absolutePath);
    }
  };

  const contextKB = Math.round(settings.CONTEXT_WINDOW / 1024);

  return (
    <Box flexDirection="column" padding={1}>
      {/* Header */}
      <Box justifyContent="space-between" borderStyle="round" borderColor="blue" paddingX={1}>
        <Text bold color="cyan">VIBES TUI</Text>
        <Box gap={2}>
          {!pendingMission && !pendingIntervention && !isIdle && (
            <>
              <Text color={view === 'dashboard' ? 'white' : 'blue'}>[Alt+D] Dash</Text>
              <Text color={view === 'mission' ? 'white' : 'blue'}>[Alt+M] Mission</Text>
              <Text color={view === 'task' ? 'white' : 'blue'}>[Alt+T] Task</Text>
              <Text color={view === 'settings' ? 'white' : 'blue'}>[Alt+S] Settings</Text>
              <Text color="green">[Alt+N] New</Text>
              <Text color="red">[Alt+Z] Undo</Text>
              <Text color={isYoloMode ? 'yellow' : 'blue'} bold={isYoloMode}>[Alt+Y] YOLO</Text>
            </>
          )}
          {isIdle && (
            <>
              <Text color={view === 'history' ? 'white' : 'blue'}>[Alt+H] History</Text>
              <Text color={view === 'settings' ? 'white' : 'blue'}>[Alt+S] Settings</Text>
            </>
          )}
          <Text color="red">[Ctrl+Q] Quit</Text>
        </Box>
      </Box>

      {isYoloMode && (
        <Box justifyContent="center" borderStyle="single" borderColor="yellow" paddingX={1} marginTop={1}>
          <Text color="yellow" bold inverse> ⚡ YOLO MODE ENABLED — NO STEP LIMITS ⚡ </Text>
        </Box>
      )}

      {/* Update Notification */}
      <UpdateNotification
        updateInfo={updateInfo}
        status={updateStatus}
        error={updateError}
        dismissed={updateDismissed}
        updateLog={updateLog}
        onUpdate={performUpdate}
        onDismiss={dismissUpdate}
        onReset={resetUpdateStatus}
      />

      {/* Main Content */}
      <Box flexDirection="column" minHeight={15} marginTop={1}>
        {error && (
          <Box borderStyle="single" borderColor="red" paddingX={1} marginBottom={1} flexDirection="column">
            <Text color="red" bold>Error Detected:</Text>
            <Text color="red">{error.length > 500 ? error.slice(0, 500) + '...' : error}</Text>
            <Box marginTop={1}>
              <Text color="gray" dimColor>The model may have produced malformed output. Try a more specific description.</Text>
            </Box>
          </Box>
        )}

        {/* Modals — rendered in place of everything else */}
        {pendingMission && (
          <ApprovalView
            mission={pendingMission}
            onApprove={approveMission}
            onReject={rejectMission}
          />
        )}

        {pendingIntervention && (
          <InterventionView
            taskId={pendingIntervention.taskId}
            error={pendingIntervention.error}
            question={pendingIntervention.question}
            onResolve={resolveIntervention}
          />
        )}

        {view === 'settings' && (
          <SettingsView
            settings={settings}
            availableModels={availableModels}
            onSave={saveSettings}
            onClose={() => setView('dashboard')}
          />
        )}

        {!pendingMission && !pendingIntervention && view === 'dashboard' && (
          <Dashboard
            mission={mission}
            isPlanning={isPlanning}
            isExecuting={isExecuting}
            isYoloMode={isYoloMode}
            contextUsage={contextUsage}
          />
        )}

        {!pendingMission && !pendingIntervention && view === 'mission' && mission && (
          <MissionView mission={mission} />
        )}

        {!pendingMission && !pendingIntervention && view === 'task' && (
          <TaskView events={events} isExecuting={isExecuting} />
        )}

        {view === 'history' && (
          <Box flexDirection="column" borderStyle="round" borderColor="magenta" padding={1}>
            <Text bold color="magenta">Mission History</Text>
            {sessions.length === 0 ? (
              <Text color="gray">No past sessions found.</Text>
            ) : (
              <Box flexDirection="column" marginTop={1}>
                {sessions.map((session, idx) => (
                  <Box key={session.mission.id} justifyContent="space-between">
                    <Box>
                      <Text color={focusIndex === idx + 2 ? 'cyan' : 'white'}>
                        {focusIndex === idx + 2 ? '▶ ' : '  '}
                        {session.mission.title}
                      </Text>
                      <Text color="gray"> ({session.mission.status})</Text>
                    </Box>
                    <Text color="gray" dimColor>{new Date(session.updatedAt).toLocaleString()}</Text>
                  </Box>
                ))}
                <Box marginTop={1}>
                  <Text color="gray">Use </Text>
                  <Text color="cyan" bold>Enter</Text>
                  <Text color="gray"> to load, </Text>
                  <Text color="red" bold>Del</Text>
                  <Text color="gray"> to delete.</Text>
                </Box>
              </Box>
            )}
          </Box>
        )}

        {isIdle && view !== 'settings' && (
          <Box flexDirection="column" marginTop={1}>
            <Box marginBottom={1} flexDirection="column">
              <Box gap={1}>
                <Text color={focusIndex === 0 ? 'cyan' : 'blue'} bold={focusIndex === 0}>
                  {focusIndex === 0 ? '●' : '○'} Workspace Root:
                </Text>
              </Box>
              <Box borderStyle="single" borderColor={focusIndex === 0 ? 'cyan' : 'gray'} paddingX={1}>
                {focusIndex === 0 ? (
                  <TextInput
                    defaultValue={workspace}
                    onChange={setWorkspace}
                    onSubmit={() => setFocusIndex(1)}
                  />
                ) : (
                  <Text color="gray">{workspace}</Text>
                )}
              </Box>
            </Box>

            <Box flexDirection="column">
              <Box gap={1}>
                <Text color={focusIndex === 1 ? 'green' : 'gray'} bold={focusIndex === 1}>
                  {focusIndex === 1 ? '●' : '○'} Mission Description:
                </Text>
              </Box>
              <Box borderStyle="single" borderColor={focusIndex === 1 ? 'green' : 'gray'} paddingX={1}>
                {focusIndex === 1 ? (
                  <TextInput
                    placeholder="e.g. Add a dark mode toggle to the settings panel"
                    onSubmit={handleSubmit}
                  />
                ) : (
                  <Text color="gray" dimColor>Select this field to enter mission...</Text>
                )}
              </Box>
            </Box>

            <Box marginTop={1}>
              <Text color="gray">Press </Text>
              <Text color="cyan" bold>Tab</Text>
              <Text color="gray"> to switch fields.</Text>
            </Box>
          </Box>
        )}
      </Box>

      {/* Footer */}
      <Box marginTop={1} borderStyle="single" borderColor="gray" paddingX={1} justifyContent="space-between">
        <Text color="gray">Model: {settings.OLLAMA_MODEL}</Text>
        <Box>
          <Text color="gray">
            Context: {contextKB}K tokens | Max Steps: 
          </Text>
          <Text color={isYoloMode || activeMaxSteps > settings.MAX_STEPS ? 'yellow' : 'gray'} bold={isYoloMode || activeMaxSteps > settings.MAX_STEPS}>
            {isYoloMode ? '∞' : activeMaxSteps}{!isYoloMode && activeMaxSteps > settings.MAX_STEPS ? ` (+${activeMaxSteps - settings.MAX_STEPS})` : ''}
          </Text>
          <Text color="gray"> | Concurrent: {settings.MAX_CONCURRENT_TASKS}</Text>
        </Box>
      </Box>
    </Box>
  );
};

render(<App />);
