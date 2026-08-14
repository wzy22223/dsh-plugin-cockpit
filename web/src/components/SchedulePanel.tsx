import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Plus,
  RefreshCw,
} from "lucide-react";
import type { ScheduledTask } from "../../shared/contracts/tasks";

function formatAgendaDate(dateKey: string): {
  day: string;
  month: string;
  weekday: string;
} {
  const date = new Date(`${dateKey}T12:00:00`);
  return {
    day: String(date.getDate()).padStart(2, "0"),
    month: new Intl.DateTimeFormat("zh-CN", { month: "long" }).format(date),
    weekday: new Intl.DateTimeFormat("zh-CN", { weekday: "long" }).format(date),
  };
}

function shiftDateKey(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T12:00:00`);
  date.setDate(date.getDate() + days);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

interface SchedulePanelProps {
  selectedDate: string;
  tasks: ScheduledTask[];
  loading: boolean;
  error: string;
  onDateChange: (date: string) => void;
  onAdd: () => void;
  onRetry?: () => void;
  onToggle: (task: ScheduledTask) => void;
}

export function SchedulePanel({
  selectedDate,
  tasks,
  loading,
  error,
  onDateChange,
  onAdd,
  onRetry,
  onToggle,
}: SchedulePanelProps): React.JSX.Element {
  const displayDate = formatAgendaDate(selectedDate);

  return (
    <aside className="schedule-panel" aria-labelledby="schedule-heading">
      <div className="schedule-header">
        <div>
          <p className="section-kicker">SCHEDULE</p>
          <h2 id="schedule-heading">日程</h2>
        </div>
        <button className="btn btn-primary btn-sm" type="button" onClick={onAdd}>
          <Plus size={15} />
          添加
        </button>
      </div>

      <div className="schedule-date">
        <div className="schedule-day" aria-hidden="true">
          {displayDate.day}
        </div>
        <div>
          <strong>{displayDate.month}</strong>
          <span>{displayDate.weekday}</span>
        </div>
        <div className="schedule-date-actions">
          <label className="schedule-date-jump" title="跳转到日期">
            <CalendarDays size={15} aria-hidden="true" />
            <input
              type="date"
              value={selectedDate}
              onChange={(event) => {
                if (event.target.value !== "") {
                  onDateChange(event.target.value);
                }
              }}
              aria-label="跳转到指定日期"
            />
          </label>
          <button
            className="btn btn-square btn-ghost btn-sm"
            type="button"
            aria-label="前一天"
            onClick={() => onDateChange(shiftDateKey(selectedDate, -1))}
          >
            <ChevronLeft size={16} />
          </button>
          <button
            className="btn btn-square btn-ghost btn-sm"
            type="button"
            aria-label="后一天"
            onClick={() => onDateChange(shiftDateKey(selectedDate, 1))}
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      <div className="schedule-content">
        {loading ? (
          <div className="schedule-loading" aria-label="正在加载日程">
            {[0, 1, 2].map((value) => (
              <div className="skeleton h-14 rounded-xl" key={value} />
            ))}
          </div>
        ) : error !== "" ? (
          <div className="schedule-error" role="alert">
            <span>{error}</span>
            {onRetry !== undefined && (
              <button
                className="schedule-error-retry"
                type="button"
                onClick={onRetry}
              >
                <RefreshCw size={13} />
                重试
              </button>
            )}
          </div>
        ) : tasks.length === 0 ? (
          <div
            className="schedule-empty"
            role="button"
            tabIndex={0}
            onClick={onAdd}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onAdd();
              }
            }}
          >
            <div className="schedule-empty-icon" aria-hidden="true">
              <CalendarDays size={28} />
            </div>
            <strong>今天还没有待办</strong>
            <span>添加一项，把今天要做的事安排进来</span>
            <button
              className="btn btn-primary btn-sm schedule-empty-cta"
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onAdd();
              }}
            >
              <Plus size={14} />
              添加日程
            </button>
          </div>
        ) : (
          <ol className="schedule-list">
            {tasks.map((task) => (
              <li
                className="schedule-item"
                data-completed={task.status === "completed" ? "true" : "false"}
                key={task.id}
              >
                <time dateTime={`${task.scheduledDate}T${task.scheduledTime}`}>
                  {task.scheduledTime}
                </time>
                <div className="schedule-line" aria-hidden="true">
                  <span />
                </div>
                <div className="schedule-task-copy">
                  <strong>{task.title}</strong>
                  <span>{task.status === "completed" ? "已完成" : "待处理"}</span>
                </div>
                <button
                  className="schedule-check"
                  type="button"
                  aria-label={`${task.status === "completed" ? "恢复" : "完成"} ${task.title}`}
                  aria-pressed={task.status === "completed"}
                  onClick={() => {
                    if (
                      typeof navigator !== "undefined" &&
                      typeof navigator.vibrate === "function"
                    ) {
                      navigator.vibrate(task.status === "completed" ? 12 : 8);
                    }
                    onToggle(task);
                  }}
                >
                  <Check size={14} />
                </button>
              </li>
            ))}
          </ol>
        )}
      </div>

      <div className="schedule-footer">
        <Clock3 size={14} />
        <span>{tasks.filter((task) => task.status !== "completed").length} 项待处理</span>
      </div>
    </aside>
  );
}