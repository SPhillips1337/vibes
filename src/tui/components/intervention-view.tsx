import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { TextInput } from '@inkjs/ui';

type InterventionAction = 'retry' | 'skip' | 'fail' | 'reply';

interface InterventionViewProps {
  taskId: string;
  error: string;
  question: string;
  onResolve: (action: InterventionAction, message?: string) => void;
}

const OPTIONS: { key: InterventionAction; label: string; color: string }[] = [
  { key: 'retry',  label: 'Retry Task (+10 steps)',     color: 'cyan' },
  { key: 'reply',  label: 'Reply to Agent',             color: 'green' },
  { key: 'skip',   label: 'Skip Task (and dependents)', color: 'yellow' },
  { key: 'fail',   label: 'Fail Entire Mission',        color: 'red' },
];

export const InterventionView: React.FC<InterventionViewProps> = ({ taskId, error, question, onResolve }) => {
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [isTyping, setIsTyping] = useState(false);

  useInput((input, key) => {
    if (isTyping) return; // Let TextInput handle keys when typing

    if (key.leftArrow || key.upArrow) {
      setSelectedIdx(prev => (prev - 1 + OPTIONS.length) % OPTIONS.length);
    }
    if (key.rightArrow || key.downArrow) {
      setSelectedIdx(prev => (prev + 1) % OPTIONS.length);
    }
    if (key.return) {
      const selected = OPTIONS[selectedIdx].key;
      if (selected === 'reply') {
        setIsTyping(true);
      } else {
        onResolve(selected);
      }
    }
    // Escape to go back if reply was selected
    if (key.escape && isTyping) {
      setIsTyping(false);
    }
  });

  const handleReplySubmit = (value: string) => {
    if (value.trim()) {
      onResolve('reply', value.trim());
    } else {
      setIsTyping(false);
    }
  };

  const selected = OPTIONS[selectedIdx].key;

  return (
    <Box flexDirection="column" padding={1} borderStyle="bold" borderColor="yellow">
      <Box paddingBottom={1}>
        <Text bold color="yellow">⚠ INTERVENTION REQUIRED</Text>
      </Box>
      
      <Box marginBottom={1} flexDirection="column">
        <Box>
          <Text color="white">Task failed with error: </Text>
          <Text color="red">{error}</Text>
        </Box>
      </Box>

      <Box padding={1} borderStyle="single" borderColor="blue" marginBottom={1} flexDirection="column">
        <Text color="white" bold>The Agent asks:</Text>
        <Box marginTop={1}>
          <Text color="blue" italic wrap="wrap">{question}</Text>
        </Box>
      </Box>

      {!isTyping && (
        <Box flexDirection="column" gap={1}>
          <Text color="white">How should the mission proceed?</Text>
          
          <Box flexDirection="column" marginTop={1}>
            {OPTIONS.map((opt, idx) => (
              <Box key={opt.key}>
                <Text color={selectedIdx === idx ? opt.color : 'gray'}>
                  {selectedIdx === idx ? ' ◉ ' : ' ○ '}
                  {opt.label}
                </Text>
              </Box>
            ))}
          </Box>

          <Box marginTop={1}>
            <Text color="gray">Use arrow keys to select, press </Text>
            <Text color="white" bold>Enter</Text>
            <Text color="gray"> to confirm.</Text>
          </Box>
        </Box>
      )}

      {isTyping && (
        <Box flexDirection="column" gap={1}>
          <Text color="green" bold>Reply to the agent:</Text>
          <Text color="gray" dimColor>Type your guidance and press Enter to send, or submit empty to go back.</Text>
          <Box borderStyle="single" borderColor="green" paddingX={1} marginTop={1}>
            <TextInput
              placeholder="e.g. Simplify the implementation, skip the spread-shot for now"
              onSubmit={handleReplySubmit}
            />
          </Box>
        </Box>
      )}
    </Box>
  );
};
