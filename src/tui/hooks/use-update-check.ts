import { useState, useEffect, useCallback, useRef } from 'react';
import { execSync, exec } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const GITHUB_REPO = 'SPhillips1337/vibes';
const GITHUB_BRANCH = 'main';
const CHECK_INTERVAL_MS = 5 * 60 * 1000; // Check every 5 minutes
const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

function isSourceCheckout(): boolean {
  if (!existsSync(path.join(PACKAGE_ROOT, '.git'))) return false;
  try {
    const remote = execSync('git remote get-url origin', {
      cwd: PACKAGE_ROOT,
      encoding: 'utf-8',
    }).trim().toLowerCase();
    return remote.includes('sphillips1337/vibes');
  } catch {
    return false;
  }
}

export interface UpdateInfo {
  available: boolean;
  localCommit: string;
  remoteCommit: string;
  remoteMessage: string;
  remoteAuthor: string;
  remoteDate: string;
  commitsBehind: number;
}

export type UpdateStatus = 'idle' | 'checking' | 'updating' | 'success' | 'error';

export function useUpdateCheck() {
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [status, setStatus] = useState<UpdateStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [updateLog, setUpdateLog] = useState<string[]>([]);
  const checkTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const getLocalHead = useCallback((): string | null => {
    if (!isSourceCheckout()) return null;
    try {
      return execSync('git rev-parse HEAD', {
        cwd: PACKAGE_ROOT,
        encoding: 'utf-8',
      }).trim();
    } catch {
      return null;
    }
  }, []);

  const checkForUpdates = useCallback(async () => {
    if (status === 'updating') return; // Don't check while updating

    setStatus('checking');
    setError(null);

    try {
      const localCommit = getLocalHead();
      if (!localCommit) {
        setStatus('idle');
        return;
      }

      // Use GitHub API to get latest commit on main
      const response = await fetch(
        `https://api.github.com/repos/${GITHUB_REPO}/commits/${GITHUB_BRANCH}`,
        {
          headers: {
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'vibes-tui-update-checker',
          },
        }
      );

      if (!response.ok) {
        // Rate limited or network error — silently ignore
        setStatus('idle');
        return;
      }

      const data = await response.json();
      const remoteCommit = data.sha as string;

      if (remoteCommit && remoteCommit !== localCommit && !remoteCommit.startsWith(localCommit)) {
        // Fetch the compare endpoint to see how many commits behind
        let commitsBehind = 1;
        try {
          const compareRes = await fetch(
            `https://api.github.com/repos/${GITHUB_REPO}/compare/${localCommit.substring(0, 7)}...${remoteCommit.substring(0, 7)}`,
            {
              headers: {
                'Accept': 'application/vnd.github.v3+json',
                'User-Agent': 'vibes-tui-update-checker',
              },
            }
          );
          if (compareRes.ok) {
            const compareData = await compareRes.json();
            commitsBehind = compareData.ahead_by || 1;
          }
        } catch {
          // Compare failed, just show 1
        }

        setUpdateInfo({
          available: true,
          localCommit: localCommit.substring(0, 7),
          remoteCommit: remoteCommit.substring(0, 7),
          remoteMessage: data.commit?.message?.split('\n')[0] || 'New update available',
          remoteAuthor: data.commit?.author?.name || 'Unknown',
          remoteDate: data.commit?.author?.date || '',
          commitsBehind,
        });
        setDismissed(false);
      } else {
        setUpdateInfo(null);
      }

      setStatus('idle');
    } catch (err) {
      // Network errors are non-fatal — just go back to idle
      setStatus('idle');
    }
  }, [getLocalHead, status]);

  const performUpdate = useCallback(() => {
    setStatus('updating');
    setError(null);
    setUpdateLog([]);

    const addLog = (line: string) => {
      setUpdateLog(prev => [...prev, line]);
    };

    addLog('📥 Pulling latest changes from origin/main...');

    // Run git pull, npm install, npm run build sequentially
    const pullProcess = exec(
      'git pull origin main 2>&1',
      { cwd: PACKAGE_ROOT, encoding: 'utf-8' }
    );

    let pullOutput = '';
    pullProcess.stdout?.on('data', (chunk: string) => {
      pullOutput += chunk;
    });

    pullProcess.on('close', (code) => {
      if (code !== 0) {
        addLog(`❌ Git pull failed (exit code ${code})`);
        if (pullOutput) addLog(pullOutput.trim());
        setError('Git pull failed. You may have local changes — try stashing them first.');
        setStatus('error');
        return;
      }

      addLog('✅ Git pull complete');
      addLog(pullOutput.trim());
      addLog('📦 Installing dependencies...');

      const installProcess = exec(
        'npm install 2>&1',
        { cwd: PACKAGE_ROOT, encoding: 'utf-8' }
      );

      let installOutput = '';
      installProcess.stdout?.on('data', (chunk: string) => {
        installOutput += chunk;
      });

      installProcess.on('close', (installCode) => {
        if (installCode !== 0) {
          addLog(`❌ npm install failed (exit code ${installCode})`);
          if (installOutput) addLog(installOutput.trim());
          setError('npm install failed. Check the log above for details.');
          setStatus('error');
          return;
        }

        addLog('✅ Dependencies installed');
        addLog('🔨 Building project...');

        const buildProcess = exec(
          'npm run build 2>&1',
          { cwd: PACKAGE_ROOT, encoding: 'utf-8' }
        );

        let buildOutput = '';
        buildProcess.stdout?.on('data', (chunk: string) => {
          buildOutput += chunk;
        });

        buildProcess.on('close', (buildCode) => {
          if (buildCode !== 0) {
            addLog(`❌ Build failed (exit code ${buildCode})`);
            if (buildOutput) addLog(buildOutput.trim());
            setError('Build failed. Check the log above for details.');
            setStatus('error');
            return;
          }

          addLog('✅ Build complete');
          addLog('🎉 Update successful! Restart the app to use the new version.');
          setUpdateInfo(null);
          setStatus('success');
        });
      });
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

  // Initial check on mount + periodic checks
  useEffect(() => {
    // Delay first check by 3 seconds to let the TUI render first
    const initialTimeout = setTimeout(() => {
      checkForUpdates();
    }, 3000);

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
