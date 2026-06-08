import React from 'react';
import { Box, Text, useInput } from 'ink';
import { TextInput, Select } from '@inkjs/ui';

type SettingsShape = Record<string, string | number | boolean>;

interface SettingsViewProps {
  settings: SettingsShape;
  availableModels: string[];
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
  availableModels,
  onSave,
  onClose,
  onToggleYoloMode,
}) => {
  const [focusIndex, setFocusIndex] = React.useState(0);
  const [tempSettings, setTempSettings] = React.useState(settings);
  const [draftValues, setDraftValues] = React.useState<Record<string, string>>({});
  const [status, setStatus] = React.useState<'idle' | 'saved'>('idle');

  const fields: FieldDefinition[] = [
    { label: 'Ollama Model', key: 'OLLAMA_MODEL', type: 'select' },
    { label: 'Planner Model (empty = same)', key: 'PLANNER_MODEL', type: 'text' },
    { label: 'Base URL', key: 'OLLAMA_BASE_URL', type: 'text' },
    { label: 'API Key', key: 'OLLAMA_API_KEY', type: 'text' },
    { label: 'Context Window', key: 'CONTEXT_WINDOW', type: 'number' },
    { label: 'Max Steps', key: 'MAX_STEPS', type: 'number' },
    { label: 'Reasoning Mode', key: 'THINKING_MODE', type: 'boolean' },
    { label: 'Default YOLO Mode', key: 'YOLO_MODE', type: 'boolean' },
    { label: 'Max Concurrent Tasks', key: 'MAX_CONCURRENT_TASKS', type: 'number' },
    { label: 'Enable Coder-Reviewer Swarm', key: 'ENABLE_REVIEWER', type: 'boolean' },
    { label: 'Reviewer Model', key: 'REVIEWER_MODEL', type: 'select' },
    { label: 'Memory Enabled', key: 'MEMORY_ENABLED', type: 'boolean' },
    { label: 'Local Memory', key: 'LOCAL_MEMORY', type: 'boolean' },
    { label: 'Memory User ID', key: 'MEMORY_USER_ID', type: 'text' },
    { label: 'Triage Observer', key: 'TRIAGE_ENABLED', type: 'boolean' },
    { label: 'Triage Model (empty = same as main)', key: 'TRIAGE_MODEL', type: 'text' },
    { label: 'Triage Interval (tasks)', key: 'TRIAGE_INTERVAL', type: 'number' },
    { label: 'Triage Auto-Steer', key: 'TRIAGE_AUTO_STEER', type: 'boolean' },
  ];

  // Sync tempSettings when the parent settings prop changes.
  React.useEffect(() => {
    setTempSettings(settings);
  }, [settings]);

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

  const modelOptions = availableModels.length > 0
    ? availableModels.map((model) => ({ label: model, value: model }))
    : [{ label: String(settings.OLLAMA_MODEL), value: String(settings.OLLAMA_MODEL) }];

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" padding={1}>
      <Box justifyContent="space-between" marginBottom={1}>
        <Text bold color="cyan">⚙️ SETTINGS</Text>
        <Text color="gray">[Tab] Navigate | [Space/Enter] Toggle | [Alt+S/Esc] Close</Text>
      </Box>

      {fields.map((field, index) => (
        <Box key={field.key} flexDirection="column" marginBottom={1}>
          <Box gap={1}>
            <Text color={focusIndex === index ? 'cyan' : 'white'} bold={focusIndex === index}>
              {focusIndex === index ? '●' : '○'} {field.label}:
            </Text>
          </Box>

          <Box paddingX={1}>
            {field.type === 'select' && focusIndex === index ? (
              <Select
                options={modelOptions}
                defaultValue={String(tempSettings[field.key] ?? '')}
                onChange={(val) => {
                  if (val !== tempSettings[field.key]) {
                    handleSave(field.key, val);
                  }
                }}
              />
            ) : field.type === 'select' ? (
              <Text color="gray">{String(tempSettings[field.key] ?? '')}</Text>
            ) : null}

            {field.type === 'number' && focusIndex === index ? (
              <Box borderStyle="single" borderColor="cyan" paddingX={1}>
                <TextInput
                  defaultValue={String(tempSettings[field.key] ?? '')}
                  onChange={(val) => setDraftValues(prev => ({ ...prev, [field.key]: val }))}
                  onSubmit={(val) => handleSave(field.key, Number(val))}
                />
              </Box>
            ) : field.type === 'number' ? (
              <Text color="gray">{String(tempSettings[field.key] ?? '')}</Text>
            ) : null}

            {field.type === 'text' && focusIndex === index ? (
              <Box borderStyle="single" borderColor="cyan" paddingX={1}>
                <TextInput
                  defaultValue={String(tempSettings[field.key] ?? '')}
                  onChange={(val) => setDraftValues(prev => ({ ...prev, [field.key]: val }))}
                  onSubmit={(val) => handleSave(field.key, val)}
                />
              </Box>
            ) : field.type === 'text' ? (
              <Text color="gray">
                {field.key === 'OLLAMA_API_KEY' ? '********' : String(tempSettings[field.key] ?? '')}
              </Text>
            ) : null}

            {field.type === 'boolean' && (
              <Text color={tempSettings[field.key] ? 'green' : 'red'}>
                {tempSettings[field.key] ? '[ ENABLED ]' : '[ DISABLED ]'}
              </Text>
            )}
          </Box>
        </Box>
      ))}

      {status === 'saved' && (
        <Box marginTop={1}>
          <Text color="green">✓ Settings saved and persisted to .vibes/config.json.</Text>
        </Box>
      )}
    </Box>
  );
};
