import { ChevronDown, ChevronRight, ChevronUp, Minus, PackageCheck, RefreshCw, TrendingDown, TrendingUp } from "lucide-react";
import { useState } from "react";
import { CountUp } from "./CountUp";
import { HealthGauge } from "./HealthGauge";

interface WarehouseSnapshot {
  data_date: string;
  generated_at: string;
  shipment: { summary: Record<string, number | string> };
  inventory: { summary: Record<string, number | string> };
  returns: { summary: Record<string, number | string> };
  deltas?: Record<string, { delta: number; pct: number | null }>;
}

interface WarehouseStripProps {
  snap: WarehouseSnapshot | null;
  loading: boolean;
  error: boolean;
  onOpen: () => void;
  onRetry?: () => void;
}

export function WarehouseStrip({
  snap,
  loading,
  error,
  onOpen,
  onRetry,
}: WarehouseStripProps): React.JSX.Element {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem("cockpit.warehouse.collapsed");
      if (stored === "1") return true;
      if (stored === "0") return false;
      return window.matchMedia("(max-width: 48rem)").matches;
    } catch {
      return typeof window !== "undefined"
        && window.matchMedia("(max-width: 48rem)").matches;
    }
  });
  const S = snap?.shipment.summary ?? {};
  const I = snap?.inventory.summary ?? {};
  const R = snap?.returns.summary ?? {};
  const healthPercentRaw = Number.parseFloat(
    String(I["健康SKU占比"] ?? "").replace("%", ""),
  );
  const healthPercent = Number.isFinite(healthPercentRaw)
    ? Math.min(100, Math.max(0, healthPercentRaw))
    : undefined;

  const kpis: {
    label: string;
    value: number | string;
    unit?: string;
    note: string;
    attention?: boolean;
    health?: boolean;
    meter?: number;
    /** 环比字段：[模块, 字段, ...附加字段（求和）] */
    deltaKey?: [string, string, ...string[]];
    /** 上涨是好是坏（决定趋势颜色）：默认 up=好 */
    goodWhen?: "up" | "down";
  }[] = snap
    ? [
        {
          label: "昨日发货",
          value: Number(S["总昨日实发"] || 0),
          unit: "件",
          note: `${S["活跃款式数"] || 0} 款`,
          deltaKey: ["shipment", "总昨日实发"],
        },
        {
          label: "发货订单",
          value: Number(S["发货订单数"] || 0),
          unit: "单",
          note: "—",
          deltaKey: ["shipment", "发货订单数"],
        },
        {
          label: "昨日退货",
          value: Number(R["总退货量"] || 0),
          unit: "件",
          note: "—",
          deltaKey: ["returns", "总退货量"],
          goodWhen: "down",
        },
        {
          label: "库存预警",
          value: Number(I["缺货SKU数"] || 0) + Number(I["低库存SKU数"] || 0),
          note: "SKU",
          attention: true,
          deltaKey: ["inventory", "缺货SKU数", "低库存SKU数"],
          goodWhen: "down",
        },
        {
          label: "快需补货",
          value: Number(I["快需补货数"] || 0),
          note: "SKU",
          attention: true,
          deltaKey: ["inventory", "快需补货数"],
          goodWhen: "down",
        },
        {
          label: "滞销款",
          value: Number(I["滞销SKU数"] || 0),
          note: "SKU",
          attention: true,
          deltaKey: ["inventory", "滞销SKU数"],
          goodWhen: "down",
        },
        {
          label: "库存总量",
          value: Number(I["库存总量"] || 0),
          note: `健康 ${I["健康SKU占比"] || "0%"}`,
          health: true,
          ...(healthPercent !== undefined ? { meter: healthPercent } : {}),
          deltaKey: ["inventory", "库存总量"],
        },
      ]
    : [
        { label: "昨日发货", value: "—", unit: "件", note: "— 款" },
        { label: "发货订单", value: "—", unit: "单", note: "—" },
        { label: "昨日退货", value: "—", unit: "件", note: "—" },
        { label: "库存预警", value: "—", note: "SKU", attention: true },
        { label: "快需补货", value: "—", note: "SKU", attention: true },
        { label: "滞销款", value: "—", note: "SKU", attention: true },
        { label: "库存总量", value: "—", note: "健康 —", health: true },
      ];

  function toggleCollapsed(): void {
    setCollapsed((current) => {
      try {
        localStorage.setItem("cockpit.warehouse.collapsed", current ? "0" : "1");
      } catch {
        /* ignore */
      }
      return !current;
    });
  }

  /** 汇总 KPI 的环比（多字段求和；任一字段缺历史则视为无环比） */
  function kpiDelta(
    kpi: (typeof kpis)[number],
  ): { delta: number; pct: number | null } | null {
    const deltas = snap?.deltas;
    if (!deltas || !kpi.deltaKey) return null;
    let total = 0;
    for (let i = 1; i < kpi.deltaKey.length; i++) {
      const d = deltas[`${kpi.deltaKey[0]}:${kpi.deltaKey[i]}`];
      if (!d) return null;
      total += d.delta;
    }
    const main = deltas[`${kpi.deltaKey[0]}:${kpi.deltaKey[1]}`];
    return { delta: total, pct: main?.pct ?? null };
  }

  /** 趋势徽标：↑↓ 图标 + 变化百分比；涨跌颜色按 goodWhen 语义翻转 */
  function renderDelta(kpi: (typeof kpis)[number]): React.JSX.Element | null {
    const d = kpiDelta(kpi);
    if (d === null || d.delta === 0) return null;
    const up = d.delta > 0;
    const good = kpi.goodWhen === "down" ? !up : up;
    const cls = `metric-delta${up ? " is-up" : " is-down"}${good ? " is-good" : " is-bad"}`;
    const Icon = up ? TrendingUp : TrendingDown;
    return (
      <span className={cls} title={up ? "较上一数据日上涨" : "较上一数据日下降"}>
        <Icon size={12} aria-hidden="true" />
        {d.pct !== null ? `${Math.abs(d.pct)}%` : "—"}
      </span>
    );
  }

  return (
    <section className="home-warehouse-strip" aria-label="仓库今日速览">
      <header className="home-warehouse-strip-head">
        <div className="home-warehouse-title">
          <PackageCheck size={18} />
          <h3>仓库今日速览</h3>
        </div>
        <div
          className="home-warehouse-freshness"
          role={error ? "alert" : "status"}
        >
          {snap ? (
            <>
              <b>数据日期</b>
              <span>{snap.data_date}</span>
              <span aria-hidden="true">·</span>
              <b>生成时间</b>
              <span>{snap.generated_at}</span>
            </>
          ) : loading ? (
            <span>加载中…</span>
          ) : error ? (
            <>
              <span className="text-error">加载失败</span>
              {onRetry !== undefined && (
                <button
                  className="home-warehouse-retry"
                  type="button"
                  onClick={onRetry}
                >
                  <RefreshCw size={13} />
                  重试
                </button>
              )}
            </>
          ) : (
            <span>暂无仓库数据</span>
          )}
        </div>
        <button
          className="home-warehouse-detail"
          type="button"
          onClick={onOpen}
        >
          查看详情
          <ChevronRight size={16} />
        </button>
        <button
          className="home-warehouse-collapse"
          type="button"
          aria-expanded={!collapsed}
          aria-label={collapsed ? "展开仓库明细" : "收起仓库明细"}
          title={collapsed ? "展开明细" : "收起明细"}
          onClick={toggleCollapsed}
        >
          {collapsed ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
      </header>
      {collapsed ? (
        <div className="home-warehouse-digest" aria-label="仓库关键指标摘要">
          <span className="home-warehouse-digest-lead">
            需要关注
          </span>
          {[3, 4, 5].map((idx) => {
            const kpi = kpis[idx];
            if (kpi === undefined) {
              return null;
            }
            return (
              <span
                className="home-warehouse-digest-item is-attention"
                key={kpi.label}
              >
                {kpi.label}
                <strong>
                  {typeof kpi.value === "number" ? (
                    <CountUp value={kpi.value} />
                  ) : (
                    kpi.value
                  )}
                </strong>
                {kpi.unit !== undefined ? kpi.unit : ""}
              </span>
            );
          })}
          {healthPercent !== undefined && (
            <HealthGauge
              percent={healthPercent}
              label="健康占比"
              size={76}
            />
          )}
        </div>
      ) : (
        <>
          <div className="home-warehouse-kpi-groups" aria-hidden="true">
            <div className="home-warehouse-kpi-group is-flow">
              <span />
              流转
            </div>
            <div className="home-warehouse-kpi-group is-attention">
              <span />
              需要关注
            </div>
            <div className="home-warehouse-kpi-group is-stock">
              <span />
              库存
            </div>
          </div>
          <div className="home-warehouse-kpi-band" aria-label="仓库七项关键指标">
            {kpis.map((kpi) => (
              <article
                key={kpi.label}
                className={`home-warehouse-metric${kpi.attention ? " is-attention is-lead" : ""}${kpi.health ? " is-health" : ""}`}
              >
                {kpi.health && healthPercent !== undefined ? (
                  <>
                    <div className="home-warehouse-metric-main">
                      <div className="home-warehouse-metric-label">
                        <span>{kpi.label}</span>
                        {renderDelta(kpi)}
                      </div>
                      <strong className="home-warehouse-metric-value">
                        {typeof kpi.value === "number" ? (
                          <CountUp value={kpi.value} />
                        ) : (
                          kpi.value
                        )}
                        {kpi.unit ? <small>{kpi.unit}</small> : null}
                      </strong>
                      <span className="home-warehouse-metric-note is-health">
                        {kpi.note}
                      </span>
                    </div>
                    <HealthGauge
                      percent={healthPercent}
                      label="健康占比"
                      size={64}
                    />
                  </>
                ) : (
                  <>
                    <div className="home-warehouse-metric-label">
                      <span>{kpi.label}</span>
                      <span className="home-warehouse-metric-label-right">
                        {kpi.attention && snap ? (
                          <span className="home-warehouse-metric-flag">关注</span>
                        ) : null}
                        {renderDelta(kpi)}
                      </span>
                    </div>
                    <strong className="home-warehouse-metric-value">
                      {typeof kpi.value === "number" ? (
                        <CountUp value={kpi.value} />
                      ) : (
                        kpi.value
                      )}
                      {kpi.unit ? <small>{kpi.unit}</small> : null}
                    </strong>
                    <span
                      className={`home-warehouse-metric-note${kpi.health ? " is-health" : ""}`}
                    >
                      {kpi.note}
                    </span>
                    <span
                      className={`home-warehouse-meter${kpi.attention ? " is-attention" : ""}${kpi.health ? " is-health" : ""}${kpi.meter !== undefined ? " has-value" : ""}`}
                      aria-hidden="true"
                    >
                      <span
                        style={kpi.meter !== undefined ? { width: `${kpi.meter}%` } : undefined}
                      />
                    </span>
                  </>
                )}
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
