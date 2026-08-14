import {
  FileText,
  Plus,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  type KeyboardEvent,
  useEffect,
  useRef,
  useState,
} from "react";

import type {
  ResourceItem,
  ResourceKind,
} from "../../shared/contracts/resources";
import {
  listResources,
  uploadResource,
} from "../api";
import { ResourceCard } from "./ResourceCard";
import { AddResourceDialog } from "./ResourceAddDialog";

export function ResourcesWorkspace(): React.JSX.Element {
  const [items, setItems] = useState<ResourceItem[]>([]);
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [kind, setKind] = useState<ResourceKind | "all">("all");
  const [trash, setTrash] = useState(false);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const addDialogRef = useRef<HTMLDialogElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const hasActiveFilters = appliedQuery !== "" || kind !== "all";

  useEffect(() => {
    let active = true;
    setLoading(true);
    listResources({
      query: appliedQuery,
      ...(kind === "all" ? {} : { kind }),
      trash,
    })
      .then((resources) => {
        if (active) {
          setItems(resources);
          setError("");
        }
      })
      .catch((caughtError: unknown) => {
        if (active) {
          setError(
            caughtError instanceof Error
              ? caughtError.message
              : "资料加载失败。",
          );
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [appliedQuery, kind, trash, revision]);

  async function handleFile(file: File): Promise<void> {
    setError("");
    setUploading(true);
    try {
      await uploadResource(file);
      setRevision((current) => current + 1);
    } catch (caughtError) {
      setError(
        caughtError instanceof Error ? caughtError.message : "文件导入失败。",
      );
    } finally {
      setUploading(false);
      if (fileInputRef.current !== null) {
        fileInputRef.current.value = "";
      }
    }
  }

  return (
    <section
      className="workspace-page resources-workspace"
      aria-labelledby="resources-page-heading"
    >
      <header className="resource-page-header">
        <div className="workspace-page-heading">
          <p className="section-kicker">RESOURCE CENTER</p>
          <h1 id="resources-page-heading">资料中心</h1>
          <p>文件、网页和工作笔记都保存在本机。</p>
        </div>
        <div className="workspace-actions resource-create-actions">
          <input
            hidden
            ref={fileInputRef}
            type="file"
            tabIndex={-1}
            aria-hidden="true"
            accept=".pdf,.png,.jpg,.jpeg,.webp,.gif,.doc,.docx,.xls,.xlsx"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file !== undefined) {
                void handleFile(file);
              }
            }}
          />
          <button
            className="btn btn-outline btn-sm"
            type="button"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
          >
            {uploading ? (
              <span className="loading loading-spinner loading-xs" />
            ) : (
              <Upload size={15} />
            )}
            {uploading ? "正在导入" : "导入文件"}
          </button>
          <button
            className="btn btn-primary btn-sm"
            type="button"
            aria-haspopup="dialog"
            onClick={() => addDialogRef.current?.showModal()}
          >
            <Plus size={15} />
            添加资料
          </button>
        </div>
      </header>

      <section
        className="resource-command-band"
        aria-label="资料检索与筛选"
      >
        <form
          className="resource-search"
          onSubmit={(event) => {
            event.preventDefault();
            setAppliedQuery(query.trim());
          }}
        >
          <Search size={16} />
          <input
            aria-label="搜索资料"
            placeholder="搜索标题或标签"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {(query !== "" || appliedQuery !== "") && (
            <button
              className="btn btn-ghost btn-sm resource-search-clear"
              type="button"
              aria-label="清除搜索"
              title="清除搜索"
              onClick={() => {
                setQuery("");
                setAppliedQuery("");
              }}
            >
              <X size={14} />
            </button>
          )}
          <button className="btn btn-ghost btn-sm" type="submit">
            搜索
          </button>
        </form>

        <div className="resource-filter-row">
          <div
            className="resource-kind-filter"
            role="group"
            aria-label="资料类型筛选"
          >
            {(
              [
                ["all", "全部"],
                ["file", "文件"],
                ["link", "网址"],
                ["note", "笔记"],
              ] as const
            ).map(([value, label]) => (
              <button
                className={`btn btn-sm resource-kind-filter-button ${kind === value ? "btn-primary is-active" : "btn-ghost"}`}
                type="button"
                aria-pressed={kind === value}
                key={value}
                onClick={() => setKind(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <span className="resource-filter-divider" aria-hidden="true" />
          <button
            className={`btn btn-sm resource-trash-toggle ${trash ? "btn-primary is-active" : "btn-ghost"}`}
            type="button"
            aria-pressed={trash}
            onClick={() => setTrash((current) => !current)}
          >
            <Trash2 size={15} />
            {trash ? "返回资料库" : "回收站"}
          </button>
        </div>
      </section>

      <div className="resource-result-bar" aria-live="polite">
        <span>{trash ? "回收站" : "资料库"}</span>
        <span className="resource-result-rule" aria-hidden="true" />
        <span className="resource-result-count">
          {loading ? "—" : `${items.length} 项`}
        </span>
      </div>

      {error !== "" && (
        <div className="alert alert-error mt-5 text-sm" role="alert">
          {error}
        </div>
      )}

      {loading ? (
        <div
          className="resource-grid"
          role="status"
          aria-label="正在加载资料"
        >
          {[0, 1, 2].map((value) => (
            <div
              className="skeleton h-64 rounded-2xl resource-card-skeleton"
              aria-hidden="true"
              key={value}
            />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="workspace-empty resource-empty-state">
          <FileText size={22} />
          <strong>
            {hasActiveFilters
              ? "未找到匹配资料"
              : trash
                ? "回收站是空的"
                : "还没有资料"}
          </strong>
          <span>
            {hasActiveFilters
              ? "调整关键词或资料类型后再试"
              : trash
                ? "移除的资料会暂存在这里"
                : "导入文件，或添加网址和笔记"}
          </span>
          {hasActiveFilters && (
            <button
              className="btn btn-outline btn-sm"
              type="button"
              onClick={() => {
                setQuery("");
                setAppliedQuery("");
                setKind("all");
              }}
            >
              清除筛选
            </button>
          )}
        </div>
      ) : (
        <div
          className="resource-grid"
          role="list"
          aria-label={trash ? "回收站资料" : "资料库资料"}
        >
          {items.map((item, index) => (
            <ResourceCard
              item={item}
              key={item.id}
              index={index}
              trash={trash}
              onChanged={() => setRevision((current) => current + 1)}
              onError={setError}
            />
          ))}
        </div>
      )}

      <AddResourceDialog
        dialogRef={addDialogRef}
        onCreated={() => setRevision((current) => current + 1)}
      />
    </section>
  );
}
