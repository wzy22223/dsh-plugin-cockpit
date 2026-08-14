import { z } from "zod";

const title = z
  .string()
  .trim()
  .min(1, "请输入资料标题。")
  .max(120, "资料标题不能超过 120 个字符。");

const tag = z
  .string()
  .trim()
  .min(1, "标签不能为空。")
  .max(32, "单个标签不能超过 32 个字符。");

export const resourceTagsSchema = z
  .array(tag)
  .max(12, "每条资料最多添加 12 个标签。")
  .transform((values) => {
    const seen = new Set<string>();
    return values.filter((value) => {
      const normalized = value.toLocaleLowerCase("zh-CN");
      if (seen.has(normalized)) {
        return false;
      }
      seen.add(normalized);
      return true;
    });
  });

const safeHttpUrl = z
  .string()
  .trim()
  .min(1, "请输入网址。")
  .max(2048, "网址不能超过 2048 个字符。")
  .superRefine((value, context) => {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      context.addIssue({
        code: "custom",
        message: "请输入完整的 http 或 https 网址。",
      });
      return;
    }

    if (!["http:", "https:"].includes(url.protocol)) {
      context.addIssue({
        code: "custom",
        message: "网址只允许使用 http 或 https。",
      });
    }

    if (url.username !== "" || url.password !== "") {
      context.addIssue({
        code: "custom",
        message: "网址不能包含用户名或密码。",
      });
    }
  });

export const createResourceSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("note"),
      title,
      content: z
        .string()
        .trim()
        .min(1, "请输入笔记内容。")
        .max(50_000, "笔记内容不能超过 50000 个字符。"),
      tags: resourceTagsSchema.optional().default([]),
    })
    .strict(),
  z
    .object({
      kind: z.literal("link"),
      title,
      url: safeHttpUrl,
      tags: resourceTagsSchema.optional().default([]),
    })
    .strict(),
]);

export const listResourcesQuerySchema = z
  .object({
    query: z
      .string()
      .trim()
      .max(100, "搜索内容不能超过 100 个字符。")
      .optional()
      .default(""),
    kind: z.enum(["file", "link", "note"]).optional(),
    trash: z
      .enum(["true", "false"])
      .optional()
      .default("false")
      .transform((value) => value === "true"),
  })
  .strict();

export const uploadResourceFieldsSchema = z
  .object({
    title,
    tags: resourceTagsSchema.optional().default([]),
  })
  .strict();
