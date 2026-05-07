import { useState, useEffect } from 'react';
import { config, updateConfig, type Config } from '../../config.js';
import { listModels } from '../../ollama-client.js';

export function useSettings() {
  const [settings, setSettings] = useState<Config>(config);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(false);

  useEffect(() => {
    async function fetchModels() {
      setIsLoadingModels(true);
      const models = await listModels();
      setAvailableModels(models);
      setIsLoadingModels(false);
    }
    fetchModels();
  }, []);

  const saveSettings = (newSettings: Partial<Config>) => {
    const updated = { ...settings, ...newSettings };
    setSettings(updated);
    updateConfig(newSettings);
  };

  return {
    settings,
    availableModels,
    isLoadingModels,
    saveSettings,
  };
}
