import React from 'react';
import { Box, Text } from 'ink';
import { Mission } from '../../agent/types.js';

interface MissionViewProps {
  mission: Mission;
}

export const MissionView: React.FC<MissionViewProps> = ({ mission }) => {
  return (
    <Box flexDirection="column" marginTop={1}>
      {mission.milestones.map((milestone, mIdx) => (
        <Box key={milestone.id} flexDirection="column" paddingBottom={1}>
          <Text bold color="magenta">
            {mIdx + 1}. {milestone.title}
          </Text>
          <Box paddingLeft={2}>
            <Text color="gray" dimColor>{milestone.description}</Text>
          </Box>
          
          <Box flexDirection="column" paddingLeft={2} paddingTop={1}>
            {milestone.tasks.map((task, tIdx) => {
              let statusIcon = '⏳';
              let statusColor = 'gray';

              if (task.status === 'done') {
                statusIcon = '✅';
                statusColor = 'green';
              } else if (task.status === 'in_progress') {
                statusIcon = '▶️';
                statusColor = 'yellow';
              } else if (task.status === 'failed') {
                statusIcon = '❌';
                statusColor = 'red';
              }

              return (
                <Box key={task.id} flexDirection="column" paddingBottom={1}>
                  <Box gap={1}>
                    <Text color={statusColor}>{statusIcon}</Text>
                    <Text color={statusColor === 'gray' ? 'white' : statusColor}>
                      {task.title}
                    </Text>
                  </Box>
                  <Box paddingLeft={4}>
                    <Text color="gray">{task.description}</Text>
                  </Box>
                  {task.files.length > 0 && (
                    <Box paddingLeft={4}>
                      <Text color="blue" dimColor>Files: {task.files.join(', ')}</Text>
                    </Box>
                  )}
                </Box>
              );
            })}
          </Box>
        </Box>
      ))}
    </Box>
  );
};
