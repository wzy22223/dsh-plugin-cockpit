import { AlertTriangle, PrinterCheck, RefreshCw } from "lucide-react";
import { CountUp } from "./CountUp";

interface ErpExceptionStripProps {
  data: { 发货上传失败?: number; 打单超2次?: number; generated_at?: string } | null;
  loading: boolean;
  error: boolean;
  onOpen: () => void;
  onRetry?: () => void;
}

export function ErpExceptionStrip({
  data,
  loading,
  error,
  onOpen,
  onRetry,
}: ErpExceptionStripProps): React.JSX.Element {
  const failed = data?.["发货上传失败"];
  const repeat = data?.["打单超2次"];

  const cards = data
    ? [
        {
          label: "发货失败",
          value: failed ?? 0,
          unit: "单",
          danger: (failed ?? 0) > 0,
          icon: AlertTriangle,
        },
        {
          label: "打单超2次",
          value: repeat ?? 0,
          unit: "单",
          danger: (repeat ?? 0) > 0,
          icon: PrinterCheck,
        },
      ]
    : [
        { label: "发货失败", value: "—", unit: "单", danger: false, icon: AlertTriangle },
        { label: "打单超2次", value: "—", unit: "单", danger: false, icon: PrinterCheck },
      ];

  return (
    <section className="home-erp-exception-strip" aria-label="聚水潭异常订单">
      <header className="home-erp-exception-head">
        <div className="home-erp-exception-title">
          <AlertTriangle size={18} />
          <h3>聚水潭异常</h3>
        </div>
        <div className="home-erp-exception-freshness" role={error ? "alert" : "status"}>
          {data?.generated_at ? (
            <span>更新于 {data.generated_at}</span>
          ) : loading ? (
            <span>加载中…</span>
          ) : error ? (
            <>
              <span className="text-error">加载失败</span>
              {onRetry !== undefined && (
                <button
                  className="home-erp-exception-retry"
                  type="button"
                  onClick={onRetry}
                >
                  <RefreshCw size={13} />
                  重试
                </button>
              )}
            </>
          ) : (
            <span>暂无数据</span>
          )}
        </div>
        <button
          className="home-erp-exception-detail"
          type="button"
          onClick={onOpen}
        >
          去处理
        </button>
      </header>
      <div className="home-erp-exception-band">
        {cards.map((c) => {
          const Icon = c.icon;
          return (
            <article
              key={c.label}
              className={`home-erp-exception-metric${c.danger ? " is-danger" : ""}`}
            >
              <div className="home-erp-exception-metric-label">
                <Icon size={14} />
                <span>{c.label}</span>
              </div>
              <strong className="home-erp-exception-metric-value">
                {typeof c.value === "number" ? (
                  <CountUp value={c.value} />
                ) : (
                  c.value
                )}
                <small>{c.unit}</small>
              </strong>
            </article>
          );
        })}
      </div>
    </section>
  );
}
