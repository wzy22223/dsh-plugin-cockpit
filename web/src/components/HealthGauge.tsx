/**
 * HealthGauge — 健康度弧形仪表（首页仓库速览的"签名时刻"）
 * 半圆弧 + 渐变描边 + 中心大数字；mount 时描边从 0 增长到目标值。
 * 遵循项目红线：仅 transform/opacity/stroke 动画、prefers-reduced-motion 兜底、令牌取色、无 emoji。
 */
import { useEffect, useId, useState } from "react";

interface HealthGaugeProps {
  /** 0–100 的健康度百分比 */
  percent: number;
  /** 仪表标签（如「健康 SKU 占比」） */
  label: string;
  /** 渲染宽度（px），高度按 62/100 比例 */
  size?: number;
}

const ARC_RADIUS = 42;
const ARC_LENGTH = Math.PI * ARC_RADIUS; // ≈ 131.95

export function HealthGauge({
  percent,
  label,
  size = 84,
}: HealthGaugeProps): React.JSX.Element {
  const rawId = useId();
  const gradientId = rawId.replace(/:/g, "healthgauge");
  const clamped = Math.max(0, Math.min(100, percent));
  const [shown, setShown] = useState(0);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setShown(clamped);
      return;
    }
    const raf = window.requestAnimationFrame(() => setShown(clamped));
    return () => window.cancelAnimationFrame(raf);
  }, [clamped]);

  const dash = (ARC_LENGTH * shown) / 100;
  const tone = clamped >= 80 ? "is-good" : clamped >= 60 ? "is-mid" : "is-low";
  const height = Math.round(size * 0.62);

  return (
    <div
      className={`health-gauge ${tone}`}
      role="img"
      aria-label={`${label} ${Math.round(clamped)}%`}
      style={{ width: size, height }}
    >
      <svg viewBox="0 0 100 62" width={size} height={height} aria-hidden="true">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="var(--color-primary)" />
            <stop offset="100%" stopColor="var(--color-primary-active)" />
          </linearGradient>
        </defs>
        <path
          className="health-gauge-track"
          d="M 8 54 A 42 42 0 0 1 92 54"
          fill="none"
        />
        <path
          className="health-gauge-arc"
          d="M 8 54 A 42 42 0 0 1 92 54"
          fill="none"
          stroke={`url(#${gradientId})`}
          strokeDasharray={`${dash.toFixed(2)} ${ARC_LENGTH.toFixed(2)}`}
        />
      </svg>
      <div className="health-gauge-center">
        <strong>
          {Math.round(shown)}
          <small>%</small>
        </strong>
        <span>{label}</span>
      </div>
    </div>
  );
}
