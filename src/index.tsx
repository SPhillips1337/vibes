import React from 'react';
import { render, Box, Text, useInput, useApp } from 'ink';
import { TextInput } from '@inkjs/ui';
import { useMission } from './tui/hooks/use-mission.js';
import { Dashboard } from './tui/components/dashboard.js';
import { MissionView } from './tui/components/mission-view.js';
import { TaskView } from './tui/components/task-view.js';
import { initLogger } from './logger.js';
import path from 'path';

const App = () => {
  const { mission, isPlanning, isExecuting, error, events, startMission } = useMission();
  const { exit } = useApp();
  const [workspace, setWorkspace] = React.useState(process.cwd());
  const [view, setView] = React.useState<'dashboard' | 'mission' | 'task'>('dashboard');
  
  // Focus state: 0 for workspace, 1 for mission
  const [focusIndex, setFocusIndex] = React.useState(0);

  useInput((input, key) => {
    // Global commands
    if (key.ctrl && input === 'q') {
      exit();
    }

    // Navigation (Alt + Key)
    if (key.meta) {
      if (input === 'd') {
        setView('dashboard');
        return;
      }
      if (input === 'm') {
        setView('mission');
        return;
      }
      if (input === 't') {
        setView('task');
        return;
      }
    }

    // Toggle focus with Tab
    if (key.tab) {
      setFocusIndex(prev => (prev === 0 ? 1 : 0));
    }
  });

  const handleSubmit = (val: string) => {
    if (val.trim()) {
      // Resolve path at the moment of submission to be safe
      const absolutePath = path.isAbsolute(workspace) ? workspace : path.resolve(process.cwd(), workspace);
      startMission(val, absolutePath);
    }
  };

  const isActive = !mission && !isPlanning;

  return (
    <Box flexDirection="column" padding={1}>
      {/* Header */}
      <Box justifyContent="space-between" borderStyle="round" borderColor="blue" paddingX={1}>
        <Text bold color="cyan">GEMMA4 TUI HARNESS</Text>
        <Box gap={2}>
          <Text color={view === 'dashboard' ? 'white' : 'blue'}>[Alt+D] Dashboard</Text>
          <Text color={view === 'mission' ? 'white' : 'blue'}>[Alt+M] Mission</Text>
          <Text color={view === 'task' ? 'white' : 'blue'}>[Alt+T] Task View</Text>
          <Text color="red">[Ctrl+Q] Quit</Text>
        </Box>
      </Box>

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

        {view === 'dashboard' && (
          <Dashboard mission={mission} isPlanning={isPlanning} isExecuting={isExecuting} />
        )}
        
        {view === 'mission' && mission && (
          <MissionView mission={mission} />
        )}

        {view === 'task' && (
          <TaskView events={events} />
        )}

        {isActive && (
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
      <Box marginTop={1} borderStyle="single" borderColor="gray" paddingX={1}>
        <Text color="gray">
          Model: VladimirGav/gemma4-26b-16GB-VRAM | Context: 32K
        </Text>
      </Box>
    </Box>
  );
};

console.clear();
initLogger();
render(<App />);
