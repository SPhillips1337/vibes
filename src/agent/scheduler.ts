import { Mission, Task, OnEvent, TriageAction } from './types.js';
import { TaskExecutor } from './task-executor.js';
import { config } from '../config.js';
import { log } from '../logger.js';
import { InterventionManager } from './intervention-manager.js';
import { getMemoryService } from '../memory/index.js';
import { runStructuralAudit } from './structural-audit.js';
import { TriageAgent } from './triage-agent.js';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const execFileAsync = promisify(execFile);

export type InterventionResolution = {
  action: 'retry' | 'skip' | 'fail' | 'reply';
  message?: string;
  retryFromTaskId?: string;
};

export class Scheduler {
  private _mission: Mission;

  /** Read-only public accessor — use-mission.ts needs the current mission state during event flush. */
  get mission(): Mission { return this._mission; }
  private executor: TaskExecutor;
  private onEvent?: OnEvent;
  private runningTasks: Set<string> = new Set();
  private completedTasks: Set<string> = new Set();
  private failedTasks: Set<string> = new Set();
  private taskMap: Map<string, Task> = new Map();
  private interventionManager = new InterventionManager();

  // Pending intervention: resolve callback waiting for user input
  private interventionResolve: ((res: InterventionResolution) => void) | null = null;
  private getYoloMode: () => boolean;

  triageAgent?: TriageAgent;
  private pendingSteerMessage = '';

  constructor(mission: Mission, executor: TaskExecutor, onEvent?: OnEvent, getYoloMode: () => boolean = () => config.YOLO_MODE) {
    this._mission = mission;
    this.executor = executor;
    this.onEvent = onEvent;
    this.getYoloMode = getYoloMode;
    this.rebuildTaskMap();
  }

  private rebuildTaskMap() {
    this.taskMap.clear();
    this.completedTasks.clear();
    this.failedTasks.clear();
    for (const milestone of this._mission.milestones) {
      for (const task of milestone.tasks) {
        this.taskMap.set(task.id, task);
        if (task.status === 'done') {
          this.completedTasks.add(task.id);
        } else if (task.status === 'failed') {
          this.failedTasks.add(task.id);
        }
      }
    }
  }

  /**
   * Called externally (from the TUI hook) to resolve a pending intervention.
   */
  public resolveIntervention(resolution: InterventionResolution) {
    if (this.interventionResolve) {
      this.interventionResolve(resolution);
      this.interventionResolve = null;
    }
  }

  async run() {
    this._mission.status = 'executing';
    
    while (this.hasPendingTasks()) {
      const currentStatus = this._mission.status as Mission['status'];
      if (currentStatus === 'awaiting_intervention') {
        await new Promise(resolve => setTimeout(resolve, 200));
        continue;
      }

      const nextTasks = this.getReadyTasks();
      const pendingCount = this.getAllTasks().filter(t => t.status === 'todo' || t.status === 'in_progress').length;
      
      log(`Scheduler loop: ${pendingCount} pending, ${nextTasks.length} ready, ${this.runningTasks.size} running`, 'DEBUG');

      if (nextTasks.length === 0 && this.runningTasks.size === 0) {
        log('Scheduler detected deadlock or completion: no ready tasks and nothing running.', 'WARN');
        break;
      }

      const availableSlots = config.MAX_CONCURRENT_TASKS - this.runningTasks.size;
      const tasksToStart = nextTasks.slice(0, availableSlots);

      if (tasksToStart.length > 0) {
        log(`Starting ${tasksToStart.length} tasks...`, 'INFO');
        // Inject any pending steering message into the next task
        if (this.pendingSteerMessage) {
          tasksToStart[0].userGuidance = tasksToStart[0].userGuidance
            ? `${tasksToStart[0].userGuidance}\n\n${this.pendingSteerMessage}`
            : this.pendingSteerMessage;
          this.pendingSteerMessage = '';
        }
        for (const task of tasksToStart) {
          this.executeTask(task); // fire-and-forget, manages itself
        }
      }

      await new Promise(resolve => setTimeout(resolve, 500));
    }

    if (this._mission.status === 'executing' || this._mission.status === 'awaiting_intervention') {
      this._mission.status = this.failedTasks.size > 0 ? 'failed' : 'completed';
      
      // Memento Pattern: Persist mission summary into long-term memory
      if (this._mission.status === 'completed') {
        const completedTaskTitles = this._mission.milestones.flatMap(m => m.tasks).filter(t => t.status === 'done').map(t => t.title);
        getMemoryService().addMissionSummary(this._mission.title, completedTaskTitles).catch(e => log(`Failed to save mission memory: ${e}`, 'DEBUG'));
      }
    }
    return this._mission;
  }

