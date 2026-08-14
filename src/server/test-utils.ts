import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import type { AppConfig } from "./platform/config.js";

export interface TestWorkspace {
  root: string;
  config: AppConfig;
  cleanup: () => void;
}

export function createTestWorkspace(): TestWorkspace {
  const root = mkdtempSync(path.join(os.tmpdir(), "personal-cockpit-test-"));
  const dataRoot = path.join(root, "userdata");
  mkdirSync(dataRoot, { recursive: true });

  return {
    root,
    config: {
      host: "127.0.0.1",
      port: 7778,
      projectRoot: path.resolve("."),
      dataRoot,
      databasePath: path.join(dataRoot, "cockpit.sqlite"),
      scriptsDir: path.join(path.resolve("."), "scripts"),
      vaultDir: path.join(dataRoot, "vault"),
      isProduction: false,
      accessMode: "loopback",
    },
    cleanup: () => {
      const resolvedRoot = path.resolve(root);
      const resolvedTemp = path.resolve(os.tmpdir());
      if (
        !resolvedRoot.startsWith(`${resolvedTemp}${path.sep}`) ||
        !path.basename(resolvedRoot).startsWith("personal-cockpit-test-")
      ) {
        throw new Error(`拒绝清理非测试目录：${resolvedRoot}`);
      }
      rmSync(resolvedRoot, { recursive: true, force: true });
    },
  };
}
