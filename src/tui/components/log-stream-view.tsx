import React from 'react';
import { Box, Text } from 'ink';
import { ExecutionEvent } from '../../agent/types.js';

interface LogStreamViewProps {
  events: ExecutionEvent[];
}

export const LogStreamView: React.FC<LogStreamViewProps> = ({ events }) => {
  // Show last 100 events for the log stream
  const visibleEvents = events.slice(-100);

  const getLevelColor = (level: string) => {
    switch (level) {
      case 'ERROR': return 'red';
      case 'WARN': return 'yellow';
      case 'DEBUG': return 'gray';
      default: return 'cyan';
    }
  };

  return (
    <Box flexDirection="column" padding={1} borderStyle="round" borderColor="gray">
      <Box paddingBottom={1} justifyContent="space-between">
        <Text bold color="white">LOG STREAM (Last 100 events)</Text>
        <Text color="gray">{events.length} total events</Text>
      </Box>
      
      <Box flexDirection="column">
        {visibleEvents.map((event, idx) => {
          const timestamp = 'timestamp' in event ? (event.timestamp as string).split('T')[1].split('.')[0] : new Date().toLocaleTimeString();
          
          switch (event.type) {
            case 'system_log':
              return (
                <Box key={idx} gap={1}>
                  <Text color="gray" dimColor>[{timestamp}]</Text>
                  <Text color={getLevelColor(event.level)} bold>[{event.level.padEnd(6)}]</Text>
                  <Text color="white">{event.message}</Text>
                </Box>
              );
            case 'thinking':
              return (
                <Box key={idx} gap={1}>
                  <Text color="gray" dimColor>[{timestamp}]</Text>
                  <Text color="blue" bold>[THINK ]</Text>
                  <Text color="gray" italic>{event.content.slice(0, 150)}...</Text>
                </Box>
              );
            case 'tool_call':
              return (
                <Box key={idx} gap={1} flexDirection="column">
                  <Box gap={1}>
                    <Text color="gray" dimColor>[{timestamp}]</Text>
                    <Text color="magenta" bold>[TOOL  ]</Text>
                    <Text color="white" bold>{event.tool}</Text>
                  </Box>
                  <Box paddingLeft={12}>
                    <Text color="gray">{JSON.stringify(event.args, null, 2).slice(0, 500)}</Text>
                  </Box>
                </Box>
              );
            case 'tool_result':
              return (
                <Box key={idx} gap={1} flexDirection="column">
                  <Box gap={1}>
                    <Text color="gray" dimColor>[{timestamp}]</Text>
                    <Text color="magenta" bold>[RESULT]</Text>
                    <Text color={event.result.success ? 'green' : 'red'}>
                      {event.result.success ? 'Success' : 'Failure'}
                    </Text>
                  </Box>
                  {!event.result.success && event.result.error && (
                    <Box paddingLeft={12}>
                      <Text color="red">{event.result.error.slice(0, 500)}</Text>
                    </Box>
                  )}
                  {event.result.data && (
                    <Box paddingLeft={12}>
                      <Text color="gray" dimColor>Data: {JSON.stringify(event.result.data).slice(0, 200)}...</Text>
                    </Box>
                  )}
                </Box>
              );
            case 'output':
              return (
                <Box key={idx} gap={1}>
                  <Text color="gray" dimColor>[{timestamp}]</Text>
                  <Text color="green" bold>[OUTPUT]</Text>
                  <Text color="green">{event.content.slice(0, 200)}...</Text>
                </Box>
              );
            case 'error':
              return (
                <Box key={idx} gap={1}>
                  <Text color="gray" dimColor>[{timestamp}]</Text>
                  <Text color="red" bold>[FATAL ]</Text>
                  <Text color="red">{event.message}</Text>
                </Box>
              );
            case 'timeout_warning':
              return (
                <Box key={idx} gap={1}>
                  <Text color="gray" dimColor>[{timestamp}]</Text>
                  <Text color="yellow" bold>[WARN  ]</Text>
                  <Text color="yellow">Model is taking longer than expected ({event.durationSeconds}s)...</Text>
                </Box>
              );
            case 'intervention_required':
              return (
                <Box key={idx} gap={1}>
                  <Text color="gray" dimColor>[{timestamp}]</Text>
                  <Text color="yellow" bold>[PAUSE ]</Text>
                  <Text color="white">Intervention required on task {event.taskId}: {event.question}</Text>
                </Box>
              );
            case 'steps_updated':
              return (
                <Box key={idx} gap={1}>
                  <Text color="gray" dimColor>[{timestamp}]</Text>
                  <Text color="blue" bold>[STEPS ]</Text>
                  <Text color="white">Extra steps granted: {event.extraSteps}</Text>
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
