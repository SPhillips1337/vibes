import { useState, useEffect } from 'react';
import { config, updateConfig, type Config } from '../../config.js';
import { listModels } from '../../ollama-client.js';

export function useSettings() {
  const [settings, setSettings] = useState<Config>(config);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [availablePlannerModels, setAvailablePlannerModels] = useState<string[]>([]);
  const [availableReviewerModels, setAvailableReviewerModels] = useState<string[]>([]);
  const [availableTriageModels, setAvailableTriageModels] = useState<string[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(false);

  useEffect(() => {
    async function fetchModels() {
      setIsLoadingModels(true);
      const [main, planner, reviewer, triage] = await Promise.all([
        listModels(settings.OLLAMA_BASE_URL, settings.OLLAMA_API_KEY),
        settings.PLANNER_BASE_URL ? listModels(settings.PLANNER_BASE_URL, settings.PLANNER_API_KEY) : listModels(settings.OLLAMA_BASE_URL, settings.OLLAMA_API_KEY),
        settings.REVIEWER_BASE_URL ? listModels(settings.REVIEWER_BASE_URL, settings.REVIEWER_API_KEY) : listModels(settings.OLLAMA_BASE_URL, settings.OLLAMA_API_KEY),
        settings.TRIAGE_BASE_URL ? listModels(settings.TRIAGE_BASE_URL, settings.TRIAGE_API_KEY) : listModels(settings.OLLAMA_BASE_URL, settings.OLLAMA_API_KEY)
      ]);
      setAvailableModels(main);
      setAvailablePlannerModels(planner);
      setAvailableReviewerModels(reviewer);
      setAvailableTriageModels(triage);
      setIsLoadingModels(false);
    }
    fetchModels();
  }, [
    settings.OLLAMA_BASE_URL, settings.OLLAMA_API_KEY,
    settings.PLANNER_BASE_URL, settings.PLANNER_API_KEY,
    settings.REVIEWER_BASE_URL, settings.REVIEWER_API_KEY,
    settings.TRIAGE_BASE_URL, settings.TRIAGE_API_KEY
  ]);

  const saveSettings = (newSettings: Partial<Config>) => {
    const updated = { ...settings, ...newSettings };
    setSettings(updated);
    updateConfig(newSettings);
  };

  return {
    settings,
    availableModels,
    availablePlannerModels,
    availableReviewerModels,
    availableTriageModels,
    isLoadingModels,
    saveSettings,
  };
}
