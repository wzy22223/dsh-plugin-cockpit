# dsh-plugin-cockpit

**Personal Cockpit 工作台 — DSH 插件版**（融合方案实施，agent 模块已移除）

把个人工作台的业务层（导航 / 日程 / 资料 / 仓管 / 知识库 + SQLite + 前端视图）内嵌为
DSH 可加载的 Cordis 插件，并在进程内提供：

- **业务 REST API**：`/api/*`（loopback 仅本机，沿用原工作台全部业务语义）
- **前端视图**：工作台 SPA（`/`，已去除 Pi 面板 / Agent 中心）
- **MCP 工具面**：`/mcp`，23 个业务工具（navigation/tasks/resources/warehouse/vault/scripts），
  供 DSH 的 MCP client 连接调用 —— 写操作权限由 DSH 侧 MCP 配置决定

**已移除**（融合方案）：Pi Agent（WS 对话）、审批状态机、per-agent 记忆/技能/角色、
MCP 客户端、上网工具（DSH 宿主自带 web 与记忆体系）、蒲公英模式。

## 安装（另一台已装 DSH 的机器）

```bash
# 1. 拉取插件并装进 DSH 的 profile 依赖区（DSH 加载器从 profiles/node_modules 解析包名）
git clone https://github.com/wzy22223/dsh-plugin-cockpit.git
cd dsh-plugin-cockpit
npm install            # 含 better-sqlite3 原生编译（用运行 DSH 的 node 执行）
npm run build:all      # 编译 lib + 构建前端 web/dist
# 让 DSH 能解析包名（二选一）：
#   a) 拷到依赖区：  cp -r . ~/.dsh/profiles/node_modules/dsh-plugin-cockpit
#   b) 软链接：      ln -s "$PWD" ~/.dsh/profiles/node_modules/dsh-plugin-cockpit

# 2. 配置 DSH 组合（~/.dsh/profiles/web/cordis.patch.yml），追加 insert 条目：
#   - insert:
#       - id: cockpit
#         name: dsh-plugin-cockpit
#         config:
#           dataDir: /path/to/your/userdata   # 指向已有工作台数据；省略 = 插件目录内 userdata/
#           port: 7799                        # 默认 7799

# 3. 重启 DSH → 浏览器访问 http://127.0.0.1:7799 即工作台
#    如需 DSH agent 调用业务工具，在 DSH 侧配置 MCP server：
#    端点 http://127.0.0.1:7799/mcp （Streamable HTTP，本机）
```

> patch 语法说明：`cordis.patch.yml` 是 patch 层（按 id 覆盖/`insert:` 追加），
> 不是直接 entry 列表——新增插件必须用 `- insert: [...]` 包裹，否则加载器会因找不到目标条目而跳过。

### 数据目录

| 配置 | 说明 |
|---|---|
| `config.dataDir` | 业务数据根（SQLite + 仓库 JSON + 通知），默认 `<插件根>/userdata` |
| `config.vaultDir` | 知识库（Obsidian vault）目录，默认 `<dataDir>/vault` |
| `config.scriptsDir` | B1 脚本目录，默认 `<插件根>/scripts` |
| 环境变量 | `COCKPIT_DATA_DIR` / `COCKPIT_VAULT_DIR` / `COCKPIT_SCRIPTS_DIR` 优先于 config |

指向已有 Cockpit 的 `userdata` 目录即可**零拷贝复用**全部数据（已验证）。

### 常用配置项

```yaml
- id: cockpit
  name: dsh-plugin-cockpit
  config:
    dataDir: D:\cockpit\userdata        # Windows 写法
    port: 7799
    host: 127.0.0.1
    mcpEnabled: true                    # 挂 /mcp 工具面（默认 true）
    serveStaticWeb: true                # 服务前端（默认 true）
```

## 能力清单

- 工作入口（增删查/系统打开）、日程待办、资料中心（网址/笔记/文件）、仓管数据
  （概览/发货/退货/库存/排除清单）、知识库检索、3 个本地脚本异步触发（ERP/淘宝/得物）
- 写操作沿用原安全语义：路径白名单（`.env/.git/.ssh/...` 拒绝）、资源笔记正文裁剪、
  本机来源校验（`/mcp` 豁免写请求标识，因调用方为 DSH 本机进程）

## 开发

```bash
npm run dev          # 本地起 7799（COCKPIT_DATA_DIR 可指向测试数据）
npm run test         # vitest（66 个业务测试）
npm run smoke        # DSH loader 语义冒烟：按包名加载 → health/MCP 校验 → 卸载清理
npm run build:all    # lib + web/dist
```

## DSH 界面内嵌视图（已实测）

在 DSH Web GUI 的会话标题栏（chat 旁）新增 **「工作台」tab**，点击即可在 DSH 界面内
使用工作台（iframe 嵌入插件服务），切换由 shell 原生管理：

- 本机实测方式：用 DSH 的 cordis 动态插件工具加载 `web/client-plugin.js` 的
  `code.client`（`conversation.view` 插槽注册，id `workbench`，label「工作台」）
- 源码已入库：`web/client-plugin.js`（含接入注释）
- 正式随包分发（`exports["./client"]` + `dsh.client` 声明的 `__ModuleLoader__`
  bundle）需 DSH 构建链生成，属后续迭代

## 实施状态（2026-08-14）

- ✅ 业务层内嵌插件：进程内 Fastify（REST + 前端 + MCP 端点），数据目录可配置
- ✅ 去 agent：Pi/WS/审批/记忆/技能/角色/MCP 客户端/上网工具/蒲公英已移除，前端 Pi 面板与 Agent 中心已删
- ✅ MCP 工具面 23 个工具经 `initialize/tools/list/tools/call` 实测（真实 userdata 数据）
- ✅ 数据目录指向真实 Cockpit `userdata` 零拷贝复用（导航/日程/仓库/资料实测）
- ✅ **DSH loader 语义验证**：按包名 `dsh-plugin-cockpit` 经 `cordis-plugin-loader` 加载/卸载
  冒烟通过（`npm run smoke`）；清理走 `ctx.effect`（与 DSH 官方插件一致——
  loader entry 路径不收集 apply 返回值作为 disposer）
- ✅ **DSH 界面内嵌视图**：会话「工作台」tab 实测可用（动态插件验证），client 源码入库
- ✅ 66 个业务测试 + tsc + 生产构建通过
- ⏳ client 视图正式 bundle 化随包分发（需 DSH 构建链）

## 与独立版（personal-cockpit）的关系

- 独立版保留，作为开发/对照；本插件是其业务层的 DSH 内嵌形态。
- 移除项详见上；业务 REST 与前端视图行为一致。
