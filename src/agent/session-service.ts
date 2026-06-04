import fs from 'fs/promises';
import path from 'path';
import { Mission, ExecutionEvent, CompactionDetails } from './types.js';
import { log } from '../logger.js';

export interface SessionData {
  mission: Mission;
  events: ExecutionEvent[];
  compactionDetails: CompactionDetails;
  updatedAt: string;
}

export class SessionService {
  private sessionsDir: string;
  private writeQueues = new Map<string, Promise<void>>();

  constructor(workspaceRoot: string = process.cwd()) {
    this.sessionsDir = path.join(workspaceRoot, '.vibes', 'sessions');
  }

  private async ensureDir() {
    try {
      await fs.mkdir(this.sessionsDir, { recursive: true });
    } catch (err) {
      // Ignore if exists
    }
  }

  /**
   * Saves a mission and its event history to disk.
   */
  async saveSession(mission: Mission, events: ExecutionEvent[], compactionDetails?: CompactionDetails) {
    const queue = this.writeQueues.get(mission.id) || Promise.resolve();

    const nextWrite = queue.then(async () => {
      await this.ensureDir();
      const sessionPath = path.join(this.sessionsDir, `${mission.id}.json`);
      const data: SessionData = {
        mission,
        events,
        compactionDetails: compactionDetails ?? { readFiles: [], modifiedFiles: [] },
        updatedAt: new Date().toISOString(),
      };

      try {
        const tempPath = `${sessionPath}.tmp`;
        await fs.writeFile(tempPath, JSON.stringify(data, null, 2), 'utf8');
        await fs.rename(tempPath, sessionPath);
      } catch (err: any) {
        log(`Failed to save session ${mission.id}: ${err.message}`, 'ERROR');
      }
    }).finally(() => {
      if (this.writeQueues.get(mission.id) === nextWrite) {
        this.writeQueues.delete(mission.id);
      }
    });

    this.writeQueues.set(mission.id, nextWrite);
    await nextWrite;
  }

  /**
   * Lists all saved sessions, sorted by most recent.
   */
  async listSessions(): Promise<SessionData[]> {
    await this.ensureDir();
    try {
      const files = await fs.readdir(this.sessionsDir);
      const sessions: SessionData[] = [];
      
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        
        try {
          const content = await fs.readFile(path.join(this.sessionsDir, file), 'utf8');
          sessions.push(JSON.parse(content));
        } catch (err) {
          log(`Failed to read session file ${file}: ${err instanceof Error ? err.message : String(err)}`, 'DEBUG');
        }
      }
      
      return sessions.sort((a, b) => 
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      );
    } catch (err) {
      return [];
    }
  }

  /**
   * Retrieves a specific session by ID.
   */
  async getSession(id: string): Promise<SessionData | null> {
    const sessionPath = path.join(this.sessionsDir, `${id}.json`);
    try {
      const content = await fs.readFile(sessionPath, 'utf8');
      return JSON.parse(content);
    } catch (err) {
      return null;
    }
  }

  /**
   * Deletes a session by ID.
   */
  async deleteSession(id: string) {
    const sessionPath = path.join(this.sessionsDir, `${id}.json`);
    try {
      await fs.unlink(sessionPath);
    } catch (err) {
      // Ignore
    }
  }

  /**
   * Cleans up old sessions, keeping only the last N.
   */
  async pruneSessions(keepCount: number = 20) {
    const sessions = await this.listSessions();
    if (sessions.length <= keepCount) return;

    const toDelete = sessions.slice(keepCount);
    for (const session of toDelete) {
      await this.deleteSession(session.mission.id);
    }
    log(`Pruned ${toDelete.length} old sessions`, 'INFO');
  }
}

let globalSessionService: SessionService | null = null;

export function getSessionService(workspaceRoot?: string): SessionService {
  if (!globalSessionService || workspaceRoot) {
    globalSessionService = new SessionService(workspaceRoot);
  }
  return globalSessionService;
}
