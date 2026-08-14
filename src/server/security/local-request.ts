import type { FastifyInstance, FastifyRequest } from "fastify";

const localHostnames = new Set(["127.0.0.1", "localhost"]);
const mutationMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const resourceUploadPath = "/api/resources/upload";

export interface LocalRequestGuardOptions {
  allowedHostnames?: readonly string[];
  port?: number;
  /** 豁免写请求标识（x-cockpit-request）的路径前缀（如 MCP 端点 /mcp——调用方为 DSH MCP client 本机进程） */
  exemptPaths?: readonly string[];
}

interface RequestEndpoint {
  hostname: string;
  port: string;
  protocol: string;
}

function parseEndpoint(value: string, prefix: string): RequestEndpoint | null {
  try {
    const url = new URL(`${prefix}${value}`);
    return {
      hostname: url.hostname.toLowerCase(),
      port:
        url.port ||
        (url.protocol === "https:" ? "443" : url.protocol === "http:" ? "80" : ""),
      protocol: url.protocol,
    };
  } catch {
    return null;
  }
}

function endpointIsAllowed(
  endpoint: RequestEndpoint,
  allowedRemoteHostnames: ReadonlySet<string>,
  port: number | undefined,
): boolean {
  if (localHostnames.has(endpoint.hostname)) {
    return true;
  }

  return (
    endpoint.protocol === "http:" &&
    allowedRemoteHostnames.has(endpoint.hostname) &&
    (port === undefined || endpoint.port === String(port))
  );
}

function requestComesFromAllowedUi(
  request: FastifyRequest,
  allowedRemoteHostnames: ReadonlySet<string>,
  port: number | undefined,
): boolean {
  const host = request.headers.host;
  if (host === undefined) {
    return false;
  }

  const endpoint = parseEndpoint(host, "http://");
  if (
    endpoint === null ||
    !endpointIsAllowed(endpoint, allowedRemoteHostnames, port)
  ) {
    return false;
  }

  const origin = request.headers.origin;
  if (origin !== undefined) {
    const originEndpoint = parseEndpoint(origin, "");
    if (
      originEndpoint === null ||
      !endpointIsAllowed(originEndpoint, allowedRemoteHostnames, port)
    ) {
      return false;
    }
  }

  return true;
}

function isResourceUpload(request: FastifyRequest): boolean {
  if (request.method !== "POST") {
    return false;
  }

  try {
    return new URL(request.url, "http://localhost").pathname === resourceUploadPath;
  } catch {
    return false;
  }
}

export function registerLocalRequestGuard(
  app: FastifyInstance,
  options: LocalRequestGuardOptions = {},
): void {
  const allowedRemoteHostnames = new Set(
    (options.allowedHostnames ?? [])
      .map((hostname) => hostname.trim().toLowerCase())
      .filter(
        (hostname) =>
          hostname !== "" &&
          hostname !== "0.0.0.0" &&
          !localHostnames.has(hostname),
      ),
  );
  const exemptPrefixes = (options.exemptPaths ?? []).map((p) =>
    p.endsWith("/") ? p : `${p}/`,
  );

  app.addHook("onRequest", async (request, reply) => {
    if (
      !requestComesFromAllowedUi(
        request,
        allowedRemoteHostnames,
        options.port,
      )
    ) {
      return reply.code(403).send({
        error: {
          code: "LOCAL_ACCESS_ONLY",
          message: "Personal Cockpit 仅接受本机工作台请求。",
        },
      });
    }

    if (mutationMethods.has(request.method)) {
      let pathname = "/";
      try {
        pathname = new URL(request.url, "http://localhost").pathname;
      } catch {
        // 保留默认 "/"
      }
      const exempt = exemptPrefixes.some((prefix) =>
        pathname === prefix.slice(0, -1) || pathname.startsWith(prefix),
      );

      if (!exempt) {
        const contentType = request.headers["content-type"] ?? "";
        const csrfHeader = request.headers["x-cockpit-request"];

        if (csrfHeader !== "1") {
          return reply.code(403).send({
            error: {
              code: "REQUEST_HEADER_REQUIRED",
              message: "缺少工作台请求标识。",
            },
          });
        }

        const normalizedContentType = contentType.toLowerCase();
        const allowedContentType = isResourceUpload(request)
          ? normalizedContentType.startsWith("multipart/form-data;")
          : normalizedContentType.startsWith("application/json");

        if (!allowedContentType) {
          return reply.code(415).send({
            error: {
              code: isResourceUpload(request)
                ? "MULTIPART_REQUIRED"
                : "JSON_REQUIRED",
              message: isResourceUpload(request)
                ? "文件上传仅接受 multipart/form-data。"
                : "写操作仅接受 JSON。",
            },
          });
        }
      }
    }
  });
}
