export type TaskStatus = "todo" | "completed";
export type TaskListStatus = TaskStatus | "all";

/**
 * scheduledDate and scheduledTime are local wall-clock values without a
 * timezone offset. A task is overdue when it is still "todo" and that local
 * date/time is earlier than the user's current local date/time.
 */
export interface ScheduledTask {
  id: string;
  title: string;
  scheduledDate: string;
  scheduledTime: string;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CreateScheduledTask {
  title: string;
  scheduledDate: string;
  scheduledTime: string;
}

export interface TaskListQuery {
  /**
   * Exact-date compatibility filter. It cannot be combined with from or to.
   */
  date?: string | undefined;
  /**
   * Inclusive lower bound for scheduledDate.
   */
  from?: string | undefined;
  /**
   * Inclusive upper bound for scheduledDate.
   */
  to?: string | undefined;
  /**
   * Defaults to "all" when omitted.
   */
  status?: TaskListStatus | undefined;
}

export interface TaskListResponse {
  items: ScheduledTask[];
}
