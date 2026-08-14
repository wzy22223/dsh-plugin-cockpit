import {
  BarChart3,
  CalendarDays,
  FileArchive,
  LayoutGrid,
  LibraryBig,
  Monitor,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Pause,
  Play,
  Sun,
} from "lucide-react";
import type { ResolvedTheme, ThemeMode, WorkspaceView } from "../App";

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  activeView: WorkspaceView;
  onViewChange: (view: WorkspaceView) => void;
  themeMode: ThemeMode;
  resolvedTheme: ResolvedTheme;
  ambientPaused: boolean;
  reducedMotion: boolean;
  onThemeCycle: () => void;
  onAmbientToggle: () => void;
}

export function Sidebar({
  collapsed,
  onToggle,
  activeView,
  onViewChange,
  themeMode,
  resolvedTheme,
  ambientPaused,
  reducedMotion,
  onThemeCycle,
  onAmbientToggle,
}: SidebarProps): React.JSX.Element {
  const workspaceItems: {
    label: string;
    shortLabel: string;
    icon: typeof CalendarDays;
    view: WorkspaceView;
    badge?: string;
  }[] = [
    {
      label: "日程",
      shortLabel: "日程",
      icon: CalendarDays,
      view: "schedule",
    },
    {
      label: "仓库数据",
      shortLabel: "仓库",
      icon: BarChart3,
      view: "metrics",
    },
    {
      label: "资料中心",
      shortLabel: "资料",
      icon: FileArchive,
      view: "resources",
    },
    {
      label: "知识库",
      shortLabel: "知识",
      icon: LibraryBig,
      view: "vault",
    },
  ];

  return (
    <aside
      id="cockpit-sidebar"
      className="sidebar-shell min-h-full"
      data-collapsed={collapsed ? "true" : "false"}
      aria-label="主导航"
    >
      <div className="brand-lockup">
        <div className="brand-mark" aria-hidden="true">PC</div>
        <div className="sidebar-copy">
          <p className="brand-name">PERSONAL COCKPIT</p>
          <p className="brand-caption">个人工作台 · LOCAL</p>
        </div>
        <span className="sidebar-rail-label">工作台</span>
      </div>

      <ul className="menu sidebar-menu w-full gap-1.5 p-0">
        <li className="menu-title sidebar-nav-label">
          <span className="sidebar-copy">导航</span>
          <span className="sidebar-rail-label">导航</span>
        </li>
        <li>
          <button
            className={activeView === "home" ? "menu-active" : ""}
            type="button"
            title="今日总览"
            aria-label="今日总览"
            aria-current={activeView === "home" ? "page" : undefined}
            onClick={() => onViewChange("home")}
          >
            <LayoutGrid size={18} />
            <span className="sidebar-copy">今日总览</span>
            <span className="sidebar-rail-label">总览</span>
          </button>
        </li>
        {workspaceItems.map(
          ({ label, shortLabel, icon: Icon, view, badge }) => (
            <li key={label}>
              <button
                className={activeView === view ? "menu-active" : ""}
                type="button"
                title={label}
                aria-label={label}
                aria-current={activeView === view ? "page" : undefined}
                onClick={() => onViewChange(view)}
              >
                <Icon size={18} />
                <span className="sidebar-copy">{label}</span>
                <span className="sidebar-rail-label">{shortLabel}</span>
                {badge !== undefined && (
                  <span className="sidebar-copy ml-auto text-[10px] tracking-wider">
                    {badge}
                  </span>
                )}
              </button>
            </li>
          ),
        )}
      </ul>

      <div className="sidebar-appearance" aria-label="外观设置">
        <button
          className="sidebar-appearance-button"
          type="button"
          onClick={onThemeCycle}
          aria-label={`切换主题，当前${themeMode === "system" ? "跟随系统" : resolvedTheme === "dark" ? "深色" : "浅色"}`}
          title="切换主题"
        >
          {themeMode === "system" ? (
            <Monitor size={17} />
          ) : resolvedTheme === "dark" ? (
            <Moon size={17} />
          ) : (
            <Sun size={17} />
          )}
          <span className="sidebar-copy sidebar-appearance-copy">
            <strong>界面主题</strong>
            <small>
              {themeMode === "system" ? "跟随系统" : resolvedTheme === "dark" ? "暗色驾驶舱" : "清爽浅色"}
            </small>
          </span>
          <span className="sidebar-rail-label">
            {resolvedTheme === "dark" ? "暗色" : "浅色"}
          </span>
        </button>
        <button
          className="sidebar-appearance-button"
          type="button"
          onClick={onAmbientToggle}
          aria-label={reducedMotion ? "系统已启用减少动态效果" : ambientPaused ? "恢复背景动效" : "暂停背景动效"}
          aria-pressed={ambientPaused}
          title={reducedMotion ? "系统已减少动态效果" : ambientPaused ? "恢复背景动效" : "暂停背景动效"}
          disabled={reducedMotion}
        >
          {ambientPaused ? <Play size={17} /> : <Pause size={17} />}
          <span className="sidebar-copy sidebar-appearance-copy">
            <strong>背景动效</strong>
            <small>{reducedMotion ? "遵循系统减少动态" : ambientPaused ? "已暂停" : "低频运行中"}</small>
          </span>
          <span className="sidebar-rail-label">{ambientPaused ? "静态" : "动态"}</span>
        </button>
      </div>

      <button
        className="sidebar-toggle"
        type="button"
        onClick={onToggle}
        aria-label={collapsed ? "展开侧边栏" : "收起侧边栏"}
        title={collapsed ? "展开侧边栏" : "收起侧边栏"}
      >
        {collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
        <span className="sidebar-copy">
          {collapsed ? "展开侧边栏" : "收起侧边栏"}
        </span>
        <span className="sidebar-rail-label">{collapsed ? "展开" : "收起"}</span>
      </button>
    </aside>
  );
}