  private hasPendingTasks(): boolean {
    const allTasks = this.getAllTasks();
    return allTasks.some(t => t.status === 'todo' || t.status === 'in_progress');
  }

  private getReadyTasks(): Task[] {
    const allTasks = this.getAllTasks();
    return allTasks.filter(task => {
      if (task.status !== 'todo') return false;
      if (this.runningTasks.has(task.id)) return false;
      return task.depends_on.every(depId => this.completedTasks.has(depId));
    });
  }

  private getAllTasks(): Task[] {
    return Array.from(this.taskMap.values());
  }

  private async runTriageAnalysis() {
    if (!this.triageAgent) return;
    try {
      const action = await this.triageAgent.analyzeBetweenTasks();
      await this.handleTriageAction(action);
    } catch (err: any) {
      log(`Triage analysis error: ${err.message}`, 'WARN');
    }
  }

  private async handleTriageAction(action: TriageAction) {
    switch (action.type) {
      case 'continue':
        break;
      case 'compress':
        log(`Triage: ${action.reason}`, 'INFO');
        break;
      case 'steer':
        log(`Triage: steering next task — ${action.message}`, 'INFO');
        this.pendingSteerMessage = action.message;
        break;
      case 'escalate': {
        log(`Triage: escalation — ${action.reason}`, 'WARN');
        this._mission.status = 'awaiting_intervention';
        this.onEvent?.({
          type: 'intervention_required',
          taskId: this.triageAgent?.currentTaskId || '',
          error: `Triage escalation: ${action.reason}`,
          question: `The triage observer recommends intervention:\n\n${action.reason}\n\nWhat would you like to do?`,
        });
        break;
      }
    }
  }

  private async executeTask(task: Task) {
    this.runningTasks.add(task.id);
    task.status = 'in_progress';
    this.failedTasks.delete(task.id);
    if (this.triageAgent) this.triageAgent.currentTaskId = task.id;

    this.onEvent?.({ type: 'task_started', taskId: task.id, title: task.title });

    try {
      const stackLine = this._mission.tech_stack && this._mission.tech_stack.length > 0
        ? `\nTech Stack: ${this._mission.tech_stack.join(', ')}`
        : '';
      const missionContext = `Mission: ${this._mission.title}\nDescription: ${this._mission.description}${stackLine}`;
      const updatedTask = await this.executor.executeTask(task, missionContext, this._mission.workspace_root, this.onEvent, this.getYoloMode, this._mission.tech_stack);

      this.updateTaskInMission(updatedTask);

      if (updatedTask.status === 'done') {
        // Optional Review Step — only for code tasks
        if (config.ENABLE_REVIEWER && updatedTask.type === 'code') {
          const { Reviewer } = await import('./reviewer.js');
          const reviewer = new Reviewer();
          const review = await reviewer.reviewTask(updatedTask, this._mission);
          
          if (review.approved) {
            log(`Task approved by reviewer: ${updatedTask.title}`, 'INFO');

            // Verification phase — catches orphaned CSS, broken imports, syntax errors, and build failures
            if (!await this.verifyTask(task, updatedTask)) {
              return;
            }

            this.completedTasks.add(task.id);
            this.onEvent?.({ type: 'task_completed', taskId: task.id, title: task.title });
            await this.runTriageAnalysis();
          } else {
            log(`Task REJECTED by reviewer: ${updatedTask.title}. Feedback: ${review.feedback}`, 'WARN');
            if (!updatedTask.userGuidance) {
              // First rejection: auto-retry with reviewer feedback as guidance
              log(`Auto-retrying task with reviewer feedback: ${updatedTask.title}`, 'INFO');
              updatedTask.status = 'todo';
              updatedTask.error = undefined;
              updatedTask.output = undefined;
              updatedTask.userGuidance = `Reviewer feedback: ${review.feedback}\n\n${config.CODEX_ENABLED ? 'Also consult the knowledge base patterns for the correct approach.' : ''}`;
              updatedTask.extraSteps = (updatedTask.extraSteps || 0) + 10;
              this.completedTasks.delete(task.id);
              this.taskMap.set(task.id, updatedTask);
              this.runningTasks.delete(task.id);
              // Main run() loop will pick up the reset task on next tick
              return;
            }
            // Second rejection: escalate to user
            updatedTask.status = 'failed';
            updatedTask.error = `Review Rejected: ${review.feedback}`;
            await this.handleTaskFailure(updatedTask);
          }
        } else {
          if (config.ENABLE_REVIEWER) {
            log(`Skipping review for non-code task (type=${updatedTask.type}): ${updatedTask.title}`, 'INFO');
          }

          // Verification phase (for non-reviewer path)
          if (!await this.verifyTask(task, updatedTask)) {
            return;
          }

          this.completedTasks.add(task.id);
          this.onEvent?.({ type: 'task_completed', taskId: task.id, title: task.title });
          await this.runTriageAnalysis();
        }
      } else {
        await this.handleTaskFailure(updatedTask);
      }
    } catch (error: any) {
      task.status = 'failed';
      task.error = error.message;
      task.userGuidance = undefined;
      await this.handleTaskFailure(task);
    } finally {
      this.runningTasks.delete(task.id);
    }
  }

