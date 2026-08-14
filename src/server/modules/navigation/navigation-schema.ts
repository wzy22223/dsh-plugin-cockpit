import { z } from "zod";

import { navigationAccents } from "../../../shared/contracts/navigation.js";
import { fileUrlToOsPath } from "./navigation-launcher.js";

const entryTargetUrl = z
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
        message: "请输入完整的 http 或 https 网址，或本地路径。",
      });
      return;
    }

    if (!["http:", "https:", "file:"].includes(url.protocol)) {
      context.addIssue({
        code: "custom",
        message: "只支持 http、https 网址或本机文件路径。",
      });
      return;
    }

    if (url.username !== "" || url.password !== "") {
      context.addIssue({
        code: "custom",
        message: "网址不能包含用户名或密码。",
      });
      return;
    }

    if (url.protocol === "file:" && fileUrlToOsPath(value) === null) {
      context.addIssue({
        code: "custom",
        message: "本地路径格式不正确，例如 C:\\Users\\demo。",
      });
    }
  });

const name = z.string().trim().min(1, "请输入入口名称。").max(80);
const description = z.string().trim().max(200);
const category = z.string().trim().min(1).max(40);
const accent = z.enum(navigationAccents);
const position = z.number().int().min(0).max(100_000);

export const createNavigationSchema = z.object({
  name,
  url: entryTargetUrl,
  description: description.optional().default(""),
  category: category.optional().default("工作系统"),
  accent: accent.optional().default("blue"),
  position: position.optional().default(100),
});

export const updateNavigationSchema = z
  .object({
    name: name.optional(),
    url: entryTargetUrl.optional(),
    description: description.optional(),
    category: category.optional(),
    accent: accent.optional(),
    position: position.optional(),
  })
  .refine((value) => Object.values(value).some((item) => item !== undefined), {
    message: "请至少修改一项内容。",
  });
