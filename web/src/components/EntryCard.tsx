import { ArrowUpRight, FolderOpen, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { NavigationItem } from "../../shared/contracts/navigation";
import { isFileTarget, targetLabel } from "../url-normalize";

interface EntryCardProps {
  item: NavigationItem;
  index?: number;
  onDelete: (item: NavigationItem) => void;
  onOpenLocal: (item: NavigationItem) => void;
}

export function EntryCard({
  item,
  index = 0,
  onDelete,
  onOpenLocal,
}: EntryCardProps): React.JSX.Element {
  const [confirming, setConfirming] = useState(false);
  const isLocalFile = isFileTarget(item.url);

  useEffect(() => {
    if (!confirming) {
      return;
    }
    const timer = window.setTimeout(() => setConfirming(false), 2_800);
    return () => window.clearTimeout(timer);
  }, [confirming]);

  return (
    <article
      className="entry-card"
      data-accent={item.accent}
      style={{ "--i": Math.min(index, 8) } as React.CSSProperties}
    >
      <div className="entry-card-inner">
        <div className="entry-identity">
          <div className="entry-monogram" aria-hidden="true">
            {isLocalFile ? <FolderOpen size={16} /> : item.name.slice(0, 1)}
          </div>
          <div className="entry-heading">
            <span className="entry-category">{item.category}</span>
            <h3>{item.name}</h3>
          </div>
        </div>

        <div className="entry-copy">
          <p>{item.description}</p>
          <span className="entry-domain" title={targetLabel(item.url)}>
            {isLocalFile ? <FolderOpen size={15} /> : <ArrowUpRight size={15} />}
            <span>{targetLabel(item.url)}</span>
          </span>
        </div>

        <div className="entry-foot">
          <button
            className="entry-delete"
            data-confirm={confirming ? "true" : "false"}
            type="button"
            aria-label={confirming ? `确认删除 ${item.name}` : `删除 ${item.name}`}
            aria-pressed={confirming}
            aria-live="polite"
            onClick={() => {
              if (confirming) {
                onDelete(item);
              } else {
                setConfirming(true);
              }
            }}
          >
            {confirming ? (
              "确认删除"
            ) : (
              <>
                <Trash2 size={14} />
                <span>删除</span>
              </>
            )}
          </button>
          {isLocalFile ? (
            <button
              className="entry-open btn btn-primary btn-sm"
              type="button"
              aria-label={`打开 ${item.name}`}
              onClick={() => onOpenLocal(item)}
            >
              打开
              <FolderOpen size={15} />
            </button>
          ) : (
            <a
              className="entry-open btn btn-primary btn-sm"
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`打开 ${item.name}`}
            >
              打开
              <ArrowUpRight size={15} />
            </a>
          )}
        </div>
      </div>
    </article>
  );
}