  private async handleTaskFailure(task: Task) {
    this._mission.status = 'awaiting_intervention';
    log(`Task failed, requesting intervention for: ${task.title}`, 'WARN');

    // Notify listeners about task failure
    this.onEvent?.({
      type: 'task_failed',
      taskId: task.id,
      title: task.title,
      error: task.error || 'Unknown error',
    });

    // Formulate the question (with timeout fallback)
    const question = await this.interventionManager.formulateInterventionQuestion(
      task, this._mission, task.error || 'Unknown error'
    );

    // Wait for the user's response via a Promise
    const resolution = await new Promise<InterventionResolution>((resolve) => {
      this.interventionResolve = resolve;
      this.onEvent?.({
        type: 'intervention_required',
        taskId: task.id,
        error: task.error || 'Unknown error',
        question,
      });
    });

    log(`Intervention resolved: ${resolution.action} ${resolution.message ? `"${resolution.message}"` : ''}`, 'INFO');

    // Apply the resolution directly to the task in our own taskMap
    if (resolution.action === 'fail') {
      this._mission.status = 'failed';
      this.failedTasks.add(task.id);
      this.markDependentsFailed(task.id);
      return;
    }

    if (resolution.action === 'skip') {
      task.status = 'done';
      task.output = '[Skipped by user]';
      this.completedTasks.add(task.id);
      this.onEvent?.({ type: 'task_completed', taskId: task.id, title: task.title });
      this.updateTaskInMission(task);
      this._mission.status = 'executing';
      return;
    }

    // retry or reply — reset target task and all subsequent tasks to todo
    let targetTaskId = resolution.retryFromTaskId || task.id;
    let resetActive = false;
    for (const milestone of this._mission.milestones) {
      for (const t of milestone.tasks) {
        if (t.id === targetTaskId) {
          resetActive = true;
        }
        if (resetActive) {
          t.status = 'todo';
          t.error = undefined;
          t.output = undefined;
          this.completedTasks.delete(t.id);
          this.failedTasks.delete(t.id);
          this.taskMap.set(t.id, t);
        }
      }
    }

    if (resolution.action === 'reply' && resolution.message) {
      task.userGuidance = resolution.message;

      // Memento Pattern: Save user guidance as long-term preference
      getMemoryService().addUserPreference(`Guidance on task "${task.title}": ${resolution.message}`).catch(e => log(`Failed to save memory: ${e}`, 'DEBUG'));

      // Smart step parsing
      let bonusSteps = 10;
      const match = resolution.message.match(/(?:add|increase|give|allow)\s+(\d+)\s+steps?/i);
      if (match) bonusSteps = parseInt(match[1], 10);
      task.extraSteps = (task.extraSteps || 0) + bonusSteps;

      log(`User guidance set: "${task.userGuidance}" | extra steps: ${task.extraSteps}`, 'INFO');
    } else {
      // plain retry — still grant extra steps
      task.extraSteps = (task.extraSteps || 0) + 10;
    }

    this.updateTaskInMission(task);
    this._mission.status = 'executing';

    // Notify the TUI that steps changed so the footer can update
    this.onEvent?.({ type: 'steps_updated', taskId: task.id, extraSteps: task.extraSteps });
  }

