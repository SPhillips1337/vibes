import React from 'react';
import { Box, Text, useInput } from 'ink';
import { Mission } from '../../agent/types.js';

interface ApprovalViewProps {
  mission: Mission;
  onApprove: () => void;
  onReject: () => void;
}

export const ApprovalView: React.FC<ApprovalViewProps> = ({ mission, onApprove, onReject }) => {
  useInput((input, key) => {
    if (key.return || input === 'y') {
      onApprove();
    }
    if (input === 'n' || key.escape) {
      onReject();
    }
  });

  const allTasks = mission.milestones.flatMap(m => m.tasks);
  const totalTasks = allTasks.length;

  return (
    <Box flexDirection="column" borderStyle="double" borderColor="yellow" paddingX={2} paddingY={1} marginTop={1}>
      <Box marginBottom={1}>
        <Text bold color="yellow">⚠  Mission Plan — Awaiting Approval</Text>
      </Box>

      <Box marginBottom={1}>
        <Text bold color="white">{mission.title}</Text>
      </Box>
      <Box marginBottom={1} paddingLeft={2}>
        <Text color="gray" italic>{mission.description}</Text>
      </Box>

      {mission.milestones.map((milestone, mIdx) => (
        <Box key={milestone.id} flexDirection="column" marginBottom={1}>
          <Box>
            <Text color="magenta" bold>{mIdx + 1}. {milestone.title}</Text>
          </Box>
          {milestone.tasks.map((task, tIdx) => (
            <Box key={task.id} paddingLeft={3} flexDirection="column">
              <Box>
                <Text color="gray">  {tIdx + 1}. </Text>
                <Text color="white">{task.title}</Text>
              </Box>
              {task.files.length > 0 && (
                <Box paddingLeft={6}>
                  <Text color="blue" dimColor>→ {task.files.join(', ')}</Text>
                </Box>
              )}
            </Box>
          ))}
        </Box>
      ))}

      <Box borderStyle="single" borderColor="gray" marginTop={1} paddingX={1}>
        <Text color="gray">Total: </Text>
        <Text color="white">{mission.milestones.length} milestones, {totalTasks} tasks</Text>
      </Box>

      <Box marginTop={1} gap={4}>
        <Box>
          <Text color="green" bold>[Enter / Y]</Text>
          <Text color="green"> Approve & Execute</Text>
        </Box>
        <Box>
          <Text color="red" bold>[N / Esc]</Text>
          <Text color="red"> Cancel</Text>
        </Box>
      </Box>
    </Box>
  );
};
