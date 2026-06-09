import { useState } from 'react';
import { config, updateConfig, type Config } from '../../config.js';

export function useSettings() {
  const [settings, setSettings] = useState<Config>(config);

  const saveSettings = (newSettings: Partial<Config>) => {
    const updated = { ...settings, ...newSettings };
    setSettings(updated);
    updateConfig(newSettings);
  };

  return {
    settings,
    saveSettings,
  };
}
