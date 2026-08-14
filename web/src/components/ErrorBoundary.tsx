/**
 * 轻量 ErrorBoundary — 防止单个组件崩溃导致整页白屏
 * 适合 Personal Cockpit 这类本地单用户工作台：
 * - 崩溃信息以调试模式 console 输出
 * - UI 显示「该模块临时不可用」+ 重试按钮，不影响其他视图
 */
import { Component, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: (error: Error, reset: () => void) => ReactNode;
  /** 用于日志定位的模块名 */
  module?: string;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string }): void {
    // eslint-disable-next-line no-console
    console.error(
      `[ErrorBoundary${this.props.module ? ` · ${this.props.module}` : ""}]`,
      error,
      info.componentStack,
    );
  }

  reset = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): ReactNode {
    if (this.state.hasError && this.state.error) {
      if (this.props.fallback) {
        return this.props.fallback(this.state.error, this.reset);
      }
      return (
        <div className="error-boundary-fallback" role="alert">
          <strong>该模块临时不可用</strong>
          <p className="error-boundary-message">{this.state.error.message}</p>
          <button
            className="btn btn-primary btn-sm"
            type="button"
            onClick={this.reset}
          >
            重试
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}