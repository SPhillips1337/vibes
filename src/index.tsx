import React from 'react';
import { render, Box, Text, useInput, useApp } from 'ink';
import { TextInput } from '@inkjs/ui';
import { useMission } from './tui/hooks/use-mission.js';
import { useUpdateCheck } from './tui/hooks/use-update-check.js';
import { Dashboard } from './tui/components/dashboard.js';
import { MissionView } from './tui/components/mission-view.js';
import { TaskView } from './tui/components/task-view.js';
import { ApprovalView } from './tui/components/approval-view.js';
import { InterventionView } from './tui/components/intervention-view.js';
import { UpdateNotification } from './tui/components/update-notification.js';
import { initLogger } from './logger.js';
import { config } from './config.js';
import path from 'path';

const App = () => {
  const {
    mission, pendingMission, isPlanning, isExecuting,
    error, events, contextUsage, pendingIntervention, activeMaxSteps,
    isYoloMode, toggleYoloMode,
    startMission, approveMission, rejectMission, resolveIntervention,
  } = useMission();

  const { exit } = useApp();
  const {
    updateInfo, status: updateStatus, error: updateError,
    dismissed: updateDismissed, updateLog,
    performUpdate, dismiss: dismissUpdate, resetStatus: resetUpdateStatus,
  } = useUpdateCheck();
  const [workspace, setWorkspace] = React.useState(process.cwd());
  const [view, setView] = React.useState<'dashboard' | 'mission' | 'task'>('dashboard');
  const [focusIndex, setFocusIndex] = React.useState(0);

  useInput((input, key) => {
    if (key.ctrl && input === 'q') exit();

    // Suppress global shortcuts while typing in a text field
    const isTyping = isIdle; // In idle state, we have focusable text inputs
    if (isTyping) {
      if (key.tab) setFocusIndex(prev => (prev === 0 ? 1 : 0));
      return; 
    }

    // Update notification keys (only if not typing)
    if (input === 'u' && updateInfo?.available && !updateDismissed && updateStatus === 'idle') {
      performUpdate();
      return;
    }
    if (input === 'x' && updateInfo?.available && !updateDismissed) {
      dismissUpdate();
      return;
    }

    // Suppress nav/toggle keys while modal views or update process are active
    if (pendingMission || pendingIntervention || updateStatus === 'updating') return;

    if (key.meta) {
      if (input === 'd') { setView('dashboard'); return; }
      if (input === 'm') { setView('mission'); return; }
      if (input === 't') { setView('task'); return; }
      if (input === 'y') { toggleYoloMode(); return; }
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

  const isIdle = !mission && !isPlanning && !pendingMission;
  const contextKB = Math.round(config.CONTEXT_WINDOW / 1024);

  return (
    <Box flexDirection="column" padding={1}>
      {/* Header */}
      <Box justifyContent="space-between" borderStyle="round" borderColor="blue" paddingX={1}>
        <Text bold color="cyan">VIBES TUI</Text>
        <Box gap={2}>
          {!pendingMission && !pendingIntervention && !isIdle && (
            <>
              <Text color={view === 'dashboard' ? 'white' : 'blue'}>[Alt+D] Dashboard</Text>
              <Text color={view === 'mission' ? 'white' : 'blue'}>[Alt+M] Mission</Text>
              <Text color={view === 'task' ? 'white' : 'blue'}>[Alt+T] Task View</Text>
              <Text color={isYoloMode ? 'yellow' : 'blue'} bold={isYoloMode}>[Alt+Y] YOLO {isYoloMode ? 'ON' : 'OFF'}</Text>
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

        {isIdle && (
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
        <Text color="gray">Model: {config.OLLAMA_MODEL}</Text>
        <Text color="gray">
          Context: {contextKB}K tokens | Max Steps: 
        </Text>
        <Text color={isYoloMode || activeMaxSteps > config.MAX_STEPS ? 'yellow' : 'gray'} bold={isYoloMode || activeMaxSteps > config.MAX_STEPS}>
          {isYoloMode ? '∞' : activeMaxSteps}{!isYoloMode && activeMaxSteps > config.MAX_STEPS ? ` (+${activeMaxSteps - config.MAX_STEPS})` : ''}
        </Text>
        <Text color="gray"> | Concurrent: {config.MAX_CONCURRENT_TASKS}</Text>
      </Box>
    </Box>
  );
};

render(<App />);
