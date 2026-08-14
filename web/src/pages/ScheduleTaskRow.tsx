import { Check } from "lucide-react";

import type { ScheduledTask } from "../../shared/contracts/tasks";
import { formatLongDate, isTaskOverdue } from "./schedule-utils";

export function TaskRow({
  task,
  now,
  updating,
  onToggle,
}: {
  task: ScheduledTask;
  now: Date;
  updating: boolean;
  onToggle: (task: ScheduledTask) => void;
}): React.JSX.Element {
  const overdue = isTaskOverdue(task, now);
  const completed = task.status === "completed";

  return (
    <li
      className="schedule-workspace-task"
      data-completed={completed ? "true" : "false"}
      data-overdue={overdue ? "true" : "false"}
    >
      <time
        className="schedule-workspace-task-time"
        dateTime={`${task.scheduledDate}T${task.scheduledTime}`}
      >
        {task.scheduledTime}
      </time>

      <div className="schedule-workspace-task-copy">
        <strong className={completed ? "line-through" : ""}>{task.title}</strong>
        <span>{formatLongDate(task.scheduledDate)}</span>
      </div>

      <span
        className={`schedule-workspace-task-status badge badge-sm ${
          overdue
            ? "badge-error"
            : completed
              ? "badge-ghost"
              : "badge-outline"
        }`}
      >
        {overdue ? "已逾期" : completed ? "已完成" : "待处理"}
      </span>

      <button
        className="schedule-workspace-task-toggle"
        type="button"
        aria-label={`${completed ? "恢复为待办" : "标记为完成"}：${task.title}`}
        aria-pressed={completed}
        aria-busy={updating}
        data-completed={completed ? "true" : "false"}
        disabled={updating}
        onClick={() => onToggle(task)}
      >
        {updating ? (
          <span
            className="loading loading-spinner loading-xs"
            aria-hidden="true"
          />
        ) : (
          <Check size={15} aria-hidden="true" />
        )}
        <span>{updating ? "处理中" : completed ? "恢复" : "完成"}</span>
      </button>
    </li>
  );
}

export function CompactTask({
  task,
  now,
  updating,
  onToggle,
}: {
  task: ScheduledTask;
  now: Date;
  updating: boolean;
  onToggle: (task: ScheduledTask) => void;
}): React.JSX.Element {
  const overdue = isTaskOverdue(task, now);
  const completed = task.status === "completed";

  return (
    <li
      className="schedule-workspace-compact-task"
      data-completed={completed ? "true" : "false"}
      data-overdue={overdue ? "true" : "false"}
    >
      <time dateTime={`${task.scheduledDate}T${task.scheduledTime}`}>
        {task.scheduledTime}
      </time>
      <span className={completed ? "line-through opacity-50" : ""}>
        {task.title}
      </span>
      {overdue && (
        <span className="badge badge-error badge-xs" aria-label="已逾期">
          逾期
        </span>
      )}
      <button
        className="btn btn-circle btn-ghost btn-xs"
        type="button"
        aria-label={`${completed ? "恢复为待办" : "标记为完成"}：${task.title}`}
        aria-pressed={completed}
        disabled={updating}
        onClick={() => onToggle(task)}
      >
        {updating ? (
          <span className="loading loading-spinner loading-xs" />
        ) : (
          <Check size={12} />
        )}
      </button>
    </li>
  );
}
