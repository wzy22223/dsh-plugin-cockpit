import { memo, useEffect, useMemo, useState } from "react";
import { Radio } from "lucide-react";

function formatClock(date: Date): {
  date: string;
  time: string;
  seconds: string;
  weekday: string;
} {
  const pad = (value: number): string => String(value).padStart(2, "0");
  return {
    date: new Intl.DateTimeFormat("zh-CN", {
      month: "long",
      day: "numeric",
    }).format(date),
    time: `${pad(date.getHours())}:${pad(date.getMinutes())}`,
    seconds: pad(date.getSeconds()),
    weekday: new Intl.DateTimeFormat("zh-CN", {
      weekday: "long",
    }).format(date),
  };
}

/**
 * 状态条（时钟 + 模式 + 连接状态）。
 * 时钟每秒 tick 隔离在本组件内，避免每秒重渲染整个 App 树。
 */
export const FlightStrip = memo(function FlightStrip(): React.JSX.Element {
  const [now, setNow] = useState(() => new Date());
  const clock = useMemo(() => formatClock(now), [now]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <section className="flight-strip" aria-label="当前工作台状态">
      <div className="flight-time">
        <span className="flight-clock">
          {clock.time}
          <em aria-label={`${clock.seconds} 秒`}>:{clock.seconds}</em>
        </span>
        <div className="flight-date">
          <strong>{clock.date}</strong>
          <small>{clock.weekday}</small>
        </div>
      </div>
      <div className="flight-message">
        <Radio size={16} />
        <span>地基模式</span>
        <strong>入口已就绪，数据只保存在本机</strong>
      </div>
      <div className="flight-status">
        <span className="status status-success" />
        LOCAL / 127.0.0.1
      </div>
    </section>
  );
});
