import {
  AlertTriangle,
  Boxes,
  Calendar,
  ChevronDown,
  ChevronRight,
  Download,
  FileText,
  Globe,
  PackageCheck,
  PackageOpen,
  PrinterCheck,
  ShoppingCart,
  TrendingDown,
  TrendingUp,
  Zap,
} from "lucide-react";
import { Fragment, useEffect, useRef, useState } from "react";
import { toPng } from "html-to-image";

import { CountUp } from "../components/CountUp";
import type {
  BM,
  IM,
  II,
  PM,
  RM,
  RM2,
  SM,
  SS,
  WD,
} from "./warehouse-types";
import { BarChart, ExportButton } from "./WarehouseCharts";

function Shipment({ d, repeatPrint }: { d: SM; repeatPrint?: number }): React.JSX.Element {
  const [ex, setEx] = useState<Set<string>>(new Set());
  const to = (s: string) =>
    setEx((p) => {
      const n = new Set(p);
      n.has(s) ? n.delete(s) : n.add(s);
      return n;
    });
  const t15 = d.by_style.slice(0, 15);
  const mx = (t15[0]?.["昨日实发"] ?? 1) as number;
  const repeatVal = repeatPrint ?? 0;
  return (
    <div className="warehouse-panel">
      <div className={`warehouse-exception-banner${repeatVal > 0 ? " is-alert" : ""}`}>
        <PrinterCheck size={16} />
        <span className="warehouse-exception-label">打单超2次</span>
        <strong className="warehouse-exception-count">
          <CountUp value={repeatVal} />
        </strong>
        <span className="warehouse-exception-unit">单</span>
        {repeatVal > 0 ? (
          <span className="warehouse-exception-hint">需核查重复打印订单</span>
        ) : (
          <span className="warehouse-exception-hint">今日无异常</span>
        )}
      </div>
      <div className="warehouse-section-block">
        <h3 className="warehouse-section-title">
          <TrendingUp size={18} /> TOP15 款式 昨日发货
        </h3>
        <BarChart d={t15.map((s) => ({ l: s.style, v: s["昨日实发"] }))} m={mx} />
      </div>
      <div className="warehouse-section-scroll">
        <h3 className="warehouse-section-title mt-6">
          <PackageCheck size={18} /> 昨日发货明细
        </h3>
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th></th>
                <th>款式</th>
                <th data-numeric="true">昨日实发</th>
                <th data-numeric="true">昨日销量</th>
                <th data-numeric="true">月实发</th>
                <th data-numeric="true">可用数</th>
              </tr>
            </thead>
            <tbody>
              {d.by_style.map((s) => {
                const op = ex.has(s.style);
                return (
                  <Fragment key={s.style}>
                    <tr className={op ? "row-open" : ""}>
                      <td>
                        <button
                          type="button"
                          className="row-toggle"
                          onClick={() => to(s.style)}
                          aria-label={`${op ? "收起" : "展开"} ${s.style} 的 SKU 详情`}
                          aria-expanded={op}
                          data-open={op ? "true" : "false"}
                        >
                          <ChevronRight size={14} aria-hidden="true" />
                        </button>
                      </td>
                      <td data-wrap="true" className="font-medium">{s.style}</td>
                      <td data-numeric="true">
                        {(s["昨日实发"] || 0).toLocaleString()}
                      </td>
                      <td data-numeric="true">
                        {(s["昨日销量"] || 0).toLocaleString()}
                      </td>
                      <td data-numeric="true">
                        {(s.月实发 || 0).toLocaleString()}
                      </td>
                      <td data-numeric="true">
                        {(s.可用数 || 0).toLocaleString()}
                      </td>
                    </tr>
                    {op &&
                      s.skus &&
                      s.skus.length > 0 && (
                        <tr className="row-detail">
                          <td colSpan={6}>
                            <div className="row-detail-inner">
                              <strong className="text-xs text-base-content/60 mb-2 block">
                                SKU 详情（{s.skus.length}个已发货）
                              </strong>
                              <table className="data-table data-table-reason">
                                <tbody>
                                  {s.skus.map((k) => (
                                    <tr key={k.sku}>
                                      <td className="font-mono text-xs">
                                        {k.sku}
                                      </td>
                                      <td className="text-right">
                                        昨{k["昨日实发"]}
                                      </td>
                                      <td className="text-right">
                                        可{k.可用数}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </td>
                        </tr>
                      )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Returns({ d }: { d: RM }): React.JSX.Element {
  const [ex, setEx] = useState<Set<string>>(new Set());
  const to = (s: string) =>
    setEx((p) => {
      const n = new Set(p);
      n.has(s) ? n.delete(s) : n.add(s);
      return n;
    });
  const t15 = d.by_style.filter((x) => (x["昨日退货量"] || 0) > 0).slice(0, 15);
  const mx = (t15[0]?.["昨日退货量"] ?? 1) as number;
  return (
    <div className="warehouse-panel">
      <div className="warehouse-section-block">
        <h3 className="warehouse-section-title">
          <TrendingDown size={18} /> TOP15 退货款式（点击展开原因）
        </h3>
        {t15.length > 0 ? (
          <div className="warehouse-expand-bars">
            {t15.map((s, index) => (
              <div
                className="expand-bar-row"
                key={s.style}
                data-open={ex.has(s.style) ? "true" : "false"}
              >
                <button
                  type="button"
                  className="expand-bar-header"
                  onClick={() => to(s.style)}
                  aria-expanded={ex.has(s.style)}
                  aria-controls={`return-reasons-${index}`}
                >
                  <span className="bar-label" title={s.style}>
                    {s.style}
                  </span>
                  <div className="bar-track">
                    <div
                      className="bar-fill"
                      style={
                        {
                          width: `${Math.min(((s["昨日退货量"] || 0) / (mx || 1)) * 100, 100)}%`,
                          backgroundColor: "var(--color-error)",
                          "--i": index,
                        } as React.CSSProperties
                      }
                    />
                  </div>
                  <span className="bar-value">{s["昨日退货量"]}</span>
                  <span className="expand-bar-arrow">
                    <ChevronDown size={14} aria-hidden="true" />
                  </span>
                </button>
                <div
                  className="expand-bar-body"
                  id={`return-reasons-${index}`}
                  hidden={!ex.has(s.style)}
                >
                  {s.退货原因 &&
                  Object.keys(s.退货原因).length > 0 ? (
                    <table className="data-table data-table-reason">
                      <tbody>
                        {Object.entries(s.退货原因)
                          .sort((a, b) => b[1] - a[1])
                          .map(([r, c]) => (
                            <tr key={r}>
                              <td className="text-sm">{r}</td>
                              <td className="text-right font-semibold">{c}</td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  ) : (
                    <p className="text-xs text-base-content/55 px-2 py-1">
                      无详细原因
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-base-content/55">昨日无退货</p>
        )}
      </div>
      <div className="warehouse-section-scroll">
        <h3 className="warehouse-section-title mt-6">
          <PackageOpen size={18} /> 退货明细
        </h3>
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th></th>
                <th>款式</th>
                <th data-numeric="true">昨日退货</th>
                <th data-numeric="true">月退货</th>
                <th data-numeric="true">销退在途</th>
              </tr>
            </thead>
            <tbody>
              {d.by_style
                .filter((x) => (x["昨日退货量"] || x.月退货量 || 0) > 0)
                .map((s) => {
                  const op = ex.has(s.style + "_det");
                  return (
                    <Fragment key={s.style}>
                      <tr className={op ? "row-open" : ""}>
                        <td>
                          <button
                            type="button"
                            className="row-toggle"
                            onClick={() => to(s.style + "_det")}
                            aria-label={`${op ? "收起" : "展开"} ${s.style} 的退货原因`}
                            aria-expanded={op}
                            data-open={op ? "true" : "false"}
                          >
                            <ChevronRight size={14} aria-hidden="true" />
                          </button>
                        </td>
                        <td data-wrap="true" className="font-medium">{s.style}</td>
                        <td data-numeric="true">{s["昨日退货量"]}</td>
                        <td data-numeric="true">{s.月退货量}</td>
                        <td data-numeric="true">{s.销退在途}</td>
                      </tr>
                      {op && (
                        <tr className="row-detail">
                          <td colSpan={5}>
                            <div className="row-detail-inner">
                              <strong className="text-xs text-base-content/60 mb-2 block">
                                退货原因
                              </strong>
                              {s.退货原因 &&
                              Object.keys(s.退货原因).length > 0 ? (
                                <table className="data-table data-table-reason">
                                  <tbody>
                                    {Object.entries(s.退货原因)
                                      .sort((a, b) => b[1] - a[1])
                                      .map(([r, c]) => (
                                        <tr key={r}>
                                          <td>{r}</td>
                                          <td className="text-right">{c}</td>
                                        </tr>
                                      ))}
                                  </tbody>
                                </table>
                              ) : (
                                <p className="text-xs text-base-content/40">
                                  无原因数据
                                </p>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
﻿function Inventory({ d }: { d: IM }): React.JSX.Element {
  const [ex, setEx] = useState<Set<string>>(new Set());
  const [secExp, setSecExp] = useState<Set<string>>(new Set());
  const [excludedSkus, setExcludedSkus] = useState<Set<string>>(new Set());
  const today = new Date().toISOString().slice(0, 10);

  useEffect(() => {
    const load = () => {
      try {
        const raw = localStorage.getItem("warehouse_excluded_skus");
        if (raw) setExcludedSkus(new Set(JSON.parse(raw) as string[]));
      } catch {
        /* ignore */
      }
    };
    load();
    window.addEventListener("storage", load);
    return () => window.removeEventListener("storage", load);
  }, []);

  const toggleExclude = (sku: string) => {
    setExcludedSkus((prev) => {
      const n = new Set(prev);
      n.has(sku) ? n.delete(sku) : n.add(sku);
      try {
        localStorage.setItem("warehouse_excluded_skus", JSON.stringify([...n]));
      } catch {
        /* ignore */
      }
      return n;
    });
  };

  const to = (s: string) =>
    setEx((p) => {
      const n = new Set(p);
      n.has(s) ? n.delete(s) : n.add(s);
      return n;
    });
  const toggleSec = (s: string) =>
    setSecExp((p) => {
      const n = new Set(p);
      n.has(s) ? n.delete(s) : n.add(s);
      return n;
    });

  const a = d.alerts;
  const stockWarn = [
    ...a.缺货.map((i) => ({ ...i, level: "缺货", isOos: true })),
    ...a.低库存.map((i) => ({ ...i, level: "低库存", isOos: false })),
  ].sort((x, y) => (x.可售天数 ?? 999) - (y.可售天数 ?? 999));
  const oversell = a.超卖;
  const urgent = a.快需补货;
  const stale180 = a.滞销_180天;
  const stale90 = a.滞销_90天;
  const stale60 = a.滞销_60天;
  const stale30 = a.滞销_30天;

  const StaleTable = ({
    rows,
    sec,
  }: {
    rows: II[];
    sec: string;
  }) => (
    <div className="data-table-wrapper">
      <table className="data-table">
        <thead>
          <tr>
            <th></th>
            <th>SKU</th>
            <th>款式</th>
            <th data-numeric="true">可用</th>
            <th data-numeric="true">占有</th>
            <th data-numeric="true">周转天数</th>
          </tr>
        </thead>
        <tbody>
          {(secExp.has(sec) ? rows : rows.slice(0, 15)).map((item) => {
            const op = ex.has(sec + "_" + item.sku);
            return (
              <Fragment key={item.sku}>
                <tr className={op ? "row-open" : ""}>
                  <td>
                    <button
                      type="button"
                      className="row-toggle"
                      onClick={() => to(sec + "_" + item.sku)}
                      aria-label={`${op ? "收起" : "展开"} ${item.sku} 的滞销详情`}
                      aria-expanded={op}
                      data-open={op ? "true" : "false"}
                    >
                      <ChevronRight size={14} aria-hidden="true" />
                    </button>
                  </td>
                  <td data-wrap="true" className="font-mono text-xs">{item.sku}</td>
                  <td data-wrap="true">{item.product}</td>
                  <td data-numeric="true">{item.可用数}</td>
                  <td data-numeric="true">{item.订单占有}</td>
                  <td data-numeric="true">{item.周转天数}</td>
                </tr>
                {op && (
                  <tr className="row-detail">
                    <td colSpan={6}>
                      <div className="row-detail-inner">
                        <span className="text-xs text-base-content/60">
                          可销: {item.可销天数 ?? "-"} · 月销量: {item.月销量 || 0}
                        </span>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="warehouse-panel">
      {oversell.length > 0 && (
        <div className="warehouse-section-block">
          <h3 className="warehouse-section-title">
            <AlertTriangle size={18} className="text-error" /> 超卖未下单 (
            {oversell.length}SKU)
          </h3>
          <div className="data-table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>款式</th>
                  <th data-numeric="true">可用</th>
                  <th data-numeric="true">在途</th>
                  <th data-numeric="true">缺口</th>
                </tr>
              </thead>
              <tbody>
                {oversell.map((i) => (
                  <tr key={i.sku} className="row-critical">
                    <td data-wrap="true" className="font-mono text-xs">{i.sku}</td>
                    <td data-wrap="true">{i.product}</td>
                    <td data-numeric="true" className="text-error font-semibold">
                      {i.可用数}
                    </td>
                    <td data-numeric="true">{i.采购在途}</td>
                    <td data-numeric="true" className="text-error font-semibold">
                      {(i.可用数 ?? 0) + (i.采购在途 ?? 0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {urgent.length > 0 && (
        <div className="warehouse-section-block">
          <h3 className="warehouse-section-title">
            <Zap size={18} className="text-warning" /> 快需补货 ({urgent.length}SKU)
          </h3>
          <div className="data-table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>款式</th>
                  <th data-numeric="true">可用</th>
                  <th data-numeric="true">在途</th>
                  <th data-numeric="true">月销量</th>
                  <th>补货标签</th>
                </tr>
              </thead>
              <tbody>
                {urgent.map((i) => (
                  <tr key={i.sku} className="row-warning">
                    <td data-wrap="true" className="font-mono text-xs">{i.sku}</td>
                    <td data-wrap="true">{i.product}</td>
                    <td data-numeric="true">{i.可用数}</td>
                    <td data-numeric="true">{i.采购在途}</td>
                    <td data-numeric="true">{i.月销量 || 0}</td>
                    <td data-wrap="true">{i.补货标签 || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="warehouse-section-title mt-8">
        <AlertTriangle size={18} className="text-error" /> 库存预警 — 缺货/低库存 (
        {stockWarn.length}SKU)
        {stockWarn.length > 0 && (
          <ExportButton
            filename={`库存预警-${today}.csv`}
            headers={["SKU", "款式", "可用", "可售天数", "日均销量", "日均退货", "在途", "紧急度", "标记"]}
            rows={stockWarn.map((i) => [
              i.sku,
              i.product,
              i.可用数,
              i.可售天数,
              i.日均销量 || 0,
              i.日均退货 || 0,
              i.采购在途,
              i.level,
              excludedSkus.has(i.sku) ? "清仓不补" : "",
            ])}
          />
        )}
      </div>
      {stockWarn.length === 0 ? (
        <p className="text-success text-sm">无预警SKU</p>
      ) : (
        <>
          <div className="data-table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th></th>
                  <th>SKU</th>
                  <th>款式</th>
                  <th data-numeric="true">可用</th>
                  <th data-numeric="true">可售天数</th>
                  <th data-numeric="true">日均销量</th>
                  <th data-numeric="true">日均退货</th>
                  <th data-numeric="true">在途</th>
                  <th>紧急度</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {(secExp.has("sw") ? stockWarn : stockWarn.slice(0, 15)).map(
                  (item) => {
                    const op = ex.has("sw_" + item.sku);
                    const isCl = excludedSkus.has(item.sku);
                    return (
                      <Fragment key={item.sku}>
                        <tr
                          className={
                            (item.isOos ? "row-critical" : "row-warning") +
                            " " +
                            (op ? "row-open" : "")
                          }
                        >
                          <td>
                            <button
                              type="button"
                              className="row-toggle"
                              onClick={() => to("sw_" + item.sku)}
                              aria-label={`${op ? "收起" : "展开"} ${item.sku} 的预警详情`}
                              aria-expanded={op}
                              data-open={op ? "true" : "false"}
                            >
                              <ChevronRight size={14} aria-hidden="true" />
                            </button>
                          </td>
                          <td data-wrap="true" className="font-mono text-xs">{item.sku}</td>
                          <td data-wrap="true">
                            {item.product}
                            {isCl && (
                              <span className="ml-1 text-xs text-success border border-success/50 rounded px-1 font-medium">
                                清仓不补
                              </span>
                            )}
                          </td>
                          <td
                            data-numeric="true"
                            className={item.isOos ? "text-error font-semibold" : ""}
                          >
                            {item.可用数}
                          </td>
                          <td
                            data-numeric="true"
                            className={
                              item.isOos
                                ? "text-error font-semibold"
                                : "text-warning font-semibold"
                            }
                          >
                            {item.可售天数}
                          </td>
                          <td data-numeric="true">{item.日均销量 || 0}</td>
                          <td data-numeric="true">{item.日均退货 || 0}</td>
                          <td data-numeric="true">{item.采购在途}</td>
                          <td>
                            <span
                              className={
                                item.isOos
                                  ? "daily-status daily-status-critical"
                                  : "daily-status daily-status-warn"
                              }
                            >
                              {item.level}
                            </span>
                          </td>
                          <td>
                            <button
                              className="btn btn-ghost btn-xs text-base-content/55 hover:text-base-content"
                              onClick={() => toggleExclude(item.sku)}
                              aria-label={
                                isCl
                                  ? `取消 ${item.sku} 的清仓不补标记`
                                  : `将 ${item.sku} 标记为清仓不补`
                              }
                              title={isCl ? "取消" : "标记清仓不补"}
                            >
                              {isCl ? "取消" : "标记"}
                            </button>
                          </td>
                        </tr>
                        {op && (
                          <tr className="row-detail">
                            <td colSpan={10}>
                              <div className="row-detail-inner">
                                <span className="text-xs text-base-content/60">
                                  周转: {item.周转天数 ?? "-"} · 占有: {item.订单占有 ?? "-"} · 月销量:{" "}
                                  {item.月销量 || 0} · 月退货: {item.月退货量 || 0}
                                </span>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  },
                )}
              </tbody>
            </table>
          </div>
          {stockWarn.length > 15 && (
            <p className="text-center mt-2">
              <button
                className="btn btn-ghost btn-xs text-base-content/55"
                onClick={() => toggleSec("sw")}
              >
                {secExp.has("sw") ? "收起" : `展开全部 ${stockWarn.length} 条`}
              </button>
            </p>
          )}
        </>
      )}

      <div className="warehouse-section-title mt-8">
        <ShoppingCart size={18} /> 滞销清单 — ≥180天零实发 ({stale180.length}SKU)
        {stale180.length > 0 && (
          <ExportButton
            filename={`滞销180天-${today}.csv`}
            headers={["SKU", "款式", "可用", "占有", "周转天数"]}
            rows={stale180.slice(0, 50).map((i) => [i.sku, i.product, i.可用数, i.订单占有, i.周转天数])}
          />
        )}
      </div>
      {stale180.length === 0 ? (
        <p className="text-success text-sm">无</p>
      ) : (
        <>
          <StaleTable rows={stale180} sec="s180" />
          {stale180.length > 15 && (
            <p className="text-center mt-2">
              <button className="btn btn-ghost btn-xs text-base-content/55" onClick={() => toggleSec("s180")}>
                {secExp.has("s180") ? "收起" : `展开全部 ${stale180.length} 条`}
              </button>
            </p>
          )}
        </>
      )}

      <div className="warehouse-section-title mt-6">
        <ShoppingCart size={18} /> 滞销 — ≥90天零实发 ({stale90.length}SKU)
        {stale90.length > 0 && (
          <ExportButton
            filename={`滞销90天-${today}.csv`}
            headers={["SKU", "款式", "可用", "占有", "周转天数"]}
            rows={stale90.slice(0, 30).map((i) => [i.sku, i.product, i.可用数, i.订单占有, i.周转天数])}
          />
        )}
      </div>
      {stale90.length === 0 ? (
        <p className="text-success text-sm">无</p>
      ) : (
        <>
          <StaleTable rows={stale90} sec="s90" />
          {stale90.length > 15 && (
            <p className="text-center mt-2">
              <button className="btn btn-ghost btn-xs text-base-content/55" onClick={() => toggleSec("s90")}>
                {secExp.has("s90") ? "收起" : `展开全部 ${stale90.length} 条`}
              </button>
            </p>
          )}
        </>
      )}

      <div className="warehouse-section-title mt-6">
        <ShoppingCart size={18} /> 滞销 — ≥60天零实发 ({stale60.length}SKU)
        {stale60.length > 0 && (
          <ExportButton
            filename={`滞销60天-${today}.csv`}
            headers={["SKU", "款式", "可用", "占有", "周转天数"]}
            rows={stale60.slice(0, 30).map((i) => [i.sku, i.product, i.可用数, i.订单占有, i.周转天数])}
          />
        )}
      </div>
      {stale60.length === 0 ? (
        <p className="text-success text-sm">无</p>
      ) : (
        <>
          <StaleTable rows={stale60} sec="s60" />
          {stale60.length > 15 && (
            <p className="text-center mt-2">
              <button className="btn btn-ghost btn-xs text-base-content/55" onClick={() => toggleSec("s60")}>
                {secExp.has("s60") ? "收起" : `展开全部 ${stale60.length} 条`}
              </button>
            </p>
          )}
        </>
      )}

      <div className="warehouse-section-title mt-6">
        <ShoppingCart size={18} /> 滞销 — 月零实发(&lt;60天) ({stale30.length}SKU)
        {stale30.length > 0 && (
          <ExportButton
            filename={`滞销30天-${today}.csv`}
            headers={["SKU", "款式", "可用", "占有", "周转天数"]}
            rows={stale30.slice(0, 30).map((i) => [i.sku, i.product, i.可用数, i.订单占有, i.周转天数])}
          />
        )}
      </div>
      {stale30.length === 0 ? (
        <p className="text-success text-sm">无</p>
      ) : (
        <>
          <StaleTable rows={stale30} sec="s30" />
          {stale30.length > 15 && (
            <p className="text-center mt-2">
              <button className="btn btn-ghost btn-xs text-base-content/55" onClick={() => toggleSec("s30")}>
                {secExp.has("s30") ? "收起" : `展开全部 ${stale30.length} 条`}
              </button>
            </p>
          )}
        </>
      )}
    </div>
  );
}

function Platforms({ d, regions }: { d: PM; regions: RM2 }): React.JSX.Element {
  const items = d.by_platform || [];
  const total = items.reduce((s, x) => s + x.订单数, 0);
  const provs = regions.by_province || [];
  const provTotal = provs.reduce((s, x) => s + x.订单数, 0);
  const [exProv, setExProv] = useState<Set<string>>(new Set());
  const toggleProv = (p: string) =>
    setExProv((prev) => {
      const n = new Set(prev);
      n.has(p) ? n.delete(p) : n.add(p);
      return n;
    });

  return (
    <div className="warehouse-panel">
      <div className="warehouse-section-block">
        <div className="warehouse-summary-grid warehouse-summary-grid--3">
          <div className="stat-card">
            <span className="stat-label">平台数</span>
            <strong className="stat-value">{items.length}</strong>
          </div>
          <div className="stat-card">
            <span className="stat-label">总订单</span>
            <strong className="stat-value">{total.toLocaleString()}</strong>
          </div>
          <div className="stat-card">
            <span className="stat-label">覆盖省份</span>
            <strong className="stat-value">{provs.length}</strong>
          </div>
        </div>
      </div>
      <div className="warehouse-section-scroll">
        <h3 className="warehouse-section-title">
          <Globe size={18} /> 各平台发货分布
        </h3>
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>平台</th>
                <th data-numeric="true">订单数</th>
                <th data-numeric="true">占比</th>
              </tr>
            </thead>
            <tbody>
              {items.map((x) => (
                <tr key={x.platform}>
                  <td className="font-medium">{x.platform}</td>
                  <td data-numeric="true">{x.订单数.toLocaleString()}</td>
                  <td data-numeric="true">
                    {((x.订单数 / (total || 1)) * 100).toFixed(1)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {provs.length > 0 && (
        <div className="warehouse-section-scroll" style={{ marginTop: "1.5rem" }}>
          <h3 className="warehouse-section-title">
            <TrendingUp size={18} /> 各省份发货分布
          </h3>
          <div className="data-table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th></th>
                  <th>省份</th>
                  <th data-numeric="true">订单数</th>
                  <th data-numeric="true">占比</th>
                </tr>
              </thead>
              <tbody>
                {provs.slice(0, 20).map((p) => {
                  const op = exProv.has(p.province);
                  return (
                    <Fragment key={p.province}>
                      <tr className={op ? "row-open" : ""}>
                        <td>
                          <button
                            type="button"
                            className="row-toggle"
                            onClick={() => toggleProv(p.province)}
                            aria-label={`${op ? "收起" : "展开"} ${p.province} 的城市明细`}
                            aria-expanded={op}
                            data-open={op ? "true" : "false"}
                          >
                            <ChevronRight size={14} aria-hidden="true" />
                          </button>
                        </td>
                        <td data-wrap="true" className="font-medium">{p.province}</td>
                        <td data-numeric="true">{p.订单数.toLocaleString()}</td>
                        <td data-numeric="true">
                          {((p.订单数 / (provTotal || 1)) * 100).toFixed(1)}%
                        </td>
                      </tr>
                      {op &&
                        p.top_cities &&
                        p.top_cities.length > 0 && (
                          <tr className="row-detail">
                            <td colSpan={4}>
                              <div className="row-detail-inner">
                                <strong className="text-xs text-base-content/60 mb-2 block">
                                  TOP5 城市
                                </strong>
                                <table className="data-table data-table-reason">
                                  <tbody>
                                    {p.top_cities.map((c) => (
                                      <tr key={c.city}>
                                        <td>{c.city}</td>
                                        <td className="text-right">
                                          {c.count}单
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </td>
                          </tr>
                        )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          {provs.length > 20 && (
            <p className="text-xs text-base-content/40 mt-2">
              仅显示 TOP20 省份，共 {provs.length} 个
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function BriefReport({ d }: { d: WD }): React.JSX.Element {
  const { shipment, inventory, returns, brief } = d.modules;
  const S = shipment!.summary as Record<string, number | string>;
  const I = inventory!.summary as Record<string, number | string>;
  const R = returns!.summary as Record<string, number | string>;
  const reportRef = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState(false);

  const attentionLines = brief!.attention || [];
  const hp = Number(String(I["健康SKU占比"] || "0").replace("%", ""));
  const rt = Number(R["总退货量"] || 0);
  const st = Number(S["总昨日实发"] || 1);
  const today = new Date().toISOString().slice(0, 10);

  const exportPng = async () => {
    if (!reportRef.current || exporting) return;
    setExporting(true);
    try {
      const url = await toPng(reportRef.current, {
        backgroundColor: "var(--color-bg)",
        pixelRatio: 2,
        cacheBust: true,
      });
      const a = document.createElement("a");
      a.href = url;
      a.download = `仓库日报-${today}.png`;
      a.click();
    } catch (err) {
      alert(`导出图片失败: ${err instanceof Error ? err.message : err}`);
    } finally {
      setExporting(false);
    }
  };

  const exportMd = () => {
    const L: string[] = [];
    L.push(`# 仓库日报 · ${d.data_date}`, "");
    L.push(`> ${brief!.headline} · 生成于 ${d.generated_at}`, "");
    L.push("## 核心指标", "", "| 指标 | 数值 |", "|---|---|");
    L.push(`| 昨日发货 | ${S["总昨日实发"] || 0}件 |`);
    L.push(`| 发货订单 | ${S["发货订单数"] || 0}单 |`);
    L.push(
      `| 库存预警 | ${Number(I["缺货SKU数"] || 0) + Number(I["低库存SKU数"] || 0)}SKU |`,
    );
    L.push(`| 滞销提醒 | ${I["滞销SKU数"] || 0}SKU |`);
    L.push("", "## 运营动态", "", "| 指标 | 数据 | 状态 |", "|---|---|---|");
    L.push(
      `| 库存健康度 | ${I["健康SKU占比"] || "0%"} | ${hp >= 80 ? "正常" : "偏低"} |`,
    );
    L.push(`| 退货量 | ${rt}件 | 关注 |`);
    L.push("", "## 需关注事项", "");
    attentionLines.forEach((x) => L.push(`- ${x}`));
    const blob = new Blob([L.join("\n")], {
      type: "text/markdown;charset=utf-8",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `仓库日报-${today}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="warehouse-panel brief-report">
      <div className="brief-toolbar">
        <h3 className="warehouse-section-title">
          <Calendar size={18} /> {brief!.headline}
        </h3>
        <div className="brief-actions">
          <button
            className="btn btn-outline btn-sm"
            onClick={() => void exportPng()}
            disabled={exporting}
          >
            <Download size={14} /> {exporting ? "导出中…" : "导出PNG"}
          </button>
          <button className="btn btn-outline btn-sm" onClick={exportMd}>
            <FileText size={14} /> 导出MD
          </button>
        </div>
      </div>

      <div ref={reportRef} className="brief-canvas">
        <div className="daily-metrics">
          {[
            { l: "昨日发货", v: Number(S["总昨日实发"] || 0), u: "件" },
            { l: "发货订单", v: Number(S["发货订单数"] || 0), u: "单" },
            { l: "昨日退货", v: Number(R["总退货量"] || 0), u: "件" },
            {
              l: "库存预警",
              v: Number(I["缺货SKU数"] || 0) + Number(I["低库存SKU数"] || 0),
              u: "SKU",
            },
            { l: "滞销提醒", v: Number(I["滞销SKU数"] || 0), u: "SKU" },
          ].map((m) => (
            <div key={m.l} className="daily-metric-card">
              <span className="daily-metric-label">{m.l}</span>
              <div className="daily-metric-value-row">
                <strong className="daily-metric-value">
                  <CountUp value={m.v} />
                </strong>
                <span className="daily-metric-unit">{m.u}</span>
              </div>
            </div>
          ))}
        </div>

        <div className="daily-section">
          <h4 className="daily-section-title">运营动态</h4>
          <div className="data-table-wrapper">
            <table className="data-table daily-dynamic-table">
              <thead>
                <tr>
                  <th>指标</th>
                  <th data-numeric="true">今日数据</th>
                  <th>状态</th>
                  <th>说明</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="font-medium">库存健康度</td>
                  <td
                    data-numeric="true"
                    className={
                      hp < 80
                        ? "text-error font-semibold"
                        : "text-success font-semibold"
                    }
                  >
                    {I["健康SKU占比"] || "0%"}
                  </td>
                  <td>
                    {hp >= 80 ? (
                      <span className="daily-status daily-status-ok">正常</span>
                    ) : (
                      <span className="daily-status daily-status-critical">
                        偏低
                      </span>
                    )}
                  </td>
                  <td className="text-sm text-base-content/60">
                    {hp >= 80 ? "—" : "低于80%阈值"}
                  </td>
                </tr>
                <tr>
                  <td className="font-medium">退货量</td>
                  <td data-numeric="true">{rt}件</td>
                  <td>
                    <span className="daily-status daily-status-warn">关注</span>
                  </td>
                  <td className="text-sm text-base-content/60">
                    占发货 {(rt / st * 100).toFixed(1)}%
                  </td>
                </tr>
                <tr>
                  <td className="font-medium">活跃款式</td>
                  <td data-numeric="true">{S["活跃款式数"] || 0}款</td>
                  <td>
                    <span className="daily-status daily-status-ok">正常</span>
                  </td>
                  <td className="text-sm text-base-content/60">—</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="daily-section">
          <h4 className="daily-section-title">需关注事项</h4>
          {attentionLines.length === 0 ? (
            <p className="text-sm text-base-content/50">今日无特别需关注事项</p>
          ) : (
            <ul className="daily-attention-list">
              {attentionLines.map((item, i) => (
                <li key={i} className="daily-attention-item">
                  <span className="daily-attention-bullet">•</span>
                  <span className="text-sm leading-relaxed">{item}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <details className="daily-section daily-methodology">
          <summary
            className="daily-section-title"
            style={{ fontSize: "0.85rem", marginBottom: "0.5rem", color: "var(--color-text-secondary)" }}
          >
            数据口径说明
          </summary>
          <div
            className="text-xs text-base-content/50 space-y-1"
            style={{ lineHeight: "1.7" }}
          >
            <p>
              <strong>昨日发货</strong>：昨日实际发出的包裹数（非销量）
            </p>
            <p>
              <strong>退货率</strong> = 月退货量 ÷ 月实发。如月退货433件、月实发31,100件
              → 退货率 1.4%。分子分母均为月度口径
            </p>
            <p>
              <strong>库存预警</strong>：可售天数 &lt; 7 天的
              SKU（快缺货 &lt;3天 / 低库存 3~7天），合并一张表按紧急度排列
            </p>
            <p>
              <strong>快需补货</strong>：(可用+在途) ÷ 月日均净消耗 &lt; 3 天。净消耗 =
              月销量 − 月退货×70%（退货回仓损耗30%）
            </p>
            <p>
              <strong>超卖未下单</strong>：实际可用数 &lt; 0 且 可用+采购在途 &lt; 0（在途无法覆盖）
            </p>
            <p>
              <strong>滞销</strong>：实际可用数 &gt; 0 且当月零实发的
              SKU。按零实发天数分四级：≥180天 / ≥90天 / ≥60天 / 月零
            </p>
            <p>
              <strong>库存总量</strong>：实际可用数 &gt; 0 的全部 SKU 可用数求和，超卖负数不计入
            </p>
            <p>
              <strong>库存健康度</strong> = (总启用SKU − 缺货 − 快需补货 − 低库存 − 滞销 −
              超卖) ÷ 总启用SKU × 100%
            </p>
            <p>
              <strong>活跃款式</strong>：昨日实发 &gt; 0 的款式数量
            </p>
            <p>
              <strong>退货原因</strong>：优先取售后单「退款原因」，空则取「备注」前30字，均空记「未填写」
            </p>
            <p>
              <strong>订单数</strong>：按内部订单号去重（单数）；件数 = 一单多件累计（如付款1006单1102件）
            </p>
          </div>
        </details>
      </div>
    </div>
  );
}

export { Shipment, Returns, Inventory, Platforms, BriefReport };
