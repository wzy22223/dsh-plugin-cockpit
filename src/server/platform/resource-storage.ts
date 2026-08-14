import { randomUUID } from "node:crypto";
import {
  createReadStream,
  createWriteStream,
  mkdirSync,
} from "node:fs";
import {
  rename,
  stat,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

export const MAX_RESOURCE_FILE_BYTES = 25 * 1024 * 1024;

const storedFileNamePattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.[a-z0-9]+$/u;

export interface StoredResourceFile {
  relativePath: string;
  originalFilename: string;
  sizeBytes: number;
  header: Buffer;
}

export interface OpenedResourceFile {
  stream: Readable;
  sizeBytes: number;
}

export class ResourceFileTooLargeError extends Error {
  public constructor(public readonly limitBytes: number) {
    super(`文件不能超过 ${limitBytes} 字节。`);
    this.name = "ResourceFileTooLargeError";
  }
}

export class UnsafeResourcePathError extends Error {
  public constructor() {
    super("资料文件路径不安全。");
    this.name = "UnsafeResourcePathError";
  }
}

export function normalizeResourceFilename(filename: string): string {
  const basename = path.posix.basename(filename.replaceAll("\\", "/"));
  const normalized = basename
    .replace(/[\u0000-\u001f\u007f]/gu, "")
    .trim();

  if (normalized.length === 0 || normalized === "." || normalized === "..") {
    throw new Error("文件名不能为空。");
  }

  return Array.from(normalized).slice(0, 255).join("");
}

async function removeIfPresent(filePath: string): Promise<void> {
  try {
    await unlink(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}

export class ResourceStorage {
  private readonly dataRoot: string;
  private readonly resourcesRoot: string;
  private readonly temporaryRoot: string;

  public constructor(
    dataRoot: string,
    public readonly maxFileBytes = MAX_RESOURCE_FILE_BYTES,
  ) {
    if (!Number.isSafeInteger(maxFileBytes) || maxFileBytes < 1) {
      throw new Error("文件大小上限必须是正整数。");
    }

    this.dataRoot = path.resolve(dataRoot);
    this.resourcesRoot = path.join(this.dataRoot, "resources");
    this.temporaryRoot = path.join(this.resourcesRoot, ".tmp");
  }

  public async saveFile(
    stream: Readable,
    originalFilename: string,
  ): Promise<StoredResourceFile> {
    const normalizedFilename = normalizeResourceFilename(originalFilename);
    const extension = path.extname(normalizedFilename).toLowerCase();
    const storedFilename = `${randomUUID()}${extension}`;
    const relativePath = path.posix.join("resources", storedFilename);

    mkdirSync(this.temporaryRoot, { recursive: true });
    const temporaryPath = path.join(
      this.temporaryRoot,
      `.upload-${randomUUID()}.tmp`,
    );
    const finalPath = this.resolveFilePath(relativePath);

    let sizeBytes = 0;
    const headerChunks: Buffer[] = [];
    let headerBytes = 0;
    const inspectAndLimit = new Transform({
      transform: (chunk: Buffer | Uint8Array | string, _encoding, callback) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        sizeBytes += buffer.byteLength;

        if (sizeBytes > this.maxFileBytes) {
          callback(new ResourceFileTooLargeError(this.maxFileBytes));
          return;
        }

        if (headerBytes < 1024) {
          const prefix = buffer.subarray(0, 1024 - headerBytes);
          headerChunks.push(prefix);
          headerBytes += prefix.byteLength;
        }

        callback(null, buffer);
      },
    });

    try {
      await pipeline(
        stream,
        inspectAndLimit,
        createWriteStream(temporaryPath, {
          flags: "wx",
          mode: 0o600,
        }),
      );
      await rename(temporaryPath, finalPath);
    } catch (error) {
      await removeIfPresent(temporaryPath);
      throw error;
    }

    return {
      relativePath,
      originalFilename: normalizedFilename,
      sizeBytes,
      header: Buffer.concat(headerChunks),
    };
  }

  public async openFile(relativePath: string): Promise<OpenedResourceFile> {
    const filePath = this.resolveFilePath(relativePath);
    const fileStats = await stat(filePath);
    if (!fileStats.isFile()) {
      throw new UnsafeResourcePathError();
    }

    return {
      stream: createReadStream(filePath),
      sizeBytes: fileStats.size,
    };
  }

  public async removeFile(relativePath: string): Promise<void> {
    await removeIfPresent(this.resolveFilePath(relativePath));
  }

  public resolveFilePath(relativePath: string): string {
    if (
      relativePath.length === 0 ||
      path.isAbsolute(relativePath) ||
      path.posix.isAbsolute(relativePath) ||
      path.win32.isAbsolute(relativePath)
    ) {
      throw new UnsafeResourcePathError();
    }

    const segments = relativePath.split(/[\\/]/u);
    if (
      segments.length !== 2 ||
      segments[0] !== "resources" ||
      !storedFileNamePattern.test(segments[1] ?? "")
    ) {
      throw new UnsafeResourcePathError();
    }

    const candidate = path.resolve(this.dataRoot, ...segments);
    const expectedPrefix = `${this.resourcesRoot}${path.sep}`;
    if (!candidate.startsWith(expectedPrefix)) {
      throw new UnsafeResourcePathError();
    }

    return candidate;
  }
}
