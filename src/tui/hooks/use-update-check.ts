import { useState, useEffect, useCallback, useRef } from 'react';
import { exec } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const NPM_PACKAGE_NAME = '@google/gemini-cli';
const CHECK_INTERVAL_MS = 15 * 60 * 1000; // Check every 15 minutes
const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

export interface UpdateInfo {
  available: boolean;
  localVersion: string;
  remoteVersion: string;
  remoteDate?: string;
}

export type UpdateStatus = 'idle' | 'checking' | 'updating' | 'success' | 'error';

export function useUpdateCheck() {
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [status, setStatus] = useState<UpdateStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [updateLog, setUpdateLog] = useState<string[]>([]);
  const checkTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const getLocalVersion = useCallback((): string | null => {
    try {
      const packageJsonPath = path.join(PACKAGE_ROOT, 'package.json');
      if (fs.existsSync(packageJsonPath)) {
        const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
        return pkg.version;
      }
    } catch {
      // Ignore
    }
    return null;
  }, []);

  const checkForUpdates = useCallback(async () => {
    if (status === 'updating') return;

    setStatus('checking');
    setError(null);

    try {
      const localVersion = getLocalVersion();
      if (!localVersion) {
        setStatus('idle');
        return;
      }

      // Query npm registry for the package version
      const response = await fetch(`https://registry.npmjs.org/${NPM_PACKAGE_NAME}/latest`);
      
      if (!response.ok) {
        setStatus('idle');
        return;
      }

      const data = await response.json();
      const remoteVersion = data.version as string;

      // Simple version comparison (only flags if remote is strictly greater)
      // This ignores downgrades and pre-release parsing, but works for standard semver.
      if (remoteVersion && remoteVersion !== localVersion) {
        const localParts = localVersion.split('.').map(Number);
        const remoteParts = remoteVersion.split('.').map(Number);
        
        let isNewer = false;
        for (let i = 0; i < 3; i++) {
          const l = localParts[i] || 0;
          const r = remoteParts[i] || 0;
          if (r > l) {
            isNewer = true;
            break;
          } else if (r < l) {
            break;
          }
        }

        if (isNewer) {
          setUpdateInfo({
            available: true,
            localVersion,
            remoteVersion,
          });
          setDismissed(false);
        } else {
          setUpdateInfo(null);
        }
      } else {
        setUpdateInfo(null);
      }

      setStatus('idle');
    } catch (err) {
      // Network errors are non-fatal
      setStatus('idle');
    }
  }, [getLocalVersion, status]);

  const performUpdate = useCallback(() => {
    setStatus('updating');
    setError(null);
    setUpdateLog([]);

    const addLog = (line: string) => {
      setUpdateLog(prev => [...prev, line]);
    };

    addLog(`📥 Installing latest version of ${NPM_PACKAGE_NAME} globally...`);

    const updateProcess = exec(
      `npm install -g ${NPM_PACKAGE_NAME}@latest 2>&1`,
      { encoding: 'utf-8' }
    );

    let updateOutput = '';
    updateProcess.stdout?.on('data', (chunk: string) => {
      updateOutput += chunk;
    });

    updateProcess.on('close', (code) => {
      if (code !== 0) {
        addLog(`❌ npm install failed (exit code ${code})`);
        if (updateOutput) addLog(updateOutput.trim());
        setError('Global npm update failed. Check the log above for details or run the command manually.');
        setStatus('error');
        return;
      }

      addLog('✅ Update complete');
      addLog(updateOutput.trim());
      addLog('🎉 Update successful! Please restart the CLI to use the new version.');
      setUpdateInfo(null);
      setStatus('success');
    });
  }, []);

  const dismiss = useCallback(() => {
    setDismissed(true);
  }, []);

  const resetStatus = useCallback(() => {
    setStatus('idle');
    setError(null);
    setUpdateLog([]);
  }, []);

  useEffect(() => {
    // Delay first check by 5 seconds
    const initialTimeout = setTimeout(() => {
      checkForUpdates();
    }, 5000);

    checkTimerRef.current = setInterval(checkForUpdates, CHECK_INTERVAL_MS);

    return () => {
      clearTimeout(initialTimeout);
      if (checkTimerRef.current) {
        clearInterval(checkTimerRef.current);
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    updateInfo,
    status,
    error,
    dismissed,
    updateLog,
    checkForUpdates,
    performUpdate,
    dismiss,
    resetStatus,
  };
}
