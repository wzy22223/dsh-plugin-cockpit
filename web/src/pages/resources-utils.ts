import { FileText, Link2, StickyNote } from "lucide-react";

import type {
  ResourceItem,
  ResourceKind,
} from "../../shared/contracts/resources";

export function resourceIcon(item: ResourceItem): typeof FileText {
  if (item.kind === "link") {
    return Link2;
  }
  if (item.kind === "note") {
    return StickyNote;
  }
  return FileText;
}

export function resourceKindLabel(kind: ResourceKind): string {
  if (kind === "file") {
    return "文件";
  }
  if (kind === "link") {
    return "网址";
  }
  return "笔记";
}

const resourceDateFormatter = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "long",
  day: "numeric",
});

export function formatResourceDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : resourceDateFormatter.format(date);
}

export function formatSize(size: number | null): string {
  if (size === null) {
    return "";
  }
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${Math.round(size / 1024)} KB`;
  }
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}
