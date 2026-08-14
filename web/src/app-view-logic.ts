/**
 * App 视图切换纯逻辑（P1-4）
 * 抽成独立模块，避免测试时因 PiPanel 顶层 window 引用而触发 jsdom 依赖。
 * 渲染层 App.tsx 直接复用这些纯函数。
 */
export type WorkspaceView = "home" | "schedule" | "metrics" | "resources" | "vault" | "pi";

/** 侧边栏点击某视图 → 切换 activeView 并关闭抽屉 */
export function transitionView(
  view: WorkspaceView,
): { activeView: WorkspaceView; drawerOpen: boolean } {
  return { activeView: view, drawerOpen: false };
}

/** Pi 按钮点击：切到 pi 视图、清零未读、关抽屉 */
export function transitionToPi(): {
  activeView: WorkspaceView;
  piUnread: number;
  drawerOpen: boolean;
} {
  return { activeView: "pi", piUnread: 0, drawerOpen: false };
}
