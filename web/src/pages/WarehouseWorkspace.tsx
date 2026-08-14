import { useEffect, useRef, useState } from "react";
import { AlertTriangle, BarChart3, Boxes, Globe, PackageOpen, RefreshCw, Truck } from "lucide-react";
import { fetchWarehouseData, fetchErpExceptions } from "../api";
import type { TabKey, WD } from "./warehouse-types";
import { TABS } from "./warehouse-types";
import { Shipment, Returns, Inventory, Platforms, BriefReport } from "./WarehouseViews";

interface ErpExceptionsData {
  发货上传失败?: number;
  打单超2次?: number;
  generated_at?: string;
}

export function WarehouseWorkspace(): React.JSX.Element {
  const [d, setD] = useState<WD | null>(null);
  const [l, setL] = useState(true);
  const [e, setE] = useState("");
  const [t, setT] = useState<TabKey>("brief");
  const [ex, setEx] = useState<ErpExceptionsData | null>(null);
  const f = async () => {
    setL(true);
    setE("");
    try {
      const r = await fetchWarehouseData();
      setD(r as WD);
      try {
        const exRaw = await fetchErpExceptions();
        setEx(exRaw as ErpExceptionsData);
      } catch {
        setEx(null);
      }
    } catch (x) {
      setE(x instanceof Error ? x.message : "加载失败");
    } finally {
      setL(false);
    }
  };
  useEffect(() => {
    void f();
  }, []);

  // 滑动指示器：测量当前激活 tab 的位置与宽度（桌面端胶囊滑动手势）
  const tabsRef = useRef<HTMLDivElement>(null);
  const [ind, setInd] = useState<{ x: number; w: number } | null>(null);
  useEffect(() => {
    const measure = () => {
      const el = tabsRef.current?.querySelector<HTMLElement>(".warehouse-tab-active");
      if (!el || !tabsRef.current) return;
      setInd((p) =>
        p && Math.abs(p.x - el.offsetLeft) < 1 && Math.abs(p.w - el.offsetWidth) < 1
          ? p
          : { x: el.offsetLeft, w: el.offsetWidth },
      );
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [t]);

  if (l)
    return (
      <section
        className="workspace-page warehouse-workspace"
        aria-labelledby="warehouse-page-title"
        aria-busy="true"
      >
        <header className="warehouse-page-head warehouse-page-head--state">
          <div className="warehouse-page-heading">
            <p className="section-kicker">WAREHOUSE</p>
            <h1 id="warehouse-page-title">仓库数据</h1>
            <p className="warehouse-page-description">
              正在读取每日流转、库存风险与渠道数据。
            </p>
          </div>
        </header>
        <div className="warehouse-loading-grid" role="status" aria-live="polite">
          <span className="sr-only">仓库数据加载中</span>
          {[0, 1, 2, 3, 4].map((i) => (
            <div className="skeleton warehouse-loading-card" key={i} aria-hidden="true" />
          ))}
        </div>
      </section>
    );

  if (e || !d)
    return (
      <section className="workspace-page warehouse-workspace" aria-labelledby="warehouse-page-title">
        <header className="warehouse-page-head warehouse-page-head--state">
          <div className="warehouse-page-heading">
            <p className="section-kicker">WAREHOUSE</p>
            <h1 id="warehouse-page-title">仓库数据</h1>
            <p className="warehouse-page-description">
              数据暂时无法读取，可重试恢复当前仓库视图。
            </p>
          </div>
        </header>
        <div className="warehouse-error-state">
          <div className="alert alert-error" role="alert">
            <AlertTriangle size={18} />
            <span>加载失败: {e || "未知"}</span>
          </div>
          <button type="button" className="btn btn-outline btn-sm" onClick={() => void f()}>
            <RefreshCw size={14} /> 重试
          </button>
        </div>
      </section>
    );

  const { shipment, returns, inventory } = d.modules;
  return (
    <section className="workspace-page warehouse-workspace" aria-labelledby="warehouse-page-title">
      <header className="warehouse-page-head">
        <div className="warehouse-page-heading">
          <p className="section-kicker">WAREHOUSE</p>
          <h1 id="warehouse-page-title">仓库数据</h1>
          <p className="warehouse-page-description">
            从经营简报进入，再按发货、退货与库存信号逐层定位明细。
          </p>
        </div>
        <div className="warehouse-page-meta">
          <div
            className="warehouse-freshness"
            aria-label={`数据日期 ${d.data_date}，生成时间 ${d.generated_at}`}
          >
            <span>
              数据日期 <strong>{d.data_date}</strong>
            </span>
            <span>
              生成时间 <strong>{d.generated_at}</strong>
            </span>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-sm warehouse-refresh"
            onClick={() => void f()}
          >
            <RefreshCw size={14} /> 刷新
          </button>
        </div>
      </header>
      <nav className="warehouse-view-nav" aria-label="仓库数据视图">
        <div
          className="warehouse-tabs"
          role="tablist"
          aria-orientation="horizontal"
          ref={tabsRef}
        >
          {ind ? (
            <div
              className="warehouse-tab-indicator"
              aria-hidden="true"
              style={{
                transform: `translateX(${ind.x}px)`,
                width: `${ind.w}px`,
              }}
            />
          ) : null}
          {TABS.map(({ key, label, hint, icon: Icon }, index) => (
            <button
              type="button"
              key={key}
              id={`warehouse-tab-${key}`}
              role="tab"
              aria-selected={t === key}
              aria-controls="warehouse-panel"
              tabIndex={t === key ? 0 : -1}
              className={`warehouse-tab ${key === "platforms" ? "warehouse-tab--secondary " : ""}${t === key ? "warehouse-tab-active" : ""}`}
              onClick={() => setT(key)}
              onKeyDown={(event) => {
                let nextIndex = index;
                if (event.key === "ArrowRight") nextIndex = (index + 1) % TABS.length;
                else if (event.key === "ArrowLeft") nextIndex = (index - 1 + TABS.length) % TABS.length;
                else if (event.key === "Home") nextIndex = 0;
                else if (event.key === "End") nextIndex = TABS.length - 1;
                else return;
                event.preventDefault();
                const nextTab = TABS[nextIndex];
                if (!nextTab) return;
                const nextKey = nextTab.key;
                setT(nextKey);
                requestAnimationFrame(() =>
                  document.getElementById(`warehouse-tab-${nextKey}`)?.focus(),
                );
              }}
            >
              <Icon size={16} aria-hidden="true" />
              <span className="warehouse-tab-copy">
                <span className="warehouse-tab-label">{label}</span>
                <span className="warehouse-tab-hint">{hint}</span>
              </span>
            </button>
          ))}
        </div>
      </nav>
      <div
        className="warehouse-content"
        role="tabpanel"
        id="warehouse-panel"
        aria-labelledby={`warehouse-tab-${t}`}
      >
        {t === "shipment" && shipment && <Shipment d={shipment} repeatPrint={ex?.["打单超2次"] ?? 0} />}
        {t === "returns" && returns && <Returns d={returns} />}
        {t === "inventory" && inventory && <Inventory d={inventory} />}
        {t === "brief" && <BriefReport d={d} />}
        {t === "platforms" && d.modules.platforms && (
          <Platforms d={d.modules.platforms} regions={d.modules.regions!} />
        )}
      </div>
    </section>
  );
}
