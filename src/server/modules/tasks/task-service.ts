import type {
  CreateScheduledTask,
  ScheduledTask,
  TaskListQuery,
  TaskStatus,
} from "../../../shared/contracts/tasks.js";
import type { TaskRepository } from "./task-repository.js";

export class TaskService {
  public constructor(private readonly repository: TaskRepository) {}

  public list(query: TaskListQuery): ScheduledTask[] {
    return this.repository.list(query);
  }

  public listByDate(scheduledDate: string): ScheduledTask[] {
    return this.repository.listByDate(scheduledDate);
  }

  public create(input: CreateScheduledTask): ScheduledTask {
    return this.repository.create(input);
  }

  public updateStatus(
    id: string,
    status: TaskStatus,
  ): ScheduledTask | null {
    return this.repository.updateStatus(id, status);
  }
}
