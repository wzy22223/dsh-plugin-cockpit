export type NormalizeUrlResult =
  | { ok: true; url: string; corrected: boolean }
  | { ok: false; message: string };

const schemePattern = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//;
const ipv4Pattern = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const windowsDrivePattern = /^[A-Za-z]:[\\/]/;
const windowsUncPattern = /^\\\\/;

function isLocalHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (lower === "localhost" || lower === "::1" || lower === "[::1]") {
    return true;
  }
  if (lower.endsWith(".local") || lower.endsWith(".internal")) {
    return true;
  }

  const match = ipv4Pattern.exec(lower);
  if (match === null) {
    return false;
  }

  const first = Number(match[1]);
  const second = Number(match[2]);
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

/** Windows 本机路径（C:\… 或 \\nas\…）转 file: URL，失败返回 null */
function windowsPathToFileUrl(raw: string): string | null {
  if (windowsDrivePattern.test(raw)) {
    try {
      return new URL(`file:///${raw.replace(/\\/g, "/")}`).toString();
    } catch {
      return null;
    }
  }
  if (windowsUncPattern.test(raw)) {
    try {
      return new URL(`file:${raw.replace(/\\/g, "/")}`).toString();
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * 把工作入口输入归一化为可保存的目标。
 * - 省略协议：localhost/内网 IP 补 http://，域名补 https://
 * - Windows 本机路径（C:\…、\\nas\…）转 file:/// URL
 * - 与后端一致：只允许 http/https/file，拒绝用户名密码
 */
export function normalizeHttpUrl(rawInput: string): NormalizeUrlResult {
  const raw = rawInput.trim();
  if (raw === "") {
    return { ok: false, message: "请输入网址。" };
  }
  if (/\s/.test(raw) && !windowsDrivePattern.test(raw) && !raw.includes("\\")) {
    return { ok: false, message: "网址中不能包含空格。" };
  }

  const fileUrl = windowsPathToFileUrl(raw);
  if (fileUrl !== null) {
    return { ok: true, url: fileUrl, corrected: true };
  }

  const hasScheme = schemePattern.test(raw);
  let candidate = hasScheme ? raw : `https://${raw}`;

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return { ok: false, message: "无法识别这个网址，请检查后重试。" };
  }

  if (!["http:", "https:", "file:"].includes(url.protocol)) {
    return {
      ok: false,
      message: "只支持 http、https 网址或本机路径（如 C:\\Users\\demo）。",
    };
  }
  if (url.username !== "" || url.password !== "") {
    return { ok: false, message: "网址不能包含用户名或密码。" };
  }
  if (url.protocol === "file:") {
    // file: 输入直接交给后端做平台相关校验，这里只要求有路径内容
    if (url.pathname.length <= 1 && url.hostname === "") {
      return { ok: false, message: "本地路径格式不正确，例如 C:\\Users\\demo。" };
    }
    return { ok: true, url: url.toString(), corrected: !hasScheme };
  }
  if (url.hostname === "") {
    return {
      ok: false,
      message: "请输入完整的网址，例如 localhost:3000 或 https://example.com。",
    };
  }

  // 省略协议且指向本机/内网时，本地服务一般跑在 http 上
  if (!hasScheme && isLocalHost(url.hostname)) {
    candidate = candidate.replace(/^https:\/\//, "http://");
    url = new URL(candidate);
  }

  return { ok: true, url: url.toString(), corrected: !hasScheme };
}

/** 是否为本机路径入口 */
export function isFileTarget(rawUrl: string): boolean {
  try {
    return new URL(rawUrl).protocol === "file:";
  } catch {
    return false;
  }
}

/** 入口卡片展示用标签：网页取主机名，本机路径取末级目录/文件名 */
export function targetLabel(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    if (url.protocol === "file:") {
      const segments = decodeURIComponent(url.pathname)
        .split("/")
        .filter((segment) => segment !== "");
      const tail = segments[segments.length - 1];
      if (tail !== undefined) {
        return tail;
      }
      return url.hostname !== "" ? `\\\\${url.hostname}` : rawUrl;
    }
    return url.hostname.replace(/^www\./u, "");
  } catch {
    return rawUrl;
  }
}
