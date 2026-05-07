import React from 'react';
import { Box, Text, useInput } from 'ink';
import type { UpdateInfo, UpdateStatus } from '../hooks/use-update-check.js';

interface UpdateNotificationProps {
  updateInfo: UpdateInfo | null;
  status: UpdateStatus;
  error: string | null;
  dismissed: boolean;
  updateLog: string[];
  onUpdate: () => void;
  onDismiss: () => void;
  onReset: () => void;
}

export const UpdateNotification: React.FC<UpdateNotificationProps> = ({
  updateInfo,
  status,
  error,
  dismissed,
  updateLog,
  onUpdate,
  onDismiss,
  onReset,
}) => {
  useInput((input, key) => {
    // Only capture keys when relevant
    if (status === 'success' || status === 'error') {
      if (input === 'r' || key.return) {
        onReset();
        return;
      }
    }
  });

  // Show updating progress
  if (status === 'updating') {
    return (
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor="cyan"
        paddingX={1}
        marginBottom={1}
      >
        <Box justifyContent="center" marginBottom={1}>
          <Text bold color="cyan">🔄 UPDATING VIBES...</Text>
        </Box>
        {updateLog.map((line, i) => (
          <Text key={i} color="gray">{line}</Text>
        ))}
      </Box>
    );
  }

  // Show success result
  if (status === 'success') {
    return (
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor="green"
        paddingX={1}
        marginBottom={1}
      >
        <Box justifyContent="center" marginBottom={1}>
          <Text bold color="green">✅ UPDATE COMPLETE</Text>
        </Box>
        {updateLog.slice(-3).map((line, i) => (
          <Text key={i} color="gray">{line}</Text>
        ))}
        <Box marginTop={1}>
          <Text color="yellow" bold>Restart the app to use the new version. </Text>
          <Text color="gray">Press </Text>
          <Text color="cyan" bold>Enter</Text>
          <Text color="gray"> to dismiss.</Text>
        </Box>
      </Box>
    );
  }

  // Show error result
  if (status === 'error') {
    return (
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor="red"
        paddingX={1}
        marginBottom={1}
      >
        <Box justifyContent="center" marginBottom={1}>
          <Text bold color="red">❌ UPDATE FAILED</Text>
        </Box>
        {updateLog.slice(-5).map((line, i) => (
          <Text key={i} color="gray">{line}</Text>
        ))}
        {error && (
          <Box marginTop={1}>
            <Text color="red">{error}</Text>
          </Box>
        )}
        <Box marginTop={1}>
          <Text color="gray">Press </Text>
          <Text color="cyan" bold>Enter</Text>
          <Text color="gray"> to dismiss.</Text>
        </Box>
      </Box>
    );
  }

  // No update available or dismissed — show nothing
  if (!updateInfo?.available || dismissed) {
    return null;
  }

  // Show update available banner
  const timeAgo = updateInfo.remoteDate ? formatTimeAgo(updateInfo.remoteDate) : '';

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="magenta"
      paddingX={1}
      marginBottom={1}
    >
      <Box justifyContent="space-between">
        <Box gap={1}>
          <Text color="magenta" bold>📦 Update Available!</Text>
          <Text color="gray">
            {updateInfo.commitsBehind} new commit{updateInfo.commitsBehind > 1 ? 's' : ''} on main
          </Text>
        </Box>
        <Text color="gray" dimColor>{updateInfo.localCommit} → {updateInfo.remoteCommit}</Text>
      </Box>

      <Box marginTop={0} paddingLeft={3}>
        <Text color="white" italic>"{updateInfo.remoteMessage}"</Text>
        {timeAgo && <Text color="gray" dimColor> — {updateInfo.remoteAuthor}, {timeAgo}</Text>}
      </Box>

      <Box marginTop={1} gap={3}>
        <Box gap={1}>
          <Text color="gray">Press </Text>
          <Text color="green" bold>[Alt+U]</Text>
          <Text color="gray"> to update & rebuild</Text>
        </Box>
        <Box gap={1}>
          <Text color="gray">Press </Text>
          <Text color="yellow" bold>[Alt+X]</Text>
          <Text color="gray"> to dismiss</Text>
        </Box>
      </Box>
    </Box>
  );
};

function formatTimeAgo(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  } catch {
    return '';
  }
}
