import { spawn } from "node:child_process";

/**
 * 把条目里保存的 file: URL 还原为操作系统路径。
 * - win32：file:///C:/a/b → C:\a\b；file://server/share → \\server\share
 * - 其他平台：file:///home/a → /home/a
 * 输入不是 file: 或形态不合法时返回 null。
 */
export function fileUrlToOsPath(
  fileUrl: string,
  platform: NodeJS.Platform = process.platform,
): string | null {
  let url: URL;
  try {
    url = new URL(fileUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "file:") {
    return null;
  }

  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }

  if (platform === "win32") {
    const host = url.hostname;
    if (host !== "" && host !== "localhost") {
      return `\\\\${host}${decodedPath.replace(/\//g, "\\")}`;
    }
    if (!/^\/[A-Za-z]:/.test(decodedPath)) {
      return null;
    }
    return decodedPath.slice(1).replace(/\//g, "\\");
  }

  return decodedPath.length > 0 ? decodedPath : null;
}

export type OpenLauncher = (target: string) => Promise<void>;

/**
 * 用系统默认方式打开本机路径（win32 资源管理器 / macOS open / Linux xdg-open）。
 * spawn + execFile 语义，不经过 shell，路径以参数形式传递，杜绝命令注入。
 */
export function createSystemLauncher(
  platform: NodeJS.Platform = process.platform,
): OpenLauncher {
  return (target) =>
    new Promise((resolve, reject) => {
      const command =
        platform === "win32"
          ? "explorer.exe"
          : platform === "darwin"
            ? "open"
            : "xdg-open";
      const child = spawn(command, [target], {
        detached: true,
        stdio: "ignore",
      });
      child.once("error", reject);
      child.once("spawn", () => {
        child.unref();
        resolve();
      });
    });
}
