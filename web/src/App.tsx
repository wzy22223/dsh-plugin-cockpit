import {
  Menu as MenuIcon,
  Monitor,
  Moon,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Sun,
  X,
} from "lucide-react";
import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { NavigationItem } from "../shared/contracts/navigation";
import type { ScheduledTask } from "../shared/contracts/tasks";
import {
  deleteNavigation,
  listNavigation,
  listScheduledTasks,
  openNavigation,
  restoreNavigation,
  updateScheduledTaskStatus,
  fetchWarehouseSummary,
  fetchErpExceptions,
} from "./api";
import { ResourcesWorkspace } from "./pages/ResourcesWorkspace";
import { ScheduleWorkspace } from "./pages/ScheduleWorkspace";
import { WarehouseWorkspace } from "./pages/WarehouseWorkspace";
import { Sidebar } from "./components/Sidebar";
import { BottomTabBar } from "./components/BottomTabBar";
import { EntryCard } from "./components/EntryCard";
import { AddEntryDialog } from "./components/AddEntryDialog";
import { SchedulePanel } from "./components/SchedulePanel";
import { AddScheduleDialog } from "./components/AddScheduleDialog";
import { WarehouseStrip } from "./components/WarehouseStrip";
import { ErpExceptionStrip } from "./components/ErpExceptionStrip";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { FlightStrip } from "./components/FlightStrip";
import { AmbientBackground } from "./components/AmbientBackground";

interface WarehouseSnapshot {
  data_date: string;
  generated_at: string;
  shipment: { summary: Record<string, number | string> };
  inventory: { summary: Record<string, number | string> };
  returns: { summary: Record<string, number | string> };
  /** 环比：`<module>:<字段>` → 与上一数据日期的差值（历史不足两天时缺省） */
  deltas?: Record<string, { delta: number; pct: number | null }>;
}

interface ErpExceptions {
  data_date?: string;
  generated_at?: string;
  发货上传失败?: number;
  打单超2次?: number;
}
export type WorkspaceView = "home" | "schedule" | "metrics" | "resources" | "vault";
export type ThemeMode = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

const THEME_STORAGE_KEY = "cockpit.theme";
const AMBIENT_STORAGE_KEY = "cockpit.ambient.paused";
const VaultWorkspace = lazy(async () => {
  const module = await import("./pages/VaultWorkspace");
  return { default: module.VaultWorkspace };
});

function readStoredThemeMode(): ThemeMode {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    return "system";
  }
}

function readStoredAmbientOverride(): boolean | null {
  try {
    const stored = window.localStorage.getItem(AMBIENT_STORAGE_KEY);
    return stored === "1" ? true : stored === "0" ? false : null;
  } catch {
    return null;
  }
}

function readMedia(query: string): boolean {
  return typeof window !== "undefined" && window.matchMedia(query).matches;
}

function formatDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

const VIEW_SHORTCUTS: Record<string, WorkspaceView> = {
  "1": "home",
  "2": "schedule",
  "3": "metrics",
  "4": "resources",
  "5": "vault",
};