  private async verifyTask(task: Task, updatedTask: Task): Promise<boolean> {
    let auditIssuesMessage = '';
    let auditIssuesList: any[] = [];

    if (updatedTask.files.length > 0) {
      if (config.ENABLE_STRUCTURAL_AUDIT) {
        const auditIssues = runStructuralAudit(this._mission.workspace_root, updatedTask.files);
        if (auditIssues.length > 0) {
          auditIssuesList = auditIssues;
          auditIssuesMessage = `Structural audit found issues:\n${auditIssues.map(i => `- [${i.type}] ${i.file}: ${i.message}`).join('\n')}\n\n`;
        }
      }

      const buildErrors = await runBuildCheck(this._mission.workspace_root);
      if (buildErrors.length > 0) {
        auditIssuesMessage += `Build compilation failed with errors:\n${buildErrors.map(e => `- ${e}`).join('\n')}\n\n`;
      }
    }

    if (auditIssuesMessage) {
      log(`Verification failed for task: ${updatedTask.title}`, 'WARN');
      updatedTask.auditIssues = auditIssuesList.length > 0 ? auditIssuesList : undefined;
      updatedTask.status = 'todo';
      updatedTask.error = undefined;
      updatedTask.output = undefined;
      updatedTask.userGuidance = `${auditIssuesMessage}Fix all structural and build compilation issues before completing the task.`;
      updatedTask.extraSteps = (updatedTask.extraSteps || 0) + 10;
      this.completedTasks.delete(task.id);
      this.taskMap.set(task.id, updatedTask);
      this.runningTasks.delete(task.id);
      return false;
    }

    return true;
  }

  private markDependentsFailed(failedTaskId: string) {
    for (const [id, task] of this.taskMap) {
      if (task.depends_on.includes(failedTaskId) && task.status === 'todo') {
        task.status = 'failed';
        task.error = `Dependency ${failedTaskId} failed`;
        this.failedTasks.add(id);
        this.markDependentsFailed(id);
      }
    }
  }

  private updateTaskInMission(updatedTask: Task) {
    for (const milestone of this._mission.milestones) {
      const index = milestone.tasks.findIndex(t => t.id === updatedTask.id);
      if (index !== -1) {
        milestone.tasks[index] = updatedTask;
        break;
      }
    }
    this.taskMap.set(updatedTask.id, updatedTask);
  }

  public addTask(milestoneId: string, newTask: Task) {
    const milestone = this._mission.milestones.find(m => m.id === milestoneId);
    if (milestone) {
      milestone.tasks.push(newTask);
      this.taskMap.set(newTask.id, newTask);
    }
  }
}

// Async build check — uses execFileAsync instead of execSync so the TypeScript
// compile does not block the Node.js event loop (and freeze the TUI) for its
// full duration, which can be several seconds on a large project.
async function runBuildCheck(workspaceRoot: string): Promise<string[]> {
  try {
    const pkgPath = join(workspaceRoot, 'package.json');
    if (!existsSync(pkgPath)) return [];

    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    if (!pkg.scripts || !pkg.scripts.build) return [];

    log('Running workspace build verification check...', 'INFO');
    await execFileAsync('npm', ['run', 'build'], { cwd: workspaceRoot });
    return [];
  } catch (error: any) {
    const stdout = error.stdout ? String(error.stdout) : '';
    const stderr = error.stderr ? String(error.stderr) : '';
    const output = `${stdout}\n${stderr}`;

    const errorLines = output
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.includes('error TS') || line.includes('Error:') || line.includes('Failed to compile') || line.includes('ValidationError'));

    return errorLines.length > 0 ? errorLines.slice(0, 8) : [error.message || 'Build compilation check failed'];
  }
}
