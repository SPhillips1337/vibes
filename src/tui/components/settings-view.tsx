import React from 'react';
import { Box, Text, useInput } from 'ink';
import { TextInput, Select } from '@inkjs/ui';
import { type Config } from '../../config.js';

interface SettingsViewProps {
  settings: Config;
  availableModels: string[];
  onSave: (settings: Partial<Config>) => void;
  onClose: () => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  settings,
  availableModels,
  onSave,
  onClose,
}) => {
  const [focusIndex, setFocusIndex] = React.useState(0);
  const [tempSettings, setTempSettings] = React.useState<Config>(settings);
  const [status, setStatus] = React.useState<'idle' | 'saved'>('idle');

  const fields = [
    { label: 'Ollama Model', key: 'OLLAMA_MODEL', type: 'select' },
    { label: 'Base URL', key: 'OLLAMA_BASE_URL', type: 'text' },
    { label: 'API Key', key: 'OLLAMA_API_KEY', type: 'text' },
    { label: 'Context Window', key: 'CONTEXT_WINDOW', type: 'number' },
    { label: 'Max Steps', key: 'MAX_STEPS', type: 'number' },
    { label: 'Max Concurrent Tasks', key: 'MAX_CONCURRENT_TASKS', type: 'number' },
    { label: 'Enable Coder-Reviewer Swarm', key: 'ENABLE_REVIEWER', type: 'boolean' },
    { label: 'Reviewer Model', key: 'REVIEWER_MODEL', type: 'select' },
  ];

  useInput((input, key) => {
    if (key.escape || (key.meta && input === 's')) {
      onClose();
    }
    if (key.tab) {
      setFocusIndex((prev) => (prev + 1) % fields.length);
      setStatus('idle');
    }
    if (key.shift && key.tab) {
      setFocusIndex((prev) => (prev - 1 + fields.length) % fields.length);
      setStatus('idle');
    }
    if (focusIndex === 4 && (input === ' ' || key.return)) { // Enable/Disable toggle
      const newVal = !tempSettings.ENABLE_REVIEWER;
      handleSave('ENABLE_REVIEWER', newVal);
    }
  });

  const handleSave = (key: keyof Config, value: any) => {
    const updated = { ...tempSettings, [key]: value };
    setTempSettings(updated);
    onSave({ [key]: value });
    setStatus('saved');
  };

  const modelOptions = availableModels.length > 0 
    ? availableModels.map(m => ({ label: m, value: m }))
    : [{ label: settings.OLLAMA_MODEL, value: settings.OLLAMA_MODEL }];

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
                defaultValue={tempSettings[field.key as keyof Config] as string}
                onChange={(val) => handleSave(field.key as keyof Config, val)}
              />
            ) : field.type === 'select' ? (
              <Text color="gray">{tempSettings[field.key as keyof Config]}</Text>
            ) : null}

            {field.type === 'number' && focusIndex === index ? (
              <Box borderStyle="single" borderColor="cyan" paddingX={1}>
                <TextInput
                  defaultValue={String(tempSettings[field.key as keyof Config])}
                  onSubmit={(val) => handleSave(field.key as keyof Config, Number(val))}
                />
              </Box>
            ) : field.type === 'number' ? (
              <Text color="gray">{tempSettings[field.key as keyof Config]}</Text>
            ) : null}

            {field.type === 'text' && focusIndex === index ? (
              <Box borderStyle="single" borderColor="cyan" paddingX={1}>
                <TextInput
                  defaultValue={String(tempSettings[field.key as keyof Config])}
                  onSubmit={(val) => handleSave(field.key as keyof Config, val)}
                />
              </Box>
            ) : field.type === 'text' ? (
              <Text color="gray">{field.key === 'OLLAMA_API_KEY' ? '********' : tempSettings[field.key as keyof Config]}</Text>
            ) : null}

            {field.type === 'boolean' && (
              <Text color={tempSettings[field.key as keyof Config] ? 'green' : 'red'}>
                {tempSettings[field.key as keyof Config] ? '[ ENABLED ]' : '[ DISABLED ]'}
              </Text>
            )}
          </Box>
        </Box>
      ))}

      {status === 'saved' && (
        <Box marginTop={1}>
          <Text color="green">✓ Settings saved and persisted.</Text>
        </Box>
      )}
    </Box>
  );
};
