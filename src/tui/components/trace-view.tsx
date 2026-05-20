/**
 * TraceView — renders a full execution event trace for debugging/inspection.
 */

import React from 'react';
import { Box, Text } from 'ink';
import type { ExecutionEvent } from '../../agent/types.js';

interface TraceViewProps {
  events: ExecutionEvent[];
}

/** Human-readable one-liner for each event type. */
function formatEvent(evt: ExecutionEvent, index: number): string {
  const label = `#${index + 1}`;
  switch (evt.type) {
    case 'thinking':
      return `${label} [THINK] ${evt.content.slice(0, 200)}`;
    case 'tool_call':
      return `${label} [TOOL]  ${evt.tool}(${JSON.stringify(evt.args).slice(0, 120)})`;
    case 'tool_result':
      return `${label} [RESULT] ${evt.tool}: success=${evt.result.success}`;
    case 'output':
      return `${label} [OUT]   ${evt.content.slice(0, 200)}`;
    case 'error':
      return `${label} [ERROR] ${evt.message}`;
    case 'context_update':
      return `${label} [CTX]   ${evt.percentage}% used (${evt.used}/${evt.total})`;
    case 'intervention_required':
      return `${label} [HELP]  ${evt.question.slice(0, 160)}`;
    case 'steps_updated':
      return `${label} [STEPS] +${evt.extraSteps} for ${evt.taskId}`;
    case 'system_log':
      return `${label} [${evt.level}] ${evt.message}`;
    case 'timeout_warning':
      return `${label} [TIMEOUT] ${evt.durationSeconds}s elapsed (threshold ${evt.thresholdSeconds}s)`;
    default:
      return `${label} [?] ${JSON.stringify(evt).slice(0, 200)}`;
  }
}

function eventColor(evt: ExecutionEvent): string {
  switch (evt.type) {
    case 'error':
    case 'timeout_warning':
      return 'red';
    case 'tool_call':
      return 'cyan';
    case 'tool_result':
      return 'green';
    case 'thinking':
      return 'yellow';
    case 'output':
      return 'white';
    case 'system_log':
      return evt.level === 'ERROR' || evt.level === 'WARN' ? 'red' : 'gray';
    default:
      return 'gray';
  }
}

export const TraceView: React.FC<TraceViewProps> = ({ events }) => {
  if (events.length === 0) {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor="cyan" padding={1}>
        <Text bold color="cyan">Execution Trace</Text>
        <Text color="gray">No events recorded yet.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" padding={1}>
      <Text bold color="cyan">Execution Trace ({events.length} events)</Text>
      <Box flexDirection="column" marginTop={1}>
        {events.map((evt, i) => (
          <Text key={i} color={eventColor(evt)} wrap="truncate">
            {formatEvent(evt, i)}
          </Text>
        ))}
      </Box>
    </Box>
  );
};
