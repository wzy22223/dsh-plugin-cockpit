import type {
  ScheduledTask,
  TaskListQuery,
  TaskStatus,
} from "../../shared/contracts/tasks";

export type ScheduleView = "overview" | "month" | "week";
export type OverviewFilter = "today" | "future" | "completed";

export const weekdayLabels = [
  "周一",
  "周二",
  "周三",
  "周四",
  "周五",
  "周六",
  "周日",
];

export function localDateKey(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

export function parseLocalDate(dateKey: string): Date {
  const [year = "1970", month = "01", day = "01"] = dateKey.split("-");
  return new Date(Number(year), Number(month) - 1, Number(day), 12);
}

export function shiftDateKey(dateKey: string, amount: number): string {
  const date = parseLocalDate(dateKey);
  date.setDate(date.getDate() + amount);
  return localDateKey(date);
}

export function startOfWeek(dateKey: string): string {
  const date = parseLocalDate(dateKey);
  const weekday = date.getDay();
  date.setDate(date.getDate() + (weekday === 0 ? -6 : 1 - weekday));
  return localDateKey(date);
}

export function endOfWeek(dateKey: string): string {
  return shiftDateKey(startOfWeek(dateKey), 6);
}

export function startOfMonth(dateKey: string): string {
  const date = parseLocalDate(dateKey);
  date.setDate(1);
  return localDateKey(date);
}

export function endOfMonth(dateKey: string): string {
  const date = parseLocalDate(dateKey);
  date.setMonth(date.getMonth() + 1, 0);
  return localDateKey(date);
}

export function monthGridRange(dateKey: string): { from: string; to: string } {
  return {
    from: startOfWeek(startOfMonth(dateKey)),
    to: endOfWeek(endOfMonth(dateKey)),
  };
}

export function dateKeysBetween(from: string, to: string): string[] {
  const dates: string[] = [];
  let current = from;

  while (current <= to) {
    dates.push(current);
    current = shiftDateKey(current, 1);
  }

  return dates;
}

export function formatMonth(dateKey: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
  }).format(parseLocalDate(dateKey));
}

export function formatLongDate(dateKey: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(parseLocalDate(dateKey));
}

export function formatWeekRange(from: string, to: string): string {
  const fromDate = parseLocalDate(from);
  const toDate = parseLocalDate(to);
  const sameYear = fromDate.getFullYear() === toDate.getFullYear();

  const start = new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(fromDate);
  const end = new Intl.DateTimeFormat("zh-CN", {
    year: sameYear ? undefined : "numeric",
    month: "short",
    day: "numeric",
  }).format(toDate);

  return `${start} — ${end}`;
}

export function taskDateTime(task: ScheduledTask): Date {
  const date = parseLocalDate(task.scheduledDate);
  const [hour = "00", minute = "00"] = task.scheduledTime.split(":");
  date.setHours(Number(hour), Number(minute), 0, 0);
  return date;
}

export function isTaskOverdue(task: ScheduledTask, now: Date): boolean {
  return task.status === "todo" && taskDateTime(task).getTime() < now.getTime();
}

export function groupTasksByDate(
  tasks: ScheduledTask[],
): Map<string, ScheduledTask[]> {
  const grouped = new Map<string, ScheduledTask[]>();

  for (const task of tasks) {
    const current = grouped.get(task.scheduledDate) ?? [];
    current.push(task);
    grouped.set(task.scheduledDate, current);
  }

  return grouped;
}

export function queryForView(
  view: ScheduleView,
  overviewFilter: OverviewFilter,
  anchorDate: string,
  today: string,
): TaskListQuery {
  if (view === "overview") {
    if (overviewFilter === "completed") {
      return { status: "completed" as TaskStatus };
    }

    if (overviewFilter === "future") {
      return {
        from: shiftDateKey(today, 1),
        status: "todo" as TaskStatus,
      };
    }

    return {
      to: today,
      status: "todo" as TaskStatus,
    };
  }

  if (view === "month") {
    const range = monthGridRange(anchorDate);
    return {
      from: range.from,
      to: range.to,
      status: "all" as TaskStatus,
    };
  }

  return {
    from: startOfWeek(anchorDate),
    to: endOfWeek(anchorDate),
    status: "all" as TaskStatus,
  };
}

export function statusLabel(task: ScheduledTask, now: Date): string {
  if (task.status === "completed") {
    return "已完成";
  }

  return isTaskOverdue(task, now) ? "已逾期" : "待处理";
}
