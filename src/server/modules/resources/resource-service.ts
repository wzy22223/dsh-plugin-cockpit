import path from "node:path";
import type { Readable } from "node:stream";

import type {
  CreateResourceInput,
  ResourceItem,
  ResourceKind,
} from "../../../shared/contracts/resources.js";
import {
  normalizeResourceFilename,
  ResourceStorage,
  UnsafeResourcePathError,
  type StoredResourceFile,
} from "../../platform/resource-storage.js";
import {
  ResourceRepository,
  type ResourceListFilter,
} from "./resource-repository.js";

interface FileTypeRule {
  mimeType: string;
  headerMatches: (header: Buffer) => boolean;
}

const oleHeader = Buffer.from("d0cf11e0a1b11ae1", "hex");

const fileTypeRules: Readonly<Record<string, FileTypeRule>> = {
  ".pdf": {
    mimeType: "application/pdf",
    headerMatches: (header) => header.indexOf(Buffer.from("%PDF-")) >= 0,
  },
  ".png": {
    mimeType: "image/png",
    headerMatches: (header) =>
      header.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")),
  },
  ".jpg": {
    mimeType: "image/jpeg",
    headerMatches: (header) =>
      header.subarray(0, 3).equals(Buffer.from("ffd8ff", "hex")),
  },
  ".jpeg": {
    mimeType: "image/jpeg",
    headerMatches: (header) =>
      header.subarray(0, 3).equals(Buffer.from("ffd8ff", "hex")),
  },
  ".gif": {
    mimeType: "image/gif",
    headerMatches: (header) =>
      ["GIF87a", "GIF89a"].includes(header.subarray(0, 6).toString("ascii")),
  },
  ".webp": {
    mimeType: "image/webp",
    headerMatches: (header) =>
      header.subarray(0, 4).toString("ascii") === "RIFF" &&
      header.subarray(8, 12).toString("ascii") === "WEBP",
  },
  ".doc": {
    mimeType: "application/msword",
    headerMatches: (header) => header.subarray(0, 8).equals(oleHeader),
  },
  ".docx": {
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    headerMatches: (header) =>
      header.subarray(0, 4).equals(Buffer.from("504b0304", "hex")),
  },
  ".xls": {
    mimeType: "application/vnd.ms-excel",
    headerMatches: (header) => header.subarray(0, 8).equals(oleHeader),
  },
  ".xlsx": {
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    headerMatches: (header) =>
      header.subarray(0, 4).equals(Buffer.from("504b0304", "hex")),
  },
};

export interface PendingResourceFile extends StoredResourceFile {
  mimeType: string;
}

export interface ResourceDownload {
  item: ResourceItem;
  stream: Readable;
  sizeBytes: number;
}

export class InvalidResourceFileError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "InvalidResourceFileError";
  }
}

export class ResourceService {
  public constructor(
    private readonly repository: ResourceRepository,
    private readonly storage: ResourceStorage,
  ) {}

  public get maxFileBytes(): number {
    return this.storage.maxFileBytes;
  }

  public list(filter: ResourceListFilter): ResourceItem[] {
    return this.repository.list(filter);
  }

  public create(input: CreateResourceInput): ResourceItem {
    return this.repository.create({
      ...input,
      tags: input.tags ?? [],
    });
  }

  public async stageFile(
    stream: Readable,
    originalFilename: string,
    suppliedMimeType: string,
  ): Promise<PendingResourceFile> {
    let normalizedFilename: string;
    try {
      normalizedFilename = normalizeResourceFilename(originalFilename);
    } catch {
      throw new InvalidResourceFileError("请选择带有有效文件名的文件。");
    }

    const extension = path.extname(normalizedFilename).toLowerCase();
    const rule = fileTypeRules[extension];
    if (rule === undefined) {
      throw new InvalidResourceFileError(
        "仅支持 PDF、PNG、JPG、GIF、WebP、Word 和 Excel 文件。",
      );
    }

    const normalizedMimeType = suppliedMimeType
      .split(";", 1)[0]
      ?.trim()
      .toLowerCase();
    if (
      normalizedMimeType !== rule.mimeType &&
      normalizedMimeType !== "application/octet-stream"
    ) {
      throw new InvalidResourceFileError("文件扩展名与文件类型不一致。");
    }

    const stored = await this.storage.saveFile(stream, normalizedFilename);
    if (!rule.headerMatches(stored.header)) {
      await this.storage.removeFile(stored.relativePath);
      throw new InvalidResourceFileError("文件内容与所选文件类型不一致。");
    }

    return {
      ...stored,
      mimeType: rule.mimeType,
    };
  }

  public async createFile(
    pendingFile: PendingResourceFile,
    input: { title: string; tags: string[] },
  ): Promise<ResourceItem> {
    try {
      return this.repository.create({
        kind: "file",
        title: input.title,
        tags: input.tags,
        storagePath: pendingFile.relativePath,
        originalFilename: pendingFile.originalFilename,
        mimeType: pendingFile.mimeType,
        sizeBytes: pendingFile.sizeBytes,
      });
    } catch (error) {
      await this.storage.removeFile(pendingFile.relativePath);
      throw error;
    }
  }

  public async discardFile(pendingFile: PendingResourceFile): Promise<void> {
    await this.storage.removeFile(pendingFile.relativePath);
  }

  public softDelete(id: string): boolean {
    return this.repository.softDelete(id);
  }

  public restore(id: string): ResourceItem | null {
    return this.repository.restore(id);
  }

  public async download(id: string): Promise<ResourceDownload | null> {
    const item = this.repository.findActive(id);
    const storagePath = this.repository.findStoragePath(id);
    if (
      item === null ||
      item.kind !== "file" ||
      item.originalFilename === null ||
      item.mimeType === null ||
      storagePath === null
    ) {
      return null;
    }

    try {
      const opened = await this.storage.openFile(storagePath);
      return {
        item,
        stream: opened.stream,
        sizeBytes: opened.sizeBytes,
      };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || error instanceof UnsafeResourcePathError) {
        return null;
      }
      throw error;
    }
  }
}
