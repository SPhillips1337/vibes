import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { Mission } from '../../agent/types.js';

interface DashboardProps {
  mission: Mission | null;
  isPlanning: boolean;
  isExecuting: boolean;
  isYoloMode?: boolean;
  contextUsage?: { used: number; total: number; percentage: number } | null;
}

export const Dashboard: React.FC<DashboardProps> = ({ mission, isPlanning, isExecuting, isYoloMode, contextUsage }) => {
  const [dots, setDots] = useState('');

  // Heartbeat animation
  useEffect(() => {
    if (!isExecuting && !isPlanning) {
      setDots('');
      return;
    }
    const interval = setInterval(() => {
      setDots(prev => {
        if (prev === '...') return '';
        return prev + '.';
      });
    }, 500);
    return () => clearInterval(interval);
  }, [isExecuting, isPlanning]);

  if (!mission) {
    return (
      <Box flexDirection="column" padding={1}>
        {isPlanning ? (
          <Text color="yellow">Planning mission{dots} Analyzing goals and breaking down tasks.</Text>
        ) : (
          <Text color="gray">No active mission. Enter a mission description to begin.</Text>
        )}
      </Box>
    );
  }

  const allTasks = mission.milestones.flatMap(m => m.tasks);
  const completed = allTasks.filter(t => t.status === 'done').length;
  const inProgress = allTasks.filter(t => t.status === 'in_progress').length;
  const failed = allTasks.filter(t => t.status === 'failed').length;
  const total = allTasks.length;
  const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;
  
  const isFinished = !isExecuting && (completed + failed === total);

  // Context usage color coding
  const getContextColor = (pct: number): string => {
    if (pct >= 90) return 'red';
    if (pct >= 70) return 'yellow';
    return 'green';
  };

  return (
    <Box flexDirection="column" padding={1} borderStyle="single" borderColor={isFinished ? (failed > 0 ? 'yellow' : 'green') : 'cyan'}>
      <Box justifyContent="space-between">
        <Box>
          <Text bold color="white">{mission.title}</Text>
          {isExecuting && <Text color="yellow"> {dots}</Text>}
        </Box>
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
          {failed > 0 && <Text color="red">/{failed}✗</Text>}
          <Text>/{total}</Text>
        </Box>
      </Box>

      {/* Context Window Usage */}
      {contextUsage && (
        <Box paddingTop={1} flexDirection="row" gap={2}>
          <Box>
            <Text>Context: </Text>
            <Text color={getContextColor(contextUsage.percentage)}>
              [{'█'.repeat(Math.floor(Math.min(contextUsage.percentage, 100) / 5)) + '░'.repeat(20 - Math.floor(Math.min(contextUsage.percentage, 100) / 5))}]
            </Text>
          </Box>
          <Box>
            <Text color={getContextColor(contextUsage.percentage)}>
              ~{Math.round(contextUsage.used / 1000)}K/{Math.round(contextUsage.total / 1000)}K tokens ({contextUsage.percentage}%)
            </Text>
          </Box>
          {contextUsage.percentage >= 80 && (
            <Text color="red" bold> ⚠ HIGH</Text>
          )}
        </Box>
      )}

      {isExecuting && (
        <Box paddingTop={1}>
          <Text color="yellow">Status: </Text>
          <Text bold color="yellow">EXECUTING AGENT LOOP</Text>
          <Text color="yellow"> {dots}</Text>
          {isYoloMode && <Text color="yellow" bold inverse> [YOLO MODE ENABLED] </Text>}
        </Box>
      )}

      {isFinished && (
        <Box paddingTop={1} flexDirection="column">
          <Box>
            <Text color={failed > 0 ? 'yellow' : 'green'} bold>
              {failed > 0 ? '⚠ MISSION FINISHED WITH FAILURES' : '✅ MISSION COMPLETED SUCCESSFULLY'}
            </Text>
          </Box>
          <Box marginTop={1}>
            <Text color="gray">Press </Text>
            <Text color="cyan" bold>Ctrl+Q</Text>
            <Text color="gray"> to quit or </Text>
            <Text color="cyan" bold>Alt+M</Text>
            <Text color="gray"> to review the mission details.</Text>
          </Box>
        </Box>
      )}
    </Box>
  );
};
