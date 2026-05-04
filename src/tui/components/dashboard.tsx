import React from 'react';
import { Box, Text } from 'ink';
import { Mission } from '../../agent/types.js';

interface DashboardProps {
  mission: Mission | null;
  isPlanning: boolean;
  isExecuting: boolean;
}

export const Dashboard: React.FC<DashboardProps> = ({ mission, isPlanning, isExecuting }) => {
  if (!mission) {
    return (
      <Box flexDirection="column" padding={1}>
        {isPlanning ? (
          <Text color="yellow">Planning mission... Analyzing goals and breaking down tasks.</Text>
        ) : (
          <Text color="gray">No active mission. Enter a mission description to begin.</Text>
        )}
      </Box>
    );
  }

  const allTasks = mission.milestones.flatMap(m => m.tasks);
  const completed = allTasks.filter(t => t.status === 'done').length;
  const inProgress = allTasks.filter(t => t.status === 'in_progress').length;
  const total = allTasks.length;
  const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <Box flexDirection="column" padding={1} borderStyle="single" borderColor="cyan">
      <Box justifyContent="space-between">
        <Text bold color="white">{mission.title}</Text>
        <Text color="blue">{percentage}% Complete</Text>
      </Box>
      <Box paddingBottom={1}>
        <Text color="gray" italic>{mission.description}</Text>
      </Box>
      
      <Box flexDirection="row" gap={2}>
        <Box>
          <Text>Progress: </Text>
          <Text color="green">[{'█'.repeat(Math.floor(percentage / 5)) + '░'.repeat(20 - Math.floor(percentage / 5))}]</Text>
        </Box>
        <Box>
          <Text>Tasks: </Text>
          <Text color="green">{completed}</Text>
          <Text>/</Text>
          <Text color="yellow">{inProgress > 0 ? inProgress : ''}</Text>
          <Text>/</Text>
          <Text>{total}</Text>
        </Box>
      </Box>

      {isExecuting && (
        <Box paddingTop={1}>
          <Text color="yellow">Status: </Text>
          <Text bold color="yellow">EXECUTING AGENT LOOP</Text>
        </Box>
      )}
    </Box>
  );
};
