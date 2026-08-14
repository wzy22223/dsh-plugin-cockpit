import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Clock3,
  ListChecks,
  Plus,
  RefreshCw,
} from "lucide-react";
import {
  type KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type {
  ScheduledTask,
  TaskStatus,
} from "../../shared/contracts/tasks";
import {
  listScheduledTaskRange,
  updateScheduledTaskStatus,
} from "../api";
import {
  type OverviewFilter,
  type ScheduleView,
  formatMonth,
  formatWeekRange,
  isTaskOverdue,
  localDateKey,
  parseLocalDate,
  queryForView,
  shiftDateKey,
  startOfWeek,
  endOfWeek,
} from "./schedule-utils";
import { OverviewAgenda, MonthCalendar, WeekCalendar } from "./ScheduleViews";
import { AddScheduleDialog } from "./ScheduleAddDialog";

function EmptySchedule({
  filter,
  onAdd,
}: {
  filter: OverviewFilter;
  onAdd: () => void;
}): React.JSX.Element {
  const copy = {
    today: {
      title: "今天没有待处理事项",
      description: "逾期事项和今天的安排都会显示在这里。",
    },
    future: {
      title: "未来还没有安排",
      description: "添加一项日程，为接下来的工作留出时间。",
    },
    completed: {
      title: "还没有已完成事项",
      description: "完成的日程会集中保留在这里。",
    },
  }[filter];

  return (
    <div className="schedule-workspace-empty">
      <CalendarDays size={24} />
      <strong>{copy.title}</strong>
      <span>{copy.description}</span>
      {filter !== "completed" && (
        <button className="btn btn-primary btn-sm" type="button" onClick={onAdd}>
          <Plus size={15} />
          添加日程
        </button>
      )}
    </div>
  );
}

export function ScheduleWorkspace(): React.JSX.Element {
  const [now, setNow] = useState(() => new Date());
  const today = localDateKey(now);
  const [view, setView] = useState<ScheduleView>("overview");
  const [overviewFilter, setOverviewFilter] =
    useState<OverviewFilter>("today");
  const [anchorDate, setAnchorDate] = useState(today);
  const [addDate, setAddDate] = useState(today);
  const [addSession, setAddSession] = useState(0);
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [revision, setRevision] = useState(0);

  const [updatingIds, setUpdatingIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const addDialogRef = useRef<HTMLDialogElement>(null);

  const taskQuery = useMemo(
    () => queryForView(view, overviewFilter, anchorDate, today),
    [anchorDate, overviewFilter, today, view],
  );

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError("");
    setTasks([]);

    listScheduledTaskRange(taskQuery)
      .then((scheduledTasks: ScheduledTask[]) => {
        if (active) {
          setTasks(scheduledTasks);
        }
      })
      .catch((caughtError: unknown) => {
        if (active) {
          setLoadError(
            caughtError instanceof Error
              ? caughtError.message
              : "日程加载失败。",
          );
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [revision, taskQuery]);

  const overdueCount = tasks.filter((task) => isTaskOverdue(task, now)).length;
  const completedCount = tasks.filter(
    (task) => task.status === "completed",
  ).length;
  const pendingCount = tasks.length - completedCount;
  const statsUnavailable = loading || loadError !== "";

  const defaultAddDate =
    view === "overview"
      ? overviewFilter === "future"
        ? shiftDateKey(today, 1)
        : today
      : anchorDate;

  const calendarHeading =
    view === "month"
      ? formatMonth(anchorDate)
      : formatWeekRange(startOfWeek(anchorDate), endOfWeek(anchorDate));

  function openAddDialog(date = defaultAddDate): void {
    setAddDate(date);
    setAddSession((current) => current + 1);
    setActionError("");
    addDialogRef.current?.showModal();
  }

  async function handleToggle(task: ScheduledTask): Promise<void> {
    const nextStatus: TaskStatus =
      task.status === "completed" ? "todo" : "completed";

    setActionError("");
    setUpdatingIds((current) => {
      const next = new Set(current);
      next.add(task.id);
      return next;
    });

    try {
      await updateScheduledTaskStatus(task.id, nextStatus);
      setRevision((current) => current + 1);
    } catch (caughtError) {
      setActionError(
        caughtError instanceof Error
          ? caughtError.message
          : "日程状态更新失败。",
      );
    } finally {
      setUpdatingIds((current) => {
        const next = new Set(current);
        next.delete(task.id);
        return next;
      });
    }
  }

  function moveCalendar(direction: -1 | 1): void {
    const anchor = parseLocalDate(anchorDate);
    if (view === "month") {
      anchor.setMonth(anchor.getMonth() + direction, 1);
      setAnchorDate(localDateKey(anchor));
      return;
    }

    setAnchorDate(shiftDateKey(anchorDate, direction * 7));
  }

  function handleViewTabKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
  ): void {
    const tabList = event.currentTarget.closest('[role="tablist"]');
    const tabs = tabList
      ? Array.from(
          tabList.querySelectorAll<HTMLButtonElement>(
            ".schedule-workspace-view-tab",
          ),
        )
      : [];
    const currentIndex = tabs.indexOf(event.currentTarget);

    if (currentIndex < 0 || tabs.length === 0) {
      return;
    }

    let nextIndex: number;
    switch (event.key) {
      case "ArrowRight":
        nextIndex = (currentIndex + 1) % tabs.length;
        break;
      case "ArrowLeft":
        nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
        break;
      case "Home":
        nextIndex = 0;
        break;
      case "End":
        nextIndex = tabs.length - 1;
        break;
      default:
        return;
    }

    event.preventDefault();
    tabs[nextIndex]?.focus();
    tabs[nextIndex]?.click();
  }

  return (
    <section
      className="workspace-page schedule-workspace"
      aria-labelledby="schedule-workspace-heading"
    >
      <header className="schedule-workspace-hero">
        <div className="workspace-page-heading schedule-workspace-heading">
          <p className="section-kicker">SCHEDULE CONTROL</p>
          <h1 id="schedule-workspace-heading">日程</h1>
          <p>收拢逾期事项，安排今天，并从月与周的节奏查看工作。</p>
        </div>

        <button
          className="schedule-workspace-add btn btn-primary btn-sm"
          type="button"
          onClick={() => openAddDialog()}
        >
          <Plus size={15} />
          添加日程
        </button>
      </header>

      <nav
        className="schedule-workspace-view-nav mt-6"
        role="tablist"
        aria-label="日程视图"
        aria-orientation="horizontal"
      >
        {(
          [
            ["overview", "概览", ListChecks],
            ["month", "月视图", CalendarDays],
            ["week", "周视图", Clock3],
          ] as const
        ).map(([value, label, Icon]) => (
          <button
            className="schedule-workspace-view-tab"
            type="button"
            role="tab"
            id={`schedule-tab-${value}`}
            aria-controls="schedule-workspace-panel"
            aria-selected={view === value}
            tabIndex={view === value ? 0 : -1}
            data-active={view === value ? "true" : "false"}
            key={value}
            onClick={() => setView(value)}
            onKeyDown={handleViewTabKeyDown}
          >
            <Icon size={15} />
            {label}
          </button>
        ))}
      </nav>

      <section
        className="schedule-workspace-context-bar mt-5"
        aria-label="当前视图控制"
      >
        <div className="schedule-workspace-context-primary">
          {view === "overview" ? (
            <div
              className="schedule-workspace-filter-group"
              role="group"
              aria-label="概览筛选"
            >
              {(
                [
                  ["today", "今天"],
                  ["future", "未来"],
                  ["completed", "已完成"],
                ] as const
              ).map(([value, label]) => (
                <button
                  className="schedule-workspace-filter-button"
                  type="button"
                  aria-pressed={overviewFilter === value}
                  data-active={overviewFilter === value ? "true" : "false"}
                  key={value}
                  onClick={() => setOverviewFilter(value)}
                >
                  {label}
                  {value === "today" && (
                    <span className="schedule-workspace-filter-note">
                      含逾期
                    </span>
                  )}
                </button>
              ))}
            </div>
          ) : (
            <div className="schedule-workspace-calendar-nav">
              <button
                className="btn btn-square btn-ghost btn-sm"
                type="button"
                aria-label={view === "month" ? "上个月" : "上一周"}
                onClick={() => moveCalendar(-1)}
              >
                <ChevronLeft size={17} />
              </button>
              <strong aria-live="polite">{calendarHeading}</strong>
              <button
                className="btn btn-square btn-ghost btn-sm"
                type="button"
                aria-label={view === "month" ? "下个月" : "下一周"}
                onClick={() => moveCalendar(1)}
              >
                <ChevronRight size={17} />
              </button>
              <button
                className="btn btn-ghost btn-sm"
                type="button"
                onClick={() => setAnchorDate(today)}
              >
                回到今天
              </button>
            </div>
          )}
        </div>

        <dl
          className="schedule-workspace-stats"
          aria-label="当前视图统计"
          aria-live="polite"
          aria-busy={loading}
        >
          <div>
            <dt>待处理</dt>
            <dd>{statsUnavailable ? "—" : pendingCount}</dd>
          </div>
          <div
            data-alert={
              !statsUnavailable && overdueCount > 0 ? "true" : "false"
            }
          >
            <dt>逾期</dt>
            <dd>{statsUnavailable ? "—" : overdueCount}</dd>
          </div>
          <div>
            <dt>已完成</dt>
            <dd>{statsUnavailable ? "—" : completedCount}</dd>
          </div>
        </dl>
      </section>

      {actionError !== "" && (
        <div className="alert alert-error mt-5 text-sm" role="alert">
          <CircleAlert size={17} />
          <span>{actionError}</span>
        </div>
      )}

      <div
        className="schedule-workspace-content mt-5"
        id="schedule-workspace-panel"
        role="tabpanel"
        aria-labelledby={`schedule-tab-${view}`}
        aria-busy={loading}
      >
        {loading ? (
          <div
            className="schedule-workspace-loading grid gap-3"
            role="status"
            aria-live="polite"
          >
            <span className="sr-only">正在加载日程</span>
            {[0, 1, 2].map((value) => (
              <div
                className="skeleton h-24 rounded-2xl"
                aria-hidden="true"
                key={value}
              />
            ))}
          </div>
        ) : loadError !== "" ? (
          <div className="schedule-workspace-error alert alert-error" role="alert">
            <CircleAlert size={18} />
            <span>{loadError}</span>
            <button
              className="btn btn-ghost btn-sm"
              type="button"
              onClick={() => setRevision((current) => current + 1)}
            >
              <RefreshCw size={14} />
              重新加载
            </button>
          </div>
        ) : view === "overview" ? (
          tasks.length > 0 ? (
            <OverviewAgenda
              tasks={tasks}
              now={now}
              filter={overviewFilter}
              updatingIds={updatingIds}
              onToggle={(task) => void handleToggle(task)}
            />
          ) : (
            <EmptySchedule
              filter={overviewFilter}
              onAdd={() => openAddDialog()}
            />
          )
        ) : view === "month" ? (
          <MonthCalendar
            anchorDate={anchorDate}
            tasks={tasks}
            now={now}
            updatingIds={updatingIds}
            onAdd={openAddDialog}
            onToggle={(task) => void handleToggle(task)}
          />
        ) : (
          <WeekCalendar
            anchorDate={anchorDate}
            tasks={tasks}
            now={now}
            updatingIds={updatingIds}
            onAdd={openAddDialog}
            onToggle={(task) => void handleToggle(task)}
          />
        )}
      </div>

      <AddScheduleDialog
        dialogRef={addDialogRef}
        defaultDate={addDate}
        session={addSession}
        onCreated={(task) => {
          setAnchorDate(task.scheduledDate);
          if (view === "overview") {
            setOverviewFilter(
              task.scheduledDate <= today ? "today" : "future",
            );
          }
          setRevision((current) => current + 1);
        }}
      />
    </section>
  );
}
