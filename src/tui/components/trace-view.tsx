import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import type { ExecutionEvent } from '../../agent/types.js';

interface TraceViewProps {
  events: ExecutionEvent[];
}

const VISIBLE_COUNT = 20;

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

export const TraceView: React.FC<TraceViewProps> = React.memo(({ events }) => {
  const [scrollOffset, setScrollOffset] = useState(0);

  const totalEvents = events.length;
  const maxOffset = Math.max(0, totalEvents - VISIBLE_COUNT);

  useEffect(() => {
    if (scrollOffset === 0 && totalEvents > VISIBLE_COUNT) {
      setScrollOffset(0);
    }
  }, [totalEvents, scrollOffset]);

  useInput((_input, key) => {
    if (key.upArrow) setScrollOffset(prev => Math.min(prev + 1, maxOffset));
    if (key.downArrow) setScrollOffset(prev => Math.max(0, prev - 1));
    if (key.pageUp) setScrollOffset(prev => Math.min(prev + VISIBLE_COUNT, maxOffset));
    if (key.pageDown) setScrollOffset(prev => Math.max(0, prev - VISIBLE_COUNT));
    if (key.home) setScrollOffset(maxOffset);
    if (key.end) setScrollOffset(0);
  });

  if (events.length === 0) {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor="cyan" padding={1}>
        <Text bold color="cyan">Execution Trace</Text>
        <Text color="gray">No events recorded yet.</Text>
      </Box>
    );
  }

  const visibleEvents = events.slice(totalEvents - VISIBLE_COUNT - scrollOffset, totalEvents - scrollOffset);

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" padding={1}>
      <Box justifyContent="space-between">
        <Text bold color="cyan">Execution Trace ({totalEvents} events)</Text>
        {scrollOffset > 0 && (
          <Text color="yellow" bold>↑ {scrollOffset} lines</Text>
        )}
      </Box>
      <Box flexDirection="column" marginTop={1}>
        {visibleEvents.map((evt, i) => (
          <Text key={i} color={eventColor(evt)} wrap="truncate">
            {formatEvent(evt, totalEvents - VISIBLE_COUNT - scrollOffset + i)}
          </Text>
        ))}
      </Box>
      <Box marginTop={1}>
        <Text color="gray" dimColor>↑↓ Scroll | PgUp/PgDn Page | Home/End Jump</Text>
      </Box>
    </Box>
  );
});
