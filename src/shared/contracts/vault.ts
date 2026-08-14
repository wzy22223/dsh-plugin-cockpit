export interface VaultNoteSummary {
  path: string;
  title: string;
  kind: string;
  excerpt: string | null;
  outLinkCount: number;
  inLinkCount: number;
  mtime: number;
  indexedAt: number;
}

export interface VaultNoteDetail extends VaultNoteSummary {
  frontmatter: string | null;
  content: string;
  wikilinks: Array<{
    target: string;
    label: string | null;
    embed: boolean;
    resolvedPath: string | null;
  }>;
  backlinks: Array<{ source: string; title: string; excerpt: string | null }>;
  isDangling: string[]; // 出链中未解析到笔记的目标
}

export interface VaultSearchResult {
  query: string;
  total: number;
  items: VaultNoteSummary[];
}

export interface VaultGraphNode {
  path: string;
  title: string;
  kind: string;
  degree: number;
}

export interface VaultGraphLink {
  source: string;
  target: string;
}

export interface VaultGraph {
  nodes: VaultGraphNode[];
  links: VaultGraphLink[];
  stats: {
    noteCount: number;
    linkCount: number;
    danglingLinkCount: number;
    lastIndexedAt: number | null;
  };
}

export interface VaultStats {
  noteCount: number;
  linkCount: number;
  danglingLinkCount: number;
  lastIndexedAt: number | null;
  totalSizeBytes: number;
  /** 蒲公英访问模式下为 true；前端据此隐藏本机文件写入入口。 */
  readOnly?: boolean;
}

export interface VaultSaveResult {
  path: string;
  mtime: number;
}
