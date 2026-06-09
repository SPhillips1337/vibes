import React from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import { EnhancedTextInput } from './enhanced-text-input.js';

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

const FIELDS: FieldDefinition[] = [
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

const SETTINGS_CHROME_ROWS = 15;

export function getSettingsViewportSize(terminalRows: number): number {
  return Math.max(1, Math.min(FIELDS.length, terminalRows - SETTINGS_CHROME_ROWS));
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
  const draftValuesRef = React.useRef<Record<string, string>>({});
  const [status, setStatus] = React.useState<'idle' | 'saved'>('idle');

  // Removed the auto-sync useEffect that forces tempSettings to reset 
  // on every keystroke save, causing the draft input state to jump.

  const handleSave = (key: keyof SettingsShape, value: SettingsShape[keyof SettingsShape]) => {
    const updated = { ...tempSettings, [key]: value };
    setTempSettings(updated);
    onSave({ [key]: value });
    setStatus('saved');
  };

  const saveCurrentDraft = () => {
    const currentField = FIELDS[focusIndex];
    if (!currentField || (currentField.type !== 'text' && currentField.type !== 'number')) return;
    const draft = draftValuesRef.current[currentField.key];
    if (draft === undefined || draft === String(tempSettings[currentField.key] ?? '')) return;
    const parsed = currentField.type === 'number' ? Number(draft) : draft;
    handleSave(currentField.key, parsed);
    delete draftValuesRef.current[currentField.key];
  };

  useInput((input, pressedKey) => {
    if (pressedKey.escape || (pressedKey.meta && input === 's')) {
      onClose();
      return;
    }

    if (pressedKey.tab && !pressedKey.shift) {
      saveCurrentDraft();
      setFocusIndex((prev) => (prev + 1) % FIELDS.length);
      setStatus('idle');
    }

    if (pressedKey.shift && pressedKey.tab) {
      saveCurrentDraft();
      setFocusIndex((prev) => (prev - 1 + FIELDS.length) % FIELDS.length);
      setStatus('idle');
    }

    const currentField = FIELDS[focusIndex];
    if (currentField?.type === 'boolean' && (input === ' ' || pressedKey.return)) {
      const fieldKey = currentField.key;
      const newVal = !Boolean(tempSettings[fieldKey]);
      handleSave(fieldKey, newVal);
      if (fieldKey === 'YOLO_MODE' && typeof onToggleYoloMode === 'function') {
        onToggleYoloMode(newVal);
      }
    }
  });

  const maxVisible = getSettingsViewportSize(stdout.rows || 24);
  const inputWidth = Math.max(8, (stdout.columns || 80) - 35);
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

      {FIELDS.map((field, index) => {
        if (index < startIdx || index >= startIdx + maxVisible) return null;

        const isFocused = focusIndex === index;
        const currentValue = String(tempSettings[field.key] ?? '');

        return (
          <Box key={field.key}>
            <Box width={31}>
              <Text color={isFocused ? 'cyan' : 'white'} bold={isFocused}>
                {isFocused ? '●' : '○'} {field.label}:
              </Text>
            </Box>

            <Box flexGrow={1}>
              {(field.type === 'text' || field.type === 'number') && isFocused ? (
                <Box flexDirection="row">
                  <Text color="cyan">❯ </Text>
                  <EnhancedTextInput
                    defaultValue={currentValue}
                    maxWidth={inputWidth}
                    onChange={(value) => {
                      draftValuesRef.current[field.key] = value;
                    }}
                    onSubmit={(val) => {
                      handleSave(field.key, field.type === 'number' ? Number(val) : val);
                      delete draftValuesRef.current[field.key];
                    }}
                  />
                </Box>
              ) : field.type === 'text' ? (
                <Box>
                  <Text color="gray">
                    {field.key.includes('API_KEY')
                      ? '********'
                      : currentValue || (field.key.includes('MODEL') && field.key !== 'OLLAMA_MODEL' ? 'Same as main' : '')}
                  </Text>
                </Box>
              ) : field.type === 'number' ? (
                <Text color="gray">{currentValue}</Text>
              ) : (
                <Box>
                  <Text color={tempSettings[field.key] ? 'green' : 'red'}>
                    {tempSettings[field.key] ? '[ ENABLED ]' : '[ DISABLED ]'}
                  </Text>
                </Box>
              )}
            </Box>
          </Box>
        );
      })}

      <Box marginTop={1} height={1}>
        <Text color={status === 'saved' ? 'green' : undefined}>
          {status === 'saved' ? '✓ Settings saved and persisted to .vibes/config.json.' : ' '}
        </Text>
      </Box>
    </Box>
  );
};
