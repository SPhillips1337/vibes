import React from 'react';
import { Box, Text } from 'ink';
import { ExecutionEvent } from '../../agent/types.js';

interface TaskViewProps {
  events: ExecutionEvent[];
}

export const TaskView: React.FC<TaskViewProps> = ({ events }) => {
  return (
    <Box flexDirection="column" marginTop={1} paddingX={1}>
      <Box paddingBottom={1}>
        <Text bold color="yellow">Live Agent Execution</Text>
      </Box>
      
      <Box flexDirection="column">
        {events.slice(-15).map((event, idx) => {
          switch (event.type) {
            case 'thinking':
              return (
                <Box key={idx} paddingBottom={1}>
                  <Text color="blue" italic>Thinking: </Text>
                  <Text color="gray" dimColor>{event.content.slice(0, 200)}{event.content.length > 200 ? '...' : ''}</Text>
                </Box>
              );
            case 'tool_call':
              return (
                <Box key={idx}>
                  <Text color="magenta" bold>Tool Call: </Text>
                  <Text color="white">{event.tool}</Text>
                  <Text color="gray">({JSON.stringify(event.args)})</Text>
                </Box>
              );
            case 'tool_result':
              return (
                <Box key={idx} paddingBottom={1}>
                  <Text color="magenta" bold>Tool Result: </Text>
                  <Text color={event.result.success ? 'green' : 'red'}>
                    {event.result.success ? 'Success' : `Error: ${event.result.error}`}
                  </Text>
                </Box>
              );
            case 'output':
              return (
                <Box key={idx} paddingBottom={1} borderStyle="single" borderColor="green" paddingX={1}>
                  <Text color="green">{event.content}</Text>
                </Box>
              );
            case 'error':
              return (
                <Box key={idx} paddingBottom={1}>
                  <Text color="red" bold>Error: </Text>
                  <Text color="red">{event.message}</Text>
                </Box>
              );
            default:
              return null;
          }
        })}
      </Box>
    </Box>
  );
};
