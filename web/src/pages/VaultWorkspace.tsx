import {
  ArrowRight,
  BookOpen,
  Clock3,
  Code2,
  ExternalLink,
  FileText,
  FolderOpen,
  Link2,
  Network,
  PencilLine,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import type {
  VaultGraph,
  VaultNoteDetail,
  VaultNoteSummary,
  VaultStats,
} from "../../shared/contracts/vault";
import {
  fetchVaultGraph,
  fetchVaultNote,
  fetchVaultNotes,
  fetchVaultStats,
  refreshVault,
  saveVaultNote,
} from "../api";
import { GraphView } from "../components/GraphView";

type VaultView = "list" | "graph";
type EditorTab = "write" | "preview";

const PAGE_SIZE = 80;
const VAULT_LINK_PREFIX = "#vault-note=";
const VAULT_MISSING_PREFIX = "#vault-missing=";

function formatRelativeTime(timestamp: number): string {
  const delta = Math.max(0, Date.now() - timestamp);
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  return new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric" }).format(timestamp);
}

function folderLabel(notePath: string): string {
  const parts = notePath.split("/");
  return parts.length > 1 ? parts.slice(0, -1).join(" / ") : "根目录";
}

function noteRaw(frontmatter: string, content: string): string {
  const body = content.replace(/^\s*\n/, "");
  const meta = frontmatter.trim();
  return meta === "" ? body : `---\n${meta}\n---\n${body}`;
}

function parseTags(frontmatter: string | null): string[] {
  if (frontmatter === null) return [];
  const inline = frontmatter.match(/^tags:\s*\[(.*)\]\s*$/m);
  if (inline !== null) {
    return inline[1]!
      .split(",")
      .map((tag) => tag.trim().replace(/^['"]|['"]$/g, ""))
      .filter(Boolean);
  }
  const block = frontmatter.match(/^tags:\s*\n((?:\s*-\s*.+\n?)*)/m)?.[1];
  if (block === undefined) return [];
  return block
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*-\s*/, "").trim())
    .filter(Boolean);
}

function markdownWithVaultLinks(
  content: string,
  links: VaultNoteDetail["wikilinks"],
): string {
  const resolvedByTarget = new Map(
    links.map((link) => [link.target.toLocaleLowerCase("zh-CN"), link.resolvedPath]),
  );
  return content.replace(
    /!?\[\[([^\]|#]+?)(?:#[^\]|]*)?(?:\|([^\]]*?))?\]\]/g,
    (_raw, targetRaw: string, labelRaw?: string) => {
      const target = targetRaw.trim();
      const label = labelRaw?.trim() || target;
      const resolved = resolvedByTarget.get(target.toLocaleLowerCase("zh-CN"));
      return resolved
        ? `[${label}](${VAULT_LINK_PREFIX}${encodeURIComponent(resolved)})`
        : `[${label}](${VAULT_MISSING_PREFIX}${encodeURIComponent(target)})`;
    },
  );
}

function VaultMarkdown({
  content,
  links,
  onOpen,
}: {
  content: string;
  links: VaultNoteDetail["wikilinks"];
  onOpen: (path: string) => void;
}): React.JSX.Element {
  const markdown = useMemo(() => markdownWithVaultLinks(content, links), [content, links]);
  return (
    <div className="vault-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children, ...props }) => {
            if (href?.startsWith(VAULT_LINK_PREFIX)) {
              const path = decodeURIComponent(href.slice(VAULT_LINK_PREFIX.length));
              return (
                <button type="button" className="vault-md-wikilink" onClick={() => onOpen(path)}>
                  <Link2 size={12} />
                  {children}
                </button>
              );
            }
            if (href?.startsWith(VAULT_MISSING_PREFIX)) {
              const target = decodeURIComponent(href.slice(VAULT_MISSING_PREFIX.length));
              return (
                <span className="vault-md-wikilink vault-md-wikilink-missing" title={`未找到笔记：${target}`}>
                  {children}
                </span>
              );
            }
            return (
              <a {...props} href={href} target="_blank" rel="noopener noreferrer">
                {children}
                <ExternalLink size={11} aria-hidden="true" />
              </a>
            );
          },
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}

function summaryFromDetail(detail: VaultNoteDetail): VaultNoteSummary {
  return {
    path: detail.path,
    title: detail.title,
    kind: detail.kind,
    excerpt: detail.excerpt,
    outLinkCount: detail.outLinkCount,
    inLinkCount: detail.inLinkCount,
    mtime: detail.mtime,
    indexedAt: detail.indexedAt,
  };
}

export function VaultWorkspace(): React.JSX.Element {
  const [view, setView] = useState<VaultView>("list");
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [items, setItems] = useState<VaultNoteSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [serverLoadedCount, setServerLoadedCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [detail, setDetail] = useState<(VaultNoteDetail & { raw: string }) | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [graph, setGraph] = useState<VaultGraph | null>(null);
  const [graphLoading, setGraphLoading] = useState(false);
  const [stats, setStats] = useState<VaultStats | null>(null);
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [editFrontmatter, setEditFrontmatter] = useState("");
  const [editorTab, setEditorTab] = useState<EditorTab>("write");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [linkSuggestions, setLinkSuggestions] = useState<string[]>([]);
  const [suggestionIndex, setSuggestionIndex] = useState(-1);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLElement>(null);
  const itemRefs = useRef(new Map<string, HTMLButtonElement>());

  useEffect(() => {
    const timer = window.setTimeout(() => setAppliedQuery(query.trim()), 260);
    return () => window.clearTimeout(timer);
  }, [query]);

  const loadFirstPage = useCallback(() => {
    let active = true;
    setLoading(true);
    fetchVaultNotes({ query: appliedQuery, limit: PAGE_SIZE, offset: 0 })
      .then((result) => {
        if (!active) return;
        setItems(result.items);
        setTotal(result.total);
        setServerLoadedCount(result.items.length);
        setError("");
        setSelectedPath((current) => current ?? result.items[0]?.path ?? null);
      })
      .catch((caughtError: unknown) => {
        if (active) setError(caughtError instanceof Error ? caughtError.message : "知识库加载失败。");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [appliedQuery]);

  useEffect(() => loadFirstPage(), [loadFirstPage, revision]);

  useEffect(() => {
    let active = true;
    fetchVaultStats()
      .then((result) => {
        if (active) setStats(result);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [revision]);

  useEffect(() => {
    if (view !== "graph" || graph !== null) return;
    let active = true;
    setGraphLoading(true);
    fetchVaultGraph()
      .then((result) => {
        if (active) {
          setGraph(result);
          setError("");
        }
      })
      .catch((caughtError: unknown) => {
        if (active) setError(caughtError instanceof Error ? caughtError.message : "图谱加载失败。");
      })
      .finally(() => {
        if (active) setGraphLoading(false);
      });
    return () => {
      active = false;
    };
  }, [graph, revision, view]);

  useEffect(() => {
    if (selectedPath === null) {
      setDetail(null);
      setEditing(false);
      return;
    }
    let active = true;
    setDetailLoading(true);
    fetchVaultNote(selectedPath)
      .then((note) => {
        if (!active) return;
        setDetail(note);
        setEditContent(note.content);
        setEditFrontmatter(note.frontmatter ?? "");
        setEditing(false);
        setSaveError("");
        setItems((current) => current.some((item) => item.path === note.path)
          ? current
          : [summaryFromDetail(note), ...current]);
      })
      .catch((caughtError: unknown) => {
        if (active) setSaveError(caughtError instanceof Error ? caughtError.message : "笔记加载失败。");
      })
      .finally(() => {
        if (active) setDetailLoading(false);
      });
    return () => {
      active = false;
    };
  }, [selectedPath, revision]);

  useEffect(() => {
    if (selectedPath === null) return;
    const list = listRef.current;
    const item = itemRefs.current.get(selectedPath);
    if (list === null || item === undefined) return;
    const itemTop = item.offsetTop;
    const itemBottom = itemTop + item.offsetHeight;
    if (itemTop < list.scrollTop || itemBottom > list.scrollTop + list.clientHeight) {
      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      list.scrollTo({
        top: Math.max(0, itemTop - list.clientHeight / 2 + item.offsetHeight / 2),
        behavior: reducedMotion ? "auto" : "smooth",
      });
    }
  }, [items, selectedPath]);

  const suggestionTitles = useMemo(() => {
    const titles = new Set(items.map((item) => item.title));
    for (const node of graph?.nodes ?? []) titles.add(node.title);
    return [...titles];
  }, [graph, items]);

  const tags = useMemo(() => parseTags(detail?.frontmatter ?? null), [detail]);
  const readOnly = stats?.readOnly === true;
  const graphFilterPaths = useMemo(
    () => appliedQuery === "" ? [] : items.map((item) => item.path),
    [appliedQuery, items],
  );

  function openNote(path: string, switchToReader = false): void {
    setSelectedPath(path);
    if (switchToReader) setView("list");
  }

  async function loadMore(): Promise<void> {
    if (loadingMore || serverLoadedCount >= total) return;
    setLoadingMore(true);
    try {
      const result = await fetchVaultNotes({ query: appliedQuery, limit: PAGE_SIZE, offset: serverLoadedCount });
      setItems((current) => {
        const paths = new Set(current.map((item) => item.path));
        return [...current, ...result.items.filter((item) => !paths.has(item.path))];
      });
      setTotal(result.total);
      setServerLoadedCount((current) => current + result.items.length);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "加载更多失败。");
    } finally {
      setLoadingMore(false);
    }
  }

  function updateSuggestions(value: string, caret: number): void {
    const before = value.slice(0, caret);
    const lastOpen = before.lastIndexOf("[[");
    if (lastOpen < 0) {
      setLinkSuggestions([]);
      return;
    }
    const tail = before.slice(lastOpen + 2);
    if (tail.includes("]]")) {
      setLinkSuggestions([]);
      return;
    }
    const normalized = tail.toLocaleLowerCase("zh-CN");
    setLinkSuggestions(
      suggestionTitles
        .filter((title) => title.toLocaleLowerCase("zh-CN").includes(normalized))
        .slice(0, 8),
    );
    setSuggestionIndex(-1);
  }

  function applySuggestion(title: string): void {
    const editor = editorRef.current;
    if (editor === null) return;
    const caret = editor.selectionStart ?? 0;
    const before = editor.value.slice(0, caret);
    const lastOpen = before.lastIndexOf("[[");
    if (lastOpen < 0) return;
    const next = `${before.slice(0, lastOpen + 2)}${title}]]${editor.value.slice(caret)}`;
    setEditContent(next);
    setLinkSuggestions([]);
    requestAnimationFrame(() => {
      editor.focus();
      editor.selectionStart = editor.selectionEnd = lastOpen + title.length + 4;
    });
  }

  function handleEditorKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (linkSuggestions.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSuggestionIndex((current) => (current + 1) % linkSuggestions.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setSuggestionIndex((current) => (current - 1 + linkSuggestions.length) % linkSuggestions.length);
    } else if ((event.key === "Enter" || event.key === "Tab") && suggestionIndex >= 0) {
      event.preventDefault();
      applySuggestion(linkSuggestions[suggestionIndex]!);
    } else if (event.key === "Escape") {
      setLinkSuggestions([]);
    }
  }

  async function handleSave(): Promise<void> {
    if (detail === null || readOnly) return;
    setSaving(true);
    setSaveError("");
    try {
      await saveVaultNote(detail.path, noteRaw(editFrontmatter, editContent));
      setEditing(false);
      setGraph(null);
      setRevision((current) => current + 1);
    } catch (caughtError) {
      setSaveError(caughtError instanceof Error ? caughtError.message : "保存失败。");
    } finally {
      setSaving(false);
    }
  }

  const listPanel = (
    <aside className="vault-list" ref={listRef} aria-label="知识库笔记列表">
      <div className="vault-list-heading">
        <div>
          <span>笔记</span>
          <strong>{total}</strong>
        </div>
        {appliedQuery !== "" && <small>搜索结果</small>}
      </div>
      {loading ? (
        <div className="vault-list-skeleton">
          {[0, 1, 2, 3].map((value) => <div className="skeleton h-24 rounded-xl" key={value} />)}
        </div>
      ) : items.length === 0 ? (
        <div className="vault-empty">
          <FileText size={22} />
          <span>{appliedQuery !== "" ? "没有匹配的笔记" : "知识库为空"}</span>
          {appliedQuery !== "" && (
            <button type="button" className="btn btn-outline btn-sm" onClick={() => setQuery("")}>清除搜索</button>
          )}
        </div>
      ) : (
        <ul className="vault-list-items">
          {items.map((item) => (
            <li key={item.path}>
              <button
                ref={(node) => {
                  if (node === null) itemRefs.current.delete(item.path);
                  else itemRefs.current.set(item.path, node);
                }}
                type="button"
                aria-current={selectedPath === item.path ? "true" : undefined}
                className={`vault-list-item ${selectedPath === item.path ? "vault-list-item-active" : ""}`}
                onClick={() => openNote(item.path)}
              >
                <span className="vault-list-item-icon"><FileText size={15} /></span>
                <span className="vault-list-item-copy">
                  <span className="vault-list-title-row">
                    <strong className="vault-list-title">{item.title}</strong>
                    <ArrowRight size={13} aria-hidden="true" />
                  </span>
                  {item.excerpt !== null && <span className="vault-list-excerpt">{item.excerpt}</span>}
                  <span className="vault-list-meta">
                    <span className="vault-list-folder" title={item.path}><FolderOpen size={11} />{folderLabel(item.path)}</span>
                    <span><Clock3 size={11} />{formatRelativeTime(item.mtime)}</span>
                    {(item.inLinkCount > 0 || item.outLinkCount > 0) && (
                      <span className="vault-link-count" title={`${item.inLinkCount} 条反链，${item.outLinkCount} 条出链`}>
                        <Link2 size={11} /> {item.inLinkCount + item.outLinkCount}
                      </span>
                    )}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {!loading && serverLoadedCount < total && (
        <button type="button" className="btn btn-ghost btn-sm vault-load-more" onClick={() => void loadMore()} disabled={loadingMore}>
          {loadingMore ? "加载中…" : `加载更多（${serverLoadedCount}/${total}）`}
        </button>
      )}
    </aside>
  );

  const detailPanel = (
    <section className="vault-detail" aria-live="polite">
      {detailLoading ? (
        <div className="vault-detail-skeleton">
          <div className="skeleton h-8 w-48 rounded-lg" />
          <div className="skeleton h-4 w-full rounded-lg" />
          <div className="skeleton h-4 w-3/4 rounded-lg" />
          <div className="skeleton h-4 w-5/6 rounded-lg" />
        </div>
      ) : detail === null ? (
        <div className="vault-detail-empty">
          <BookOpen size={22} />
          <strong>从左侧选择一篇笔记</strong>
          <span>内容、链接与反链会在这里同步出现</span>
        </div>
      ) : (
        <article className="vault-note">
          <div className="vault-note-head">
            <div>
              <p className="vault-note-eyebrow"><FolderOpen size={12} />{folderLabel(detail.path)}</p>
              <h3>{detail.title}</h3>
              <div className="vault-note-meta">
                <span><Clock3 size={12} />{formatRelativeTime(detail.mtime)}</span>
                <span><Link2 size={12} />{detail.inLinkCount} 入 · {detail.outLinkCount} 出</span>
              </div>
            </div>
            {readOnly ? (
              <span className="vault-readonly-badge" title="蒲公英访问模式下禁止写回本机知识库">
                <ShieldCheck size={13} /> 蒲公英只读
              </span>
            ) : (
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={() => {
                  if (editing) {
                    setEditContent(detail.content);
                    setEditFrontmatter(detail.frontmatter ?? "");
                    setSaveError("");
                    setEditing(false);
                  } else {
                    setEditorTab("write");
                    setEditing(true);
                  }
                }}
                disabled={saving}
              >
                {editing ? <X size={14} /> : <PencilLine size={14} />}
                {editing ? "取消" : "编辑正文"}
              </button>
            )}
          </div>

          {tags.length > 0 && !editing && (
            <div className="vault-note-tags">
              {tags.map((tag) => <span className="vault-tag" key={tag}>#{tag}</span>)}
            </div>
          )}

          {editing ? (
            <div className={`vault-editor vault-editor-tab-${editorTab}`}>
              <div className="vault-editor-toolbar">
                <div className="vault-editor-tabs" role="tablist" aria-label="编辑器视图">
                  <button type="button" role="tab" aria-selected={editorTab === "write"} onClick={() => setEditorTab("write")}><PencilLine size={13} />正文</button>
                  <button type="button" role="tab" aria-selected={editorTab === "preview"} onClick={() => setEditorTab("preview")}><BookOpen size={13} />预览</button>
                </div>
                <span>正文编辑 · 元数据已自动保留</span>
              </div>
              <div className="vault-editor-grid">
                <div className="vault-editor-pane vault-editor-pane-write">
                  <textarea
                    ref={editorRef}
                    className="vault-editor-textarea"
                    value={editContent}
                    onChange={(event) => {
                      const next = event.currentTarget.value;
                      setEditContent(next);
                      updateSuggestions(next, event.currentTarget.selectionStart ?? next.length);
                    }}
                    onKeyDown={handleEditorKeyDown}
                    spellCheck={false}
                    aria-label="笔记正文编辑"
                  />
                  {linkSuggestions.length > 0 && (
                    <ul className="vault-link-suggestions" role="listbox">
                      {linkSuggestions.map((title, index) => (
                        <li key={title}>
                          <button
                            type="button"
                            role="option"
                            aria-selected={index === suggestionIndex}
                            className={index === suggestionIndex ? "vault-link-suggestion-active" : ""}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => applySuggestion(title)}
                          >
                            <Link2 size={12} />{title}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="vault-editor-pane vault-editor-pane-preview">
                  <VaultMarkdown content={editContent} links={detail.wikilinks} onOpen={(path) => openNote(path)} />
                </div>
              </div>
              <details className="vault-frontmatter-editor">
                <summary><Code2 size={13} />高级元数据</summary>
                <textarea value={editFrontmatter} onChange={(event) => setEditFrontmatter(event.currentTarget.value)} spellCheck={false} aria-label="笔记元数据" />
              </details>
              <p className="vault-editor-hint">输入 [[ 可补全笔记链接；保存后与 Obsidian 双向同步。</p>
              {saveError !== "" && <p className="vault-save-error">{saveError}</p>}
              <div className="vault-editor-actions">
                <button type="button" className="btn btn-primary btn-sm" onClick={() => void handleSave()} disabled={saving}>
                  <Save size={14} />{saving ? "保存中…" : "保存正文"}
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="vault-note-body">
                <VaultMarkdown content={detail.content} links={detail.wikilinks} onOpen={(path) => openNote(path)} />
              </div>
              <div className="vault-note-section">
                <h4><Link2 size={13} />相关笔记 {detail.wikilinks.length > 0 ? `(${detail.wikilinks.length})` : ""}</h4>
                {detail.wikilinks.length === 0 ? (
                  <p className="vault-section-empty">这篇笔记还没有链接到其他笔记</p>
                ) : (
                  <div className="vault-link-chips">
                    {detail.wikilinks.map((link) => (
                      <button
                        type="button"
                        key={`${link.target}-${link.embed ? "embed" : "link"}`}
                        className={`vault-chip ${link.resolvedPath === null ? "vault-chip-dangling" : ""}`}
                        title={link.resolvedPath === null ? `未找到笔记：${link.target}` : link.resolvedPath}
                        disabled={link.resolvedPath === null}
                        onClick={() => { if (link.resolvedPath !== null) openNote(link.resolvedPath); }}
                      >
                        {link.embed ? <ExternalLink size={11} /> : <Link2 size={11} />}
                        {link.label ?? link.target}
                      </button>
                    ))}
                  </div>
                )}
                {detail.isDangling.length > 0 && (
                  <p className="vault-dangling-hint">待补链接 {detail.isDangling.length} 条：{detail.isDangling.join("、")}</p>
                )}
              </div>
              <div className="vault-note-section">
                <h4><FileText size={13} />引用这篇 {detail.backlinks.length > 0 ? `(${detail.backlinks.length})` : ""}</h4>
                {detail.backlinks.length === 0 ? (
                  <p className="vault-section-empty">还没有其他笔记引用这篇</p>
                ) : (
                  <ul className="vault-backlinks">
                    {detail.backlinks.map((backlink) => (
                      <li key={backlink.source}>
                        <button type="button" onClick={() => openNote(backlink.source)}>
                          <span className="vault-backlink-title">{backlink.title}</span>
                          {backlink.excerpt !== null && <span className="vault-backlink-excerpt">{backlink.excerpt}</span>}
                          <ArrowRight size={13} aria-hidden="true" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </article>
      )}
    </section>
  );

  const graphPanel = (
    <section className="vault-graph-wrap" aria-label="3D 图谱">
      {graphLoading ? (
        <div className="vault-graph-loading"><div className="skeleton h-96 rounded-2xl" /></div>
      ) : graph === null ? (
        <div className="vault-empty"><Network size={22} /><span>图谱数据加载中</span></div>
      ) : (
        <GraphView
          graph={graph}
          focusedPath={selectedPath}
          filteredPaths={graphFilterPaths}
          onSelect={setSelectedPath}
          onOpen={(path) => openNote(path, true)}
        />
      )}
    </section>
  );

  return (
    <div className="workspace-page vault-workspace">
      <div className="vault-head">
        <div>
          <p className="section-kicker">KNOWLEDGE BASE</p>
          <h2>知识库</h2>
          <p className="vault-head-stats">
            {stats?.noteCount ?? total} 篇笔记 · {stats?.linkCount ?? graph?.stats.linkCount ?? 0} 条链接
            {(stats?.danglingLinkCount ?? 0) > 0 ? ` · ${stats?.danglingLinkCount} 条待补` : ""}
          </p>
        </div>
        <div className="vault-head-actions">
          {readOnly && <span className="vault-readonly-badge"><ShieldCheck size={13} />远程只读</span>}
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={() => {
              void refreshVault()
                .then(() => {
                  setGraph(null);
                  setRevision((current) => current + 1);
                })
                .catch((caughtError: unknown) => setError(caughtError instanceof Error ? caughtError.message : "刷新失败。"));
            }}
            aria-label="重新扫描知识库"
            title="重新扫描 Obsidian 笔记"
          >
            <RefreshCw size={14} /><span className="vault-btn-label">重新扫描</span>
          </button>
          <div className="vault-view-toggle" role="tablist" aria-label="知识库主视图">
            <button type="button" role="tab" aria-selected={view === "list"} className={`vault-view-btn ${view === "list" ? "vault-view-btn-active" : ""}`} onClick={() => setView("list")}>
              <BookOpen size={15} />阅读
            </button>
            <button type="button" role="tab" aria-selected={view === "graph"} className={`vault-view-btn ${view === "graph" ? "vault-view-btn-active" : ""}`} onClick={() => setView("graph")}>
              <Network size={15} />3D 图谱
            </button>
          </div>
        </div>
      </div>

      <div className="vault-search">
        <Search size={16} className="vault-search-icon" />
        <input
          type="search"
          className="input vault-search-input"
          placeholder="搜索标题、正文或路径…"
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
        <span className="vault-search-hint">{appliedQuery === "" ? "支持中文全文检索" : `${total} 个结果`}</span>
        {query !== "" && <button type="button" className="vault-search-clear" onClick={() => setQuery("")} aria-label="清除搜索"><X size={14} /></button>}
      </div>

      {error !== "" && (
        <div className="alert alert-error vault-error">
          <span>{error}</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRevision((current) => current + 1)}><RefreshCw size={14} />重试</button>
        </div>
      )}

      <div className={`vault-layout ${view === "graph" ? "vault-layout-graph" : ""}`}>
        {listPanel}
        {view === "graph" ? graphPanel : detailPanel}
        {view === "graph" && detailPanel}
      </div>
    </div>
  );
}
