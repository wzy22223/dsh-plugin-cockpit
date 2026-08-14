export type ResourceKind = "file" | "link" | "note";

export interface ResourceItem {
  id: string;
  kind: ResourceKind;
  title: string;
  tags: string[];
  url: string | null;
  content: string | null;
  originalFilename: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export type CreateResourceInput =
  | {
      kind: "note";
      title: string;
      content: string;
      tags?: string[];
    }
  | {
      kind: "link";
      title: string;
      url: string;
      tags?: string[];
    };

export interface ResourceListResponse {
  items: ResourceItem[];
}
