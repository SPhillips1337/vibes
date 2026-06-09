import React from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import { TextInput, Select } from '@inkjs/ui';

type SettingsShape = Record<string, string | number | boolean>;

interface SettingsViewProps {
  settings: SettingsShape;
  onSave: (updates: Partial<SettingsShape>) => void;
  onClose: () => void;
  onToggleYoloMode?: (enabled: boolean) => void;
}

type FieldType = 'select' | 'text' | 'number' | 'boolean';

interface FieldDefinition {
  label: string;
  key: keyof SettingsShape;
  type: FieldType;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  settings,
  onSave,
  onClose,
  onToggleYoloMode,
}) => {
  const { stdout } = useStdout();
  const [focusIndex, setFocusIndex] = React.useState(0);
  const [tempSettings, setTempSettings] = React.useState(settings);
  const [draftValues, setDraftValues] = React.useState<Record<string, string>>({});
  const [status, setStatus] = React.useState<'idle' | 'saved'>('idle');

  const fields: FieldDefinition[] = [
    { label: 'Ollama Model', key: 'OLLAMA_MODEL', type: 'text' },
    { label: 'Base URL', key: 'OLLAMA_BASE_URL', type: 'text' },
    { label: 'API Key', key: 'OLLAMA_API_KEY', type: 'text' },
    { label: 'Planner Model', key: 'PLANNER_MODEL', type: 'text' },
    { label: 'Planner Base URL', key: 'PLANNER_BASE_URL', type: 'text' },
    { label: 'Planner API Key', key: 'PLANNER_API_KEY', type: 'text' },
    { label: 'Reviewer Model', key: 'REVIEWER_MODEL', type: 'text' },
    { label: 'Reviewer Base URL', key: 'REVIEWER_BASE_URL', type: 'text' },
    { label: 'Reviewer API Key', key: 'REVIEWER_API_KEY', type: 'text' },
    { label: 'Triage Model', key: 'TRIAGE_MODEL', type: 'text' },
    { label: 'Triage Base URL', key: 'TRIAGE_BASE_URL', type: 'text' },
    { label: 'Triage API Key', key: 'TRIAGE_API_KEY', type: 'text' },
    { label: 'Context Window', key: 'CONTEXT_WINDOW', type: 'number' },
    { label: 'Max Steps', key: 'MAX_STEPS', type: 'number' },
    { label: 'Reasoning Mode', key: 'THINKING_MODE', type: 'boolean' },
    { label: 'Default YOLO Mode', key: 'YOLO_MODE', type: 'boolean' },
    { label: 'Max Concurrent Tasks', key: 'MAX_CONCURRENT_TASKS', type: 'number' },
    { label: 'Enable Coder-Reviewer Swarm', key: 'ENABLE_REVIEWER', type: 'boolean' },
    { label: 'Memory Enabled', key: 'MEMORY_ENABLED', type: 'boolean' },
    { label: 'Local Memory', key: 'LOCAL_MEMORY', type: 'boolean' },
    { label: 'Memory User ID', key: 'MEMORY_USER_ID', type: 'text' },
    { label: 'Triage Observer', key: 'TRIAGE_ENABLED', type: 'boolean' },
    { label: 'Triage Interval (tasks)', key: 'TRIAGE_INTERVAL', type: 'number' },
    { label: 'Triage Auto-Steer', key: 'TRIAGE_AUTO_STEER', type: 'boolean' },
  ];

  // Removed the auto-sync useEffect that forces tempSettings to reset 
  // on every keystroke save, causing the draft input state to jump.

  const handleSave = (key: keyof SettingsShape, value: SettingsShape[keyof SettingsShape]) => {
    const updated = { ...tempSettings, [key]: value };
    setTempSettings(updated);
    onSave({ [key]: value });
    setStatus('saved');
  };

  const saveCurrentDraft = () => {
    const currentField = fields[focusIndex];
    if (!currentField || (currentField.type !== 'text' && currentField.type !== 'number')) return;
    const draft = draftValues[currentField.key];
    if (draft === undefined || draft === String(tempSettings[currentField.key] ?? '')) return;
    const parsed = currentField.type === 'number' ? Number(draft) : draft;
    handleSave(currentField.key, parsed);
  };

  useInput((input, pressedKey) => {
    if (pressedKey.escape || (pressedKey.meta && input === 's')) {
      onClose();
      return;
    }

    if (pressedKey.tab && !pressedKey.shift) {
      saveCurrentDraft();
      setFocusIndex((prev) => (prev + 1) % fields.length);
      setStatus('idle');
    }

    if (pressedKey.shift && pressedKey.tab) {
      saveCurrentDraft();
      setFocusIndex((prev) => (prev - 1 + fields.length) % fields.length);
      setStatus('idle');
    }

    const currentField = fields[focusIndex];
    if (currentField?.type === 'boolean' && (input === ' ' || pressedKey.return)) {
      const fieldKey = currentField.key;
      const newVal = !Boolean(tempSettings[fieldKey]);
      handleSave(fieldKey, newVal);
      if (fieldKey === 'YOLO_MODE' && typeof onToggleYoloMode === 'function') {
        onToggleYoloMode(newVal);
      }
    }
  });

  const maxVisible = Math.max(5, (stdout.rows || 24) - 15);
  const [startIdx, setStartIdx] = React.useState(0);

  // Maintain a stable scrolling window that only shifts when focus hits the edges
  React.useEffect(() => {
    if (focusIndex < startIdx) {
      setStartIdx(focusIndex);
    } else if (focusIndex >= startIdx + maxVisible) {
      setStartIdx(focusIndex - maxVisible + 1);
    }
  }, [focusIndex, startIdx, maxVisible]);

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" padding={1}>
      <Box justifyContent="space-between" marginBottom={1}>
        <Text bold color="cyan">⚙️ SETTINGS</Text>
        <Text color="gray">[Tab] Navigate | [Space/Enter] Toggle | [Alt+S/Esc] Close</Text>
      </Box>

      {fields.map((field, index) => {
        if (index < startIdx || index >= startIdx + maxVisible) return null;
        
        return (
          <Box key={field.key} flexDirection="column" marginBottom={1}>
            <Box gap={1}>
              <Text color={focusIndex === index ? 'cyan' : 'white'} bold={focusIndex === index}>
                {focusIndex === index ? '●' : '○'} {field.label}:
              </Text>
            </Box>

            <Box paddingX={1} flexDirection="column">
              {field.type === 'number' && focusIndex === index ? (
                <Box flexDirection="row">
                  <Text color="cyan">❯ </Text>
                  <TextInput
                    defaultValue={draftValues[field.key] !== undefined ? draftValues[field.key] : String(tempSettings[field.key] ?? '')}
                    onChange={(val) => setDraftValues(prev => ({ ...prev, [field.key]: val }))}
                    onSubmit={(val) => {
                      handleSave(field.key, Number(val));
                      setDraftValues(prev => {
                        const copy = { ...prev };
                        delete copy[field.key];
                        return copy;
                      });
                    }}
                  />
                </Box>
              ) : field.type === 'number' ? (
                <Box flexDirection="row" paddingLeft={2}>
                  <Text color="gray">{String(tempSettings[field.key] ?? '')}</Text>
                </Box>
              ) : null}

              {field.type === 'text' && focusIndex === index ? (
                <Box flexDirection="row">
                  <Text color="cyan">❯ </Text>
                  <TextInput
                    defaultValue={draftValues[field.key] !== undefined ? draftValues[field.key] : String(tempSettings[field.key] ?? '')}
                    onChange={(val) => setDraftValues(prev => ({ ...prev, [field.key]: val }))}
                    onSubmit={(val) => {
                      handleSave(field.key, val);
                      setDraftValues(prev => {
                        const copy = { ...prev };
                        delete copy[field.key];
                        return copy;
                      });
                    }}
                  />
                </Box>
              ) : field.type === 'text' ? (
                <Box flexDirection="row" paddingLeft={2}>
                  <Text color="gray">
                    {field.key.includes('API_KEY') ? '********' : String(tempSettings[field.key] || (field.key.includes('MODEL') && field.key !== 'OLLAMA_MODEL' ? 'Same as main' : ''))}
                  </Text>
                </Box>
              ) : null}

              {field.type === 'boolean' && (
                <Box flexDirection="row" paddingLeft={2}>
                  <Text color={tempSettings[field.key] ? 'green' : 'red'}>
                    {tempSettings[field.key] ? '[ ENABLED ]' : '[ DISABLED ]'}
                  </Text>
                </Box>
              )}
            </Box>
          </Box>
        );
      })}

      {status === 'saved' && (
        <Box marginTop={1}>
          <Text color="green">✓ Settings saved and persisted to .vibes/config.json.</Text>
        </Box>
      )}
    </Box>
  );
};
