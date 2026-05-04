import { Mission, Task, Milestone, OnEvent } from './types.js';
import { TaskExecutor } from './task-executor.js';
import { config } from '../config.js';

export class Scheduler {
  private mission: Mission;
  private executor: TaskExecutor;
  private onEvent?: OnEvent;
  private runningTasks: Set<string> = new Set();
  private completedTasks: Set<string> = new Set();
  private failedTasks: Set<string> = new Set();

  constructor(mission: Mission, executor: TaskExecutor, onEvent?: OnEvent) {
    this.mission = mission;
    this.executor = executor;
    this.onEvent = onEvent;
  }

  async run() {
    this.mission.status = 'executing';
    
    while (this.hasPendingTasks()) {
      const nextTasks = this.getReadyTasks();
      
      if (nextTasks.length === 0 && this.runningTasks.size === 0) {
        // Potential deadlock or all remaining tasks have failed dependencies
        break;
      }

      const availableSlots = config.MAX_CONCURRENT_TASKS - this.runningTasks.size;
      const tasksToStart = nextTasks.slice(0, availableSlots);

      await Promise.all(tasksToStart.map(task => this.executeTask(task)));
      
      // Small delay to prevent tight loop if no tasks are ready
      if (tasksToStart.length === 0) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    this.mission.status = this.failedTasks.size > 0 ? 'failed' : 'completed';
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
      
      // Check dependencies
      return task.depends_on.every(depId => this.completedTasks.has(depId));
    });
  }

  private getAllTasks(): Task[] {
    return this.mission.milestones.flatMap(m => m.tasks);
  }

  private async executeTask(task: Task) {
    this.runningTasks.add(task.id);
    task.status = 'in_progress';

    try {
      const missionContext = `Mission: ${this.mission.title}\nDescription: ${this.mission.description}`;
      const updatedTask = await this.executor.executeTask(task, missionContext, this.mission.workspace_root, this.onEvent);
      
      // Update task in mission structure
      this.updateTaskInMission(updatedTask);

      if (updatedTask.status === 'done') {
        this.completedTasks.add(task.id);
      } else {
        this.failedTasks.add(task.id);
      }
    } catch (error: any) {
      task.status = 'failed';
      task.error = error.message;
      this.failedTasks.add(task.id);
    } finally {
      this.runningTasks.delete(task.id);
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
  }

  // Future: Add method to inject new tasks discovered during execution
  public addTask(milestoneId: string, newTask: Task) {
    const milestone = this.mission.milestones.find(m => m.id === milestoneId);
    if (milestone) {
      milestone.tasks.push(newTask);
    }
  }
}
