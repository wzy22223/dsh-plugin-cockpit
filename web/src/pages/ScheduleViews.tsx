import { Plus } from "lucide-react";

import type { ScheduledTask } from "../../shared/contracts/tasks";
import {
  dateKeysBetween,
  formatLongDate,
  formatMonth,
  groupTasksByDate,
  localDateKey,
  monthGridRange,
  parseLocalDate,
  startOfWeek,
  endOfWeek,
  weekdayLabels,
} from "./schedule-utils";
import { CompactTask, TaskRow } from "./ScheduleTaskRow";

export function OverviewAgenda({
  tasks,
  now,
  filter,
  updatingIds,
  onToggle,
}: {
  tasks: ScheduledTask[];
  now: Date;
  filter: "today" | "future" | "completed";
  updatingIds: ReadonlySet<string>;
  onToggle: (task: ScheduledTask) => void;
}): React.JSX.Element {
  const today = localDateKey(now);
  const grouped = groupTasksByDate(tasks);

  return (
    <div className="schedule-workspace-agenda">
      {[...grouped.entries()].map(([date, dateTasks]) => {
        const isPast = date < today;
        const heading =
          date === today
            ? "今天"
            : isPast && filter === "today"
              ? `逾期 · ${formatLongDate(date)}`
              : formatLongDate(date);

        return (
          <section
            className="schedule-workspace-agenda-group"
            aria-labelledby={`agenda-${date}`}
            key={date}
          >
            <div className="schedule-workspace-agenda-heading">
              <h2 id={`agenda-${date}`}>{heading}</h2>
              <span>{dateTasks.length} 项</span>
            </div>
            <ol className="schedule-workspace-task-list">
              {dateTasks.map((task) => (
                <TaskRow
                  task={task}
                  now={now}
                  updating={updatingIds.has(task.id)}
                  onToggle={onToggle}
                  key={task.id}
                />
              ))}
            </ol>
          </section>
        );
      })}
    </div>
  );
}

export function MonthCalendar({
  anchorDate,
  tasks,
  now,
  updatingIds,
  onAdd,
  onToggle,
}: {
  anchorDate: string;
  tasks: ScheduledTask[];
  now: Date;
  updatingIds: ReadonlySet<string>;
  onAdd: (date: string) => void;
  onToggle: (task: ScheduledTask) => void;
}): React.JSX.Element {
  const today = localDateKey(now);
  const currentMonth = parseLocalDate(anchorDate).getMonth();
  const range = monthGridRange(anchorDate);
  const dates = dateKeysBetween(range.from, range.to);
  const grouped = groupTasksByDate(tasks);
  const weeks = Array.from(
    { length: Math.ceil(dates.length / 7) },
    (_, index) => dates.slice(index * 7, index * 7 + 7),
  );

  return (
    <div
      className="schedule-workspace-month-scroll overflow-x-auto"
      role="region"
      aria-label={`${formatMonth(anchorDate)}日历横向滚动区域`}
      tabIndex={0}
    >
      <div
        className="schedule-workspace-month-grid min-w-[44rem]"
        role="table"
        aria-label={`${formatMonth(anchorDate)}日历`}
      >
        <div className="schedule-workspace-month-weekdays" role="row">
          {weekdayLabels.map((weekday) => (
            <span role="columnheader" key={weekday}>
              {weekday}
            </span>
          ))}
        </div>

        {weeks.map((week) => (
          <div
            className="schedule-workspace-month-week"
            role="row"
            key={week[0]}
          >
            {week.map((date) => {
              const dateTasks = grouped.get(date) ?? [];
              const parsed = parseLocalDate(date);
              const outside = parsed.getMonth() !== currentMonth;

              return (
                <article
                  className="schedule-workspace-month-day"
                  role="cell"
                  aria-label={`${formatLongDate(date)}，${dateTasks.length} 项日程`}
                  aria-current={date === today ? "date" : undefined}
                  data-outside={outside ? "true" : "false"}
                  data-today={date === today ? "true" : "false"}
                  key={date}
                >
                  <header>
                    <time dateTime={date}>{parsed.getDate()}</time>
                    <button
                      className="btn btn-circle btn-ghost btn-xs"
                      type="button"
                      aria-label={`在${formatLongDate(date)}添加日程`}
                      onClick={() => onAdd(date)}
                    >
                      <Plus size={12} />
                    </button>
                  </header>

                  {dateTasks.length > 0 ? (
                    <ol>
                      {dateTasks.map((task) => (
                        <CompactTask
                          task={task}
                          now={now}
                          updating={updatingIds.has(task.id)}
                          onToggle={onToggle}
                          key={task.id}
                        />
                      ))}
                    </ol>
                  ) : (
                    <span className="schedule-workspace-month-empty">空闲</span>
                  )}
                </article>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

export function WeekCalendar({
  anchorDate,
  tasks,
  now,
  updatingIds,
  onAdd,
  onToggle,
}: {
  anchorDate: string;
  tasks: ScheduledTask[];
  now: Date;
  updatingIds: ReadonlySet<string>;
  onAdd: (date: string) => void;
  onToggle: (task: ScheduledTask) => void;
}): React.JSX.Element {
  const today = localDateKey(now);
  const weekStart = startOfWeek(anchorDate);
  const dates = dateKeysBetween(weekStart, endOfWeek(anchorDate));
  const grouped = groupTasksByDate(tasks);

  return (
    <div className="schedule-workspace-week-grid grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-7">
      {dates.map((date, index) => {
        const dateTasks = grouped.get(date) ?? [];
        const dateLabel = formatLongDate(date);

        return (
          <section
            className="schedule-workspace-week-day card card-border bg-base-200/35"
            aria-labelledby={`week-${date}`}
            data-today={date === today ? "true" : "false"}
            key={date}
          >
            <div className="card-body gap-4 p-4">
              <header>
                <div>
                  <span>{weekdayLabels[index]}</span>
                  <h2 id={`week-${date}`}>
                    <time dateTime={date}>
                      {parseLocalDate(date).getDate()} 日
                    </time>
                  </h2>
                </div>
                <button
                  className="btn btn-circle btn-ghost btn-xs"
                  type="button"
                  aria-label={`在${dateLabel}添加日程`}
                  onClick={() => onAdd(date)}
                >
                  <Plus size={13} />
                </button>
              </header>

              {dateTasks.length > 0 ? (
                <ol>
                  {dateTasks.map((task) => (
                    <CompactTask
                      task={task}
                      now={now}
                      updating={updatingIds.has(task.id)}
                      onToggle={onToggle}
                      key={task.id}
                    />
                  ))}
                </ol>
              ) : (
                <button
                  className="schedule-workspace-week-empty"
                  type="button"
                  onClick={() => onAdd(date)}
                >
                  <Plus size={14} />
                  添加安排
                </button>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
