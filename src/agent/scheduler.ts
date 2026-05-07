import { Mission, Task, OnEvent } from './types.js';
import { TaskExecutor } from './task-executor.js';
import { config } from '../config.js';
import { log } from '../logger.js';
import { InterventionManager } from './intervention-manager.js';

export type InterventionResolution = {
  action: 'retry' | 'skip' | 'fail' | 'reply';
  message?: string;
};

export class Scheduler {
  private mission: Mission;
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

  constructor(mission: Mission, executor: TaskExecutor, onEvent?: OnEvent, getYoloMode: () => boolean = () => false) {
    this.mission = mission;
    this.executor = executor;
    this.onEvent = onEvent;
    this.getYoloMode = getYoloMode;
    this.rebuildTaskMap();
  }

  private rebuildTaskMap() {
    this.taskMap.clear();
    for (const milestone of this.mission.milestones) {
      for (const task of milestone.tasks) {
        this.taskMap.set(task.id, task);
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
    this.mission.status = 'executing';
    
    while (this.hasPendingTasks()) {
      const currentStatus = this.mission.status as Mission['status'];
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
        for (const task of tasksToStart) {
          this.executeTask(task); // fire-and-forget, manages itself
        }
      }
      
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    if (this.mission.status === 'executing' || this.mission.status === 'awaiting_intervention') {
      this.mission.status = this.failedTasks.size > 0 ? 'failed' : 'completed';
    }
    return this.mission;
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

  private async executeTask(task: Task) {
    this.runningTasks.add(task.id);
    task.status = 'in_progress';
    this.failedTasks.delete(task.id);

    try {
      const missionContext = `Mission: ${this.mission.title}\nDescription: ${this.mission.description}`;
      const updatedTask = await this.executor.executeTask(task, missionContext, this.mission.workspace_root, this.onEvent, this.getYoloMode);
      
      updatedTask.userGuidance = undefined;
      this.updateTaskInMission(updatedTask);

      if (updatedTask.status === 'done') {
        // Optional Review Step
        const { Reviewer } = await import('./reviewer.js');
        const reviewer = new Reviewer();
        const review = await reviewer.reviewTask(updatedTask, this.mission);
        
        if (review.approved) {
          log(`Task approved by reviewer: ${updatedTask.title}`, 'INFO');
          this.completedTasks.add(task.id);
        } else {
          log(`Task REJECTED by reviewer: ${updatedTask.title}. Feedback: ${review.feedback}`, 'WARN');
          updatedTask.status = 'failed';
          updatedTask.error = `Review Rejected: ${review.feedback}`;
          await this.handleTaskFailure(updatedTask);
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
    this.mission.status = 'awaiting_intervention';
    log(`Task failed, requesting intervention for: ${task.title}`, 'WARN');

    // Formulate the question (with timeout fallback)
    const question = await this.interventionManager.formulateInterventionQuestion(
      task, this.mission, task.error || 'Unknown error'
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
      this.mission.status = 'failed';
      this.failedTasks.add(task.id);
      this.markDependentsFailed(task.id);
      return;
    }

    if (resolution.action === 'skip') {
      task.status = 'done';
      task.output = '[Skipped by user]';
      this.completedTasks.add(task.id);
      this.updateTaskInMission(task);
      this.mission.status = 'executing';
      return;
    }

    // retry or reply — reset task and apply extra steps/guidance directly
    task.status = 'todo';
    task.error = undefined;
    this.failedTasks.delete(task.id);

    if (resolution.action === 'reply' && resolution.message) {
      task.userGuidance = resolution.message;

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
    this.mission.status = 'executing';

    // Notify the TUI that steps changed so the footer can update
    this.onEvent?.({ type: 'steps_updated', taskId: task.id, extraSteps: task.extraSteps });
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
    for (const milestone of this.mission.milestones) {
      const index = milestone.tasks.findIndex(t => t.id === updatedTask.id);
      if (index !== -1) {
        milestone.tasks[index] = updatedTask;
        break;
      }
    }
    this.taskMap.set(updatedTask.id, updatedTask);
  }

  public addTask(milestoneId: string, newTask: Task) {
    const milestone = this.mission.milestones.find(m => m.id === milestoneId);
    if (milestone) {
      milestone.tasks.push(newTask);
      this.taskMap.set(newTask.id, newTask);
    }
  }
}
