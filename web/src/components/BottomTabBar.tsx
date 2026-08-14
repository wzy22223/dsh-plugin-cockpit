import {
  BarChart3,
  CalendarDays,
  FileArchive,
  LayoutGrid,
  LibraryBig,
} from "lucide-react";
import type { WorkspaceView } from "../App";

interface BottomTabBarProps {
  activeView: WorkspaceView;
  onViewChange: (view: WorkspaceView) => void;
}

const TAB_ITEMS: Array<{
  label: string;
  icon: typeof LayoutGrid;
  view: WorkspaceView;
}> = [
  { label: "总览", icon: LayoutGrid, view: "home" },
  { label: "日程", icon: CalendarDays, view: "schedule" },
  { label: "仓库", icon: BarChart3, view: "metrics" },
  { label: "资料", icon: FileArchive, view: "resources" },
  { label: "知识", icon: LibraryBig, view: "vault" },
];

/** 轻震反馈（仅支持 navigator.vibrate 的移动端生效，桌面端静默） */
function haptic(pattern: number | number[]): void {
  if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
    navigator.vibrate(pattern);
  }
}

export function BottomTabBar({
  activeView,
  onViewChange,
}: BottomTabBarProps): React.JSX.Element {
  return (
    <nav className="cockpit-tabbar" aria-label="主导航">
      {TAB_ITEMS.map(({ label, icon: Icon, view }) => {
        const active = activeView === view;
        return (
          <button
            key={view}
            type="button"
            className={`tabbar-item ${active ? "tabbar-item-active" : ""}`}
            aria-current={active ? "page" : undefined}
            onClick={() => {
              haptic(10);
              onViewChange(view);
            }}
          >
            <span className="tabbar-icon">
              <Icon size={21} strokeWidth={active ? 2.2 : 1.9} />
            </span>
            <span className="tabbar-label">{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
