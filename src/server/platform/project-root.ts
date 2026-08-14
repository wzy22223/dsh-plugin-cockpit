import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));

/** 插件内资源根（lib/.. = 插件根），用于定位 migrations 与 web/dist */
export function pluginRoot(startDirectory = moduleDirectory): string {
  let current = path.resolve(startDirectory);

  while (true) {
    const packagePath = path.join(current, "package.json");

    if (existsSync(packagePath)) {
      try {
        const packageJson = JSON.parse(readFileSync(packagePath, "utf8")) as {
          name?: string;
        };

        if (packageJson.name === "dsh-plugin-cockpit") {
          return current;
        }
      } catch {
        // Continue walking. A parent package.json may belong to another project.
      }
    }

    const parent = path.dirname(current);
    if (parent === current) {
      throw new Error("无法定位 dsh-plugin-cockpit 插件根目录。");
    }
    current = parent;
  }
}

export function migrationsDir(root = pluginRoot()): string {
  return path.join(root, "migrations");
}

export function webDistDir(root = pluginRoot()): string {
  return path.join(root, "web", "dist");
}

/** 兼容原独立版的 findProjectRoot()（业务模块无感迁移用） */
export const findProjectRoot = pluginRoot;
