import { useEffect, useRef, useState } from "react";

const nf = new Intl.NumberFormat("zh-CN");

/**
 * 数字滚动（Count Up）：挂载时从 0 滚动到目标值，值变化时从旧值滚动到新值。
 * easeOutQuart 缓动（克制微交互，禁弹跳缓动）；prefers-reduced-motion 时直接跳变。
 * 千分位格式化与仓管数据 toLocaleString("zh-CN") 一致。
 */
export function CountUp({
  value,
  duration = 900,
}: {
  value: number;
  duration?: number;
}): React.JSX.Element {
  const [display, setDisplay] = useState(0);
  const fromRef = useRef(0);

  useEffect(() => {
    if (
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    ) {
      setDisplay(value);
      fromRef.current = value;
      return;
    }
    const from = fromRef.current;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - p, 4); // easeOutQuart
      setDisplay(from + (value - from) * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
      else fromRef.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);

  return <>{nf.format(Math.round(display))}</>;
}