export function App(): React.JSX.Element {
  const today = useMemo(() => formatDateKey(new Date()), []);
  const [items, setItems] = useState<NavigationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [selectedDate, setSelectedDate] = useState(today);
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [tasksLoading, setTasksLoading] = useState(true);
  const [tasksError, setTasksError] = useState("");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [activeView, setActiveView] = useState<WorkspaceView>("home");
  const [themeMode, setThemeMode] = useState<ThemeMode>(readStoredThemeMode);
  const [systemDark, setSystemDark] = useState(() => readMedia("(prefers-color-scheme: dark)"));
  const [compactViewport, setCompactViewport] = useState(() => readMedia("(max-width: 48rem)"));
  const [reducedMotion, setReducedMotion] = useState(() => readMedia("(prefers-reduced-motion: reduce)"));
  const [ambientOverride, setAmbientOverride] = useState<boolean | null>(readStoredAmbientOverride);
  const [ambientSignal, setAmbientSignal] = useState(0);
  const [toast, setToast] = useState<{
    key: number;
    message: string;
    undoItem: NavigationItem | null;
  } | null>(null);
  const [warehouseSnap, setWarehouseSnap] = useState<WarehouseSnapshot | null>(null);
  const [warehouseLoading, setWarehouseLoading] = useState(true);
  const [warehouseError, setWarehouseError] = useState(false);
  const [erpExceptions, setErpExceptions] = useState<ErpExceptions | null>(null);
  const [erpExceptionsLoading, setErpExceptionsLoading] = useState(true);
  const [erpExceptionsError, setErpExceptionsError] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const scheduleDialogRef = useRef<HTMLDialogElement>(null);
  const drawerButtonRef = useRef<HTMLButtonElement>(null);
  const activeViewRef = useRef<WorkspaceView>("home");

  const resolvedTheme: ResolvedTheme = themeMode === "system"
    ? systemDark ? "dark" : "light"
    : themeMode;
  const ambientPaused = reducedMotion || (ambientOverride ?? compactViewport);

  // 重试修订号：自增即可重新拉取对应数据源
  const [navRevision, setNavRevision] = useState(0);
  const [tasksRevision, setTasksRevision] = useState(0);
  const [warehouseRevision, setWarehouseRevision] = useState(0);
  const [erpRevision, setErpRevision] = useState(0);

  useEffect(() => {
    const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const compactQuery = window.matchMedia("(max-width: 48rem)");
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncPreferences = (): void => {
      setSystemDark(darkQuery.matches);
      setCompactViewport(compactQuery.matches);
      setReducedMotion(motionQuery.matches);
    };

    syncPreferences();
    darkQuery.addEventListener("change", syncPreferences);
    compactQuery.addEventListener("change", syncPreferences);
    motionQuery.addEventListener("change", syncPreferences);
    return () => {
      darkQuery.removeEventListener("change", syncPreferences);
      compactQuery.removeEventListener("change", syncPreferences);
      motionQuery.removeEventListener("change", syncPreferences);
    };
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = resolvedTheme === "dark" ? "cockpit-dark" : "cockpit";
    root.style.colorScheme = resolvedTheme;
    document
      .querySelector<HTMLMetaElement>('meta[name="theme-color"]')
      ?.setAttribute("content", resolvedTheme === "dark" ? "#080D18" : "#F8FAFC");
  }, [resolvedTheme]);

  function cycleThemeMode(): void {
    setThemeMode((current) => {
      const next: ThemeMode = current === "system"
        ? "dark"
        : current === "dark" ? "light" : "system";
      try {
        window.localStorage.setItem(THEME_STORAGE_KEY, next);
      } catch {
        /* 本地偏好不可写时仅保留本次会话状态 */
      }
      return next;
    });
  }

  function toggleAmbient(): void {
    if (reducedMotion) {
      return;
    }
    const nextPaused = !ambientPaused;
    setAmbientOverride(nextPaused);
    try {
      window.localStorage.setItem(AMBIENT_STORAGE_KEY, nextPaused ? "1" : "0");
    } catch {
      /* 本地偏好不可写时仅保留本次会话状态 */
    }
  }

  function pulseAmbientSignal(): void {
    setAmbientSignal((current) => current + 1);
  }

  /** 视图切换：优先走 View Transitions API（不支持的浏览器直接切换） */
  function switchView(view: WorkspaceView): void {
    const apply = (): void => {
      if (activeViewRef.current !== view) {
        activeViewRef.current = view;
        pulseAmbientSignal();
      }
      setActiveView(view);
      setDrawerOpen(false);
      window.scrollTo({ top: 0, behavior: "instant" });
    };
    if (typeof document !== "undefined" && "startViewTransition" in document) {
      document.startViewTransition(apply);
    } else {
      apply();
    }
  }

  // 全局快捷键：1-5 切换视图，N 新建日程，? 查看帮助
  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      const target = event.target as HTMLElement | null;
      if (
        target !== null &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable ||
          target.closest("dialog") !== null)
      ) {
        return;
      }
      const key = event.key.toLowerCase();
      const view = VIEW_SHORTCUTS[key];
      if (view !== undefined) {
        event.preventDefault();
        switchView(view);
        return;
      }
      if (key === "n") {
        event.preventDefault();
        scheduleDialogRef.current?.showModal();
        return;
      }
      if (event.key === "?") {
        setToast({
          key: Date.now(),
          message: "快捷键：1-7 切换视图 · N 新建日程",
          undoItem: null,
        });
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    if (!drawerOpen) {
      return;
    }

    const focusTimer = window.setTimeout(() => {
      document
        .querySelector<HTMLButtonElement>("#cockpit-sidebar .menu button")
        ?.focus();
    }, 160);
    const handleKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key === "Escape") {
        setDrawerOpen(false);
        drawerButtonRef.current?.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [drawerOpen]);

  useEffect(() => {
    if (toast === null) {
      return;
    }
    const timer = window.setTimeout(() => setToast(null), 6_000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  function sortByPosition(list: NavigationItem[]): NavigationItem[] {
    return [...list].sort((left, right) => left.position - right.position);
  }

  function handleDeleteEntry(item: NavigationItem): void {
    void deleteNavigation(item.id)
      .then(() => {
        setItems((current) => current.filter((entry) => entry.id !== item.id));
        setToast({
          key: Date.now(),
          message: `已删除「${item.name}」`,
          undoItem: item,
        });
      })
      .catch((error: unknown) => {
        setToast({
          key: Date.now(),
          message:
            error instanceof Error ? error.message : "删除失败，请稍后重试。",
          undoItem: null,
        });
      });
  }

  function handleOpenLocalEntry(item: NavigationItem): void {
    void openNavigation(item.id).catch((error: unknown) => {
      setToast({
        key: Date.now(),
        message:
          error instanceof Error
            ? error.message
            : "本机打开失败，请确认路径仍然存在。",
        undoItem: null,
      });
    });
  }

  function handleUndoDelete(): void {
    if (toast?.undoItem == null) {
      return;
    }
    const target = toast.undoItem;
    void restoreNavigation(target.id)
      .then((restored) => {
        setItems((current) => sortByPosition([...current, restored]));
        setToast(null);
      })
      .catch((error: unknown) => {
        setToast({
          key: Date.now(),
          message:
            error instanceof Error ? error.message : "恢复失败，请稍后重试。",
          undoItem: null,
        });
      });
  }

  useEffect(() => {
    let active = true;

    listNavigation()
      .then((navigationItems) => {
        if (active) {
          setItems(navigationItems);
          setLoadError("");
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setLoadError(
            error instanceof Error ? error.message : "入口加载失败。",
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
  }, [navRevision]);

  useEffect(() => {
    if (activeView !== "home") {
      return;
    }

    let active = true;
    setTasksLoading(true);

    listScheduledTasks(selectedDate)
      .then((scheduledTasks) => {
        if (active) {
          setTasks(scheduledTasks);
          setTasksError("");
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setTasksError(
            error instanceof Error ? error.message : "日程加载失败。",
          );
        }
      })
      .finally(() => {
        if (active) {
          setTasksLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [activeView, selectedDate, tasksRevision]);

  useEffect(() => {
    // 仅首页需要仓库速览；切到其他视图不拉取，避免无谓请求
    if (activeView !== "home") return;
    let active = true;
    setWarehouseLoading(true);
    setWarehouseError(false);

    fetchWarehouseSummary()
      .then(async (raw) => {
        const data = raw as {
          data_date: string;
          generated_at: string;
          shipment: { summary: Record<string, number | string> };
          inventory: { summary: Record<string, number | string> };
          returns: { summary: Record<string, number | string> };
          deltas?: Record<string, { delta: number; pct: number | null }>;
        };
        if (active) {
          const snap: WarehouseSnapshot = {
            data_date: data.data_date,
            generated_at: data.generated_at,
            shipment: data.shipment,
            inventory: data.inventory,
            returns: data.returns,
          };
          if (data.deltas) snap.deltas = data.deltas;
          setWarehouseSnap(snap);
        }
      })
      .catch(() => {
        if (active) {
          setWarehouseSnap(null);
          setWarehouseError(true);
        }
      })
      .finally(() => {
        if (active) {
          setWarehouseLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [activeView, warehouseRevision]);

  useEffect(() => {
    // ERP 异常订单（发货失败 + 打单超2次），与仓库速览同源定时刷新
    if (activeView !== "home") return;
    let active = true;
    setErpExceptionsLoading(true);
    setErpExceptionsError(false);
    fetchErpExceptions()
      .then((raw) => {
        if (active) setErpExceptions(raw as ErpExceptions);
      })
      .catch(() => {
        if (active) {
          setErpExceptions(null);
          setErpExceptionsError(true);
        }
      })
      .finally(() => {
        if (active) setErpExceptionsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [activeView, erpRevision]);

  const homeSchedulePanel = (
    <SchedulePanel
      selectedDate={selectedDate}
      tasks={tasks}
      loading={tasksLoading}
      error={tasksError}
      onDateChange={setSelectedDate}
      onAdd={() => scheduleDialogRef.current?.showModal()}
      onRetry={() => setTasksRevision((current) => current + 1)}
      onToggle={(task) => {
        const status = task.status === "completed" ? "todo" : "completed";
        void updateScheduledTaskStatus(task.id, status)
          .then((updatedTask) => {
            setTasksError("");
            setTasks((current) =>
              current.map((item) =>
                item.id === updatedTask.id ? updatedTask : item,
              ),
            );
          })
          .catch((error: unknown) => {
            setTasksError(
              error instanceof Error ? error.message : "日程状态更新失败。",
            );
          });
      }}
    />
  );

  return (
    <div
      className="cockpit-app"
      data-ambient-paused={ambientPaused ? "true" : "false"}
      data-view={activeView}
    >
    <AmbientBackground
      paused={ambientPaused}
      reducedMotion={reducedMotion}
      signal={ambientSignal}
    />
    <div className="drawer lg:drawer-open">
      <input
        id="cockpit-drawer"
        type="checkbox"
        className="drawer-toggle"
        checked={drawerOpen}
        onChange={(event) => setDrawerOpen(event.currentTarget.checked)}
      />

      <div className="drawer-content min-w-0">
        <header className="mobile-header flex lg:hidden">
          <button
            className="mobile-nav-trigger btn btn-square btn-ghost btn-sm"
            type="button"
            ref={drawerButtonRef}
            aria-label="打开导航"
            aria-controls="cockpit-sidebar"
            aria-expanded={drawerOpen}
            onClick={() => setDrawerOpen(true)}
          >
            <MenuIcon size={20} />
          </button>
          <span className="mobile-header-brand">PERSONAL COCKPIT</span>
          <div className="mobile-appearance-actions" aria-label="外观设置">
            <button
              className="mobile-appearance-button"
              type="button"
              onClick={cycleThemeMode}
              aria-label={`切换主题，当前${themeMode === "system" ? "跟随系统" : resolvedTheme === "dark" ? "深色" : "浅色"}`}
              title="切换主题"
            >
              {themeMode === "system" ? (
                <Monitor size={16} />
              ) : resolvedTheme === "dark" ? (
                <Moon size={16} />
              ) : (
                <Sun size={16} />
              )}
            </button>
            <button
              className="mobile-appearance-button"
              type="button"
              onClick={toggleAmbient}
              aria-label={reducedMotion ? "系统已启用减少动态效果" : ambientPaused ? "恢复背景动效" : "暂停背景动效"}
              aria-pressed={ambientPaused}
              title={reducedMotion ? "系统已减少动态效果" : ambientPaused ? "恢复背景动效" : "暂停背景动效"}
              disabled={reducedMotion}
            >
              {ambientPaused ? <Play size={16} /> : <Pause size={16} />}
            </button>
            <span className="status status-success" aria-label="本地服务在线" />
          </div>
        </header>

        <main className="cockpit-main">
          <FlightStrip />

          {activeView === "home" && (
            <WarehouseStrip
              snap={warehouseSnap}
              loading={warehouseLoading}
              error={warehouseError}
              onOpen={() => switchView("metrics")}
              onRetry={() => {
                setWarehouseRevision((current) => current + 1);
                pulseAmbientSignal();
              }}
            />
          )}

          {activeView === "home" && (
            <ErpExceptionStrip
              data={erpExceptions ?? null}
              loading={erpExceptionsLoading}
              error={erpExceptionsError}
              onOpen={() => switchView("metrics")}
              onRetry={() => {
                setErpRevision((current) => current + 1);
                pulseAmbientSignal();
              }}
            />
          )}

          {activeView === "home" && (
            <div className="home-grid">
              {homeSchedulePanel}

              <section className="workspace-primary">
                <div className="section-heading">
                  <div>
                    <p className="section-kicker">QUICK LAUNCH</p>
                    <h2>工作入口</h2>
                  </div>
                  <button
                    className="btn btn-outline btn-sm"
                    type="button"
                    onClick={() => dialogRef.current?.showModal()}
                  >
                    <Plus size={16} />
                    添加入口
                  </button>
                </div>

                <div className="entry-group-label">
                  <span>已保存入口</span>
                  <span className="entry-group-rule" aria-hidden="true" />
                  <span aria-live="polite">{items.length} 个入口</span>
                </div>

                {loading ? (
                  <div className="entry-grid" aria-label="正在加载入口">
                    {[0, 1].map((value) => (
                      <div className="skeleton h-64 rounded-2xl" key={value} />
                    ))}
                  </div>
                ) : loadError !== "" ? (
                  <div className="alert alert-error">
                    <span>{loadError}</span>
                    <button
                      className="btn btn-ghost btn-sm"
                      type="button"
                      onClick={() => setNavRevision((current) => current + 1)}
                    >
                      <RefreshCw size={14} />
                      重试
                    </button>
                  </div>
                ) : (
                  <div className="entry-grid">
                    {items.map((item, index) => (
                      <EntryCard
                        item={item}
                        key={item.id}
                        index={index}
                        onDelete={handleDeleteEntry}
                        onOpenLocal={handleOpenLocalEntry}
                      />
                    ))}
                    {items.length === 0 ? (
                      <button
                        className="empty-entry"
                        type="button"
                        onClick={() => dialogRef.current?.showModal()}
                      >
                        <Plus size={20} />
                        添加第一个工作入口
                      </button>
                    ) : (
                      <button
                        className="entry-add-tile"
                        type="button"
                        aria-label="添加入口"
                        onClick={() => dialogRef.current?.showModal()}
                      >
                        <Plus size={20} />
                        添加入口
                      </button>
                    )}
                  </div>
                )}
              </section>
            </div>
          )}

          {activeView === "schedule" && (
            <ScheduleWorkspace />
          )}

          {activeView === "resources" && (
            <ResourcesWorkspace />
          )}

          {activeView === "vault" && (
            <Suspense fallback={<div className="vault-route-loading skeleton rounded-2xl" aria-label="正在加载知识库" />}>
              <VaultWorkspace />
            </Suspense>
          )}

          {activeView === "metrics" && (
            <WarehouseWorkspace />
          )}
        </main>

        <BottomTabBar
          activeView={activeView}
          onViewChange={(view) => {
            switchView(view);
          }}
        />
      </div>

      <div className="drawer-side z-40">
        <label
          htmlFor="cockpit-drawer"
          aria-label="关闭导航"
          className="drawer-overlay"
        />
        <Sidebar
          collapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed((current) => !current)}
          activeView={activeView}
          onViewChange={(view) => {
            switchView(view);
          }}
          themeMode={themeMode}
          resolvedTheme={resolvedTheme}
          ambientPaused={ambientPaused}
          reducedMotion={reducedMotion}
          onThemeCycle={cycleThemeMode}
          onAmbientToggle={toggleAmbient}
        />
      </div>

      <AddEntryDialog
        dialogRef={dialogRef}
        onCreated={(item) =>
          setItems((current) =>
            [...current, item].sort((left, right) => left.position - right.position),
          )
        }
      />
      <AddScheduleDialog
        dialogRef={scheduleDialogRef}
        defaultDate={selectedDate}
        onCreated={(task) => {
          if (task.scheduledDate === selectedDate) {
            setTasks((current) =>
              [...current, task].sort((left, right) =>
                left.scheduledTime.localeCompare(right.scheduledTime),
              ),
            );
          } else {
            setSelectedDate(task.scheduledDate);
          }
        }}
      />

      {toast !== null && (
        <div className="cockpit-toast" role="status" key={toast.key}>
          <span>{toast.message}</span>
          {toast.undoItem !== null && (
            <button
              className="toast-undo"
              type="button"
              onClick={handleUndoDelete}
            >
              撤销
            </button>
          )}
          <button
            className="btn btn-square btn-ghost btn-sm"
            type="button"
            aria-label="关闭提示"
            onClick={() => setToast(null)}
          >
            <X size={16} />
          </button>
        </div>
      )}
      </div>
    </div>
  );
}
