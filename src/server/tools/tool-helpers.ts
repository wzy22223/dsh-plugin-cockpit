/**
 * MCP 工具辅助函数
 * 敏感路径白名单自原 security/agent-policy.ts 迁移（agent 模块移除后内联）。
 */
import path from "node:path";

/** 始终禁止读取/写入的路径段（防凭据与敏感数据经工具外发） */
const alwaysDeniedPathSegments = [
  ".env",
  ".git",
  ".ssh",
  ".aws",
  ".codex",
  "cookies",
  "browser-data",
  "credentials",
  "private-key",
] as const;

/** 检查路径是否触碰敏感段 */
export function checkPathSafe(filePath: string): string | null {
  const normalized = path.normalize(filePath).toLowerCase();
  for (const seg of alwaysDeniedPathSegments) {
    const parts = normalized.split(path.sep);
    if (parts.includes(seg.toLowerCase())) {
      return seg;
    }
    if (normalized.includes(path.sep + seg.toLowerCase() + path.sep)) {
      return seg;
    }
  }
  return null;
}
