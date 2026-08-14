import { Download, ExternalLink, RotateCcw, Trash2 } from "lucide-react";

import type { ResourceItem } from "../../shared/contracts/resources";
import {
  deleteResource,
  restoreResource,
} from "../api";
import {
  formatResourceDate,
  formatSize,
  resourceIcon,
  resourceKindLabel,
} from "./resources-utils";

export function ResourceCard({
  item,
  trash,
  index = 0,
  onChanged,
  onError,
}: {
  item: ResourceItem;
  trash: boolean;
  index?: number;
  onChanged: () => void;
  onError: (message: string) => void;
}): React.JSX.Element {
  const Icon = resourceIcon(item);
  const summary =
    item.kind === "file"
      ? [item.originalFilename, formatSize(item.sizeBytes)]
          .filter(Boolean)
          .join(" · ")
      : item.kind === "link"
        ? (item.url ?? "")
        : (item.content ?? "");

  async function handleDelete(): Promise<void> {
    try {
      await deleteResource(item.id);
      onChanged();
    } catch (caughtError) {
      onError(
        caughtError instanceof Error ? caughtError.message : "移入回收站失败。",
      );
    }
  }

  async function handleRestore(): Promise<void> {
    try {
      await restoreResource(item.id);
      onChanged();
    } catch (caughtError) {
      onError(
        caughtError instanceof Error ? caughtError.message : "恢复资料失败。",
      );
    }
  }

  return (
    <article
      className={`resource-card resource-card--${item.kind}`}
      role="listitem"
      style={{ "--i": Math.min(index, 8) } as React.CSSProperties}
    >
      <div className="resource-card-inner">
        <header className="resource-card-identity">
          <div className="resource-kind-icon" aria-hidden="true">
            <Icon size={18} />
          </div>
          <div className="resource-card-heading">
            <span className="resource-kind-label">
              {resourceKindLabel(item.kind)}
            </span>
            <h3 title={item.title}>{item.title}</h3>
          </div>
        </header>

        <div className="resource-card-content">
          <p className="resource-card-summary" title={summary}>
            {summary}
          </p>
          <div className="resource-card-dates">
            <time dateTime={item.createdAt}>
              创建于 {formatResourceDate(item.createdAt)}
            </time>
            {item.updatedAt !== item.createdAt && (
              <time dateTime={item.updatedAt}>
                更新于 {formatResourceDate(item.updatedAt)}
              </time>
            )}
          </div>
          {item.tags.length > 0 && (
            <div
              className="resource-tags"
              role="list"
              aria-label="资料标签"
            >
              {item.tags.map((tag) => (
                <span key={tag} role="listitem">#{tag}</span>
              ))}
            </div>
          )}
        </div>

        <footer className="resource-card-actions">
          {trash ? (
            <button
              className="btn btn-outline btn-sm resource-primary-action resource-restore-action"
              type="button"
              aria-label={`恢复资料：${item.title}`}
              onClick={() => void handleRestore()}
            >
              <RotateCcw size={14} />
              恢复
            </button>
          ) : (
            <button
              className="btn btn-ghost btn-sm resource-delete-action"
              type="button"
              aria-label={`移入回收站：${item.title}`}
              onClick={() => void handleDelete()}
            >
              <Trash2 size={14} />
              移入回收站
            </button>
          )}
          {!trash && item.kind === "file" && (
            <a
              className="btn btn-primary btn-sm resource-primary-action"
              href={`/api/resources/${encodeURIComponent(item.id)}/file`}
              aria-label={`下载文件：${item.title}`}
            >
              <Download size={14} />
              下载
            </a>
          )}
          {!trash && item.kind === "link" && item.url !== null && (
            <a
              className="btn btn-primary btn-sm resource-primary-action"
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`打开网址：${item.title}`}
            >
              <ExternalLink size={14} />
              打开
            </a>
          )}
        </footer>
      </div>
    </article>
  );
}
