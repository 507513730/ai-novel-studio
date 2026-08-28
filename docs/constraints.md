# 约束速查（constraints.md）

> v0.25.0（审查 L6）新增。
>
> **用途**：把仍然生效的约束按主题归拢在一页内，供新贡献者与 AI agent 快速对齐。
> 此前约束散落在 `AGENTS.md`（37 条硬约束）与 `docs/decision-log.md`（79KB 编年史）两处，
> 前者条目虽全但不分主题，后者按时间线性堆积、难以检索。
>
> **本文件是索引，不是替代**：每条都标注了出处（`A{n}` = AGENTS.md 硬约束第 n 条，
> `D{n}` = 决策日志第 n 条）。需要证据与推导过程时回到原文。
> 二者冲突时以 `AGENTS.md` 为准；本文件与 AGENTS.md 冲突时以 AGENTS.md 为准。

---

## 1. 技术栈与依赖

| 约束 | 出处 |
|---|---|
| **零原生依赖**：禁 better-sqlite3 / sqlite-vec / Prisma / 任何需 electron-rebuild 的包。数据层只用 `node:sqlite` + zod + 手写迁移 | A1 |
| **版本锁定**：electron **43.4.1**、electron-vite 5.0.0、vite **7.3.6（不可用 8）**、react 19.2.8、typescript **5.9.3**、express 5.2.1、zod 4.4.3、openai SDK 7.4.0、react-query 5.101.4、react-router-dom ^7.9.0、electron-builder 26.15.3 | A2 |
| 禁用 `@langchain/*`（DeepSeek 场景是负资产：reasoning_content 丢失 bug 未修，langchainjs #10883）；改用 openai SDK 直连 | A2, D1 |
| 禁用 `epub-gen`（2019 死包）；用 `epub-gen-memory` 1.1.2 | A2, D1 |
| zustand 已移除（D98 审查发现为 0 import 死依赖）。状态管理 = react-query（server state）+ 组件本地 state；**再引入全局 store 前须先补决策记录** | A2 |
| **pnpm 专用**，禁 npm/yarn | A3 |
| Electron 补丁需及时跟进——43.4.1 起含"沙箱顶层 frame 打开的窗口未继承沙箱限制"等修复，滞后会削弱既有安全模型 | v0.25.0 新增 |

## 2. 数据与持久化

| 约束 | 出处 |
|---|---|
| 数据存放 `%APPDATA%\ai-novel-studio`（便携版跟随可执行文件 `data/`） | README |
| SQLite 开 WAL、`enableForeignKeyConstraints`、**显式设置 `timeout`**（busy_timeout 默认为 0） | A18 |
| `node:sqlite` 只用核心路径：`prepare` + `get/all/iterate/run` + `exec('BEGIN/COMMIT/ROLLBACK')`。**禁用** SQLTagStore、自定义函数、Session/applyChangeset、loadExtension（segfault 级 open bug：nodejs/node #65149/#65102/#64795） | A18, D1 |
| 数据层封装 DAO 薄接口，隔离 `DatabaseSync` 细节 | A18 |
| 迁移必须事务化 + 幂等（`_migrations` 版本表；`ALTER TABLE` 重复列容错） | 实现见 `db/migrate.ts` |
| **升级既有库（schemaVersion > 0）前自动快照**到 `backups/pre-migrate-v{FROM}-to-v{TO}-{时间戳}.db`，轮转保留 3 份；全新库不快照 | v0.25.0 新增（审查 M2） |
| 备份前必须先 `PRAGMA wal_checkpoint(TRUNCATE)`，否则复制到陈旧主库 | A/D43b |
| 查询 job 表按 novelId **必须**用 `json_extract(payload_json,'$.novelId') = ?`，禁止 `LIKE '%"novelId":N%'`（12 vs 123 误伤） | A26, D21 |
| 新增表必须有读写路径；新增 `model_route` task_type 必须被消费或标 `reserved: true`（禁空壳 schema） | A30 |

## 3. 安全边界

| 约束 | 出处 |
|---|---|
| API Key 必须经 Electron `safeStorage` 加密后入库，**禁明文、禁打日志**；不可用时 **fail-closed 拒绝落库**（不降级为明文） | A6, 实现见 `keyCrypto.ts` |
| 本地 Express 只监听 `127.0.0.1` + 随机端口（`port: 0`），dev 模式除外（`AI_NOVEL_PORT=3000`） | A19, D4 |
| 所有请求经 `services/security.ts` 的 `originGuard`：Origin 白名单（file:// null + localhost/127.0.0.1 任意端口 + dev 5173） | A19, D20 |
| **配置了 `SERVER_TOKEN` 时对所有请求强制 `X-App-Token`**（不只 null Origin）。预检 `OPTIONS` 必须放行。独立调试可用 `AI_NOVEL_TOKEN_OPTIONAL=1` 关闭 | v0.25.0 新增（审查 M3） |
| 未配置 token 时，`Origin: null` 一律 403（file:// 与恶意沙箱 iframe 无法区分 → fail-closed） | 审查 M1 |
| 破坏性 IPC（`wipe-data`/`restore-backup`/`export-backup`/`theme-set`/updater 三操作/`get-server-token`）限定**主窗口顶层 frame**（`assertTrustedSender`） | 审查 M19 / v0.25.0 新增 L4 |
| Electron 窗口：`contextIsolation: true` + `nodeIntegration: false` + `sandbox: true`；`will-navigate` 阻断外站；`setWindowOpenHandler` 只放行 http(s)；`index.html` 配 CSP（含 `object-src 'none'`/`base-uri 'self'`） | 实现见 `electron/main.ts` |
| 退出钩子必须 `server.close` + kill utilityProcess，禁留 Windows 孤儿进程 | A19 |

## 4. 长链路执行与幂等

| 约束 | 出处 |
|---|---|
| 执行面/控制面隔离：导演、整本生产等重型链路只经 `job` 表 + `scheduler` 执行；**API 路由不得新增直接跑重型链路的入口** | A8, A23, D16 |
| 入队统一走 `services/jobQueue.ts`（`enqueueDirectorJob` 等，原子查重 `INSERT ... SELECT ... WHERE NOT EXISTS`），禁止直调 `runDirectorPipeline` | A25 |
| 重启幂等：scheduler 启动重置遗留 running→queued；阶段幂等以"**产物落库判定**"为准，不以状态字段 | A9, A23, D16 |
| 支持取消感知：`cancelled` 状态 / watchdog 超时 / `AbortSignal` 三层，在阶段与章节边界自检退出 | A9 |
| 循环熔断：重规划/修复必须有次数上限 + 决策路径去重 | A11 |
| 章节生成并发守卫：`UPDATE chapter SET status='generating' WHERE id=? AND status NOT IN ('generating')` 原子抢占 | A27, D21 |
| 修复策略 patch_first：先 `applyPatches`（target 逐字唯一匹配），失败降级整章重写 | A25 |

## 5. LLM 调用纪律

| 约束 | 出处 |
|---|---|
| DeepSeek：`reasoning_effort` 只有 low/high/max；**thinking 开时 temperature/top_p/penalty 全部无效** | A4 |
| **V4 默认 thinking 开**——非 thinking 路由必须显式传 `thinking:{type:'disabled'}`，否则温度无效且可能返回空 content | A4, D12 |
| `thinking` 参数走 `extra_body`；**thinking 模式禁止强制 `tool_choice`**（会 400） | A4 |
| 工具调用时 assistant 消息的 `reasoning_content` 必须原样回传，否则 400 | A4, D15 |
| 所有要求 JSON 输出的任务统一走 **extraction 路由**（thinking off + jsonMode），禁 thinking 路由跑 JSON | A21, D9 |
| 大 JSON 必须拆步（世界观 3 步、角色 2 批） | A21 |
| JSON 鲁棒性：解析失败自动重试（限次）+ `max_tokens` 截断检测（`finish_reason === 'length'`）+ 拆步；禁止"AI 输出不完整 JSON 导致流程永久卡住" | A10 |
| 前缀冻结：上下文组装固定序 = 冻结区（系统提示→书级合约→世界观→角色账本）+ 可变区（任务单→前文摘要→RAG）；冻结区变更必须 hash 版本化 | A5 |
| model_route 必须支持 fallback 链；`usage_log` 记录 `degraded` 标记 | A15 |
| 重试策略：SDK `maxRetries: 1`，主重试由候选链负责（避免 3×3=9 次）；429 读 `Retry-After`（上限 30s） | 实现见 `services/llm.ts` |
| 导演/规划类 prompt 与解析统一放 `services/planner.ts`，禁止在 routes 里重复内联 | A31, D22 |
| 测试 Key 优先用 OpenCode Go 网关 key（官方直连质量略优，网关作多模型扩展） | A 必读, D7/D8 |

## 6. API 与错误语义

| 约束 | 出处 |
|---|---|
| 所有 REST 返回统一 **camelCase**，与 `shared/types` 对齐，禁 snake_case 直出；新增路由须核对客户端类型 | A20, D5 |
| 错误码语义化：`ZodError`→400，SQLite 约束（FOREIGN KEY/UNIQUE/NOT NULL）→409，其余 500；**禁全 500** | A28, D22 |
| 错误中间件不得回传内部细节（SQLite 约束原文、绝对路径、TypeError 原文） | 实现见 `services/apiError.ts` |
| 章节列表接口**禁止携带 content**；正文只经独立详情端点按需加载 | A33, D24 |
| 快速切章必须用序号 / `AbortController` 丢弃过期响应；SSE 取消兜底必须携带流内累积内容 | A33 |

## 7. 前端交互规范

| 约束 | 出处 |
|---|---|
| 所有异步操作必须 per-action busy 锁 + `disabled`（入口先检查 busy），以 `withBusy`/`actionBusyRef` 为范本 | A34 |
| 空内容保存保护：服务端已有正文时，禁以空内容覆盖或置 `written`；正文加载完成前禁用保存；`saveContent` 失败必须上抛 | A32, D24 |
| 关闭/刷新前未保存内容提示；生成/正文加载中挂起自动保存（避免与流式竞态） | 实现见 `ChapterExecutionPage` |
| 流式渲染必须做 rAF 批合并，禁止每个 delta 都 `setState` | 实现见 `ChapterExecutionPage` |
| IPC 竞态：主进程 → renderer 单向 `send` 在监听未注册时**静默丢失**，必须"主动拉取 + 缓存补发"双保险 + 轮询兜底 | A37, D28 |
| 代码规范：不写无关注释；文件命名与现有结构一致；新组件先看同类已有组件 | A16 |
| **单文件规模硬约束**：组件文件超过 **400 行**或 **12 个 `useState`** 时，必须先拆分再继续加功能 | v0.25.0 新增（审查 S1） |
| 页面必须包 `ErrorBoundary`（`resetKey=pathname`），单页崩溃不得导致整应用白屏 | v0.25.0 新增（审查 L2） |

## 8. 测试与交付

| 约束 | 出处 |
|---|---|
| 关键纯逻辑（applyPatches / isStageDone / 上下文组装 / 前缀冻结 hash）必须配 vitest；改动对应模块必须跑 `pnpm vitest run` | A29, D19 |
| **组件测试**：`tests/*.test.tsx`，首行 `// @vitest-environment jsdom`；新增/改动面板组件时须补 | v0.25.0 新增（审查 M1） |
| 每阶段结束必须跑 `pnpm typecheck` + `pnpm lint` | A 必读 |
| 发布闭环：UI/导航/交互修复交付时必须重新 `pnpm dist` 并验证安装包；**禁止"代码已修但未打包"交付** | A35, D26 |
| 三平台产物：`dist:win` / `dist:mac` / `dist:linux`（CI 矩阵 `windows-latest` / `macos-latest` / `ubuntu-latest`，`fail-fast: false`） | v0.25.0 新增（审查 L5） |

## 9. 文档与协作

| 约束 | 出处 |
|---|---|
| 调研-更新闭环：遇到技术阻碍或不确定的 API/参数，**必须先查官方文档核实（禁凭记忆写）**，结论回写 `docs/decision-log.md` 后再继续 | A17 |
| **PowerShell 编码陷阱**：禁用 PowerShell 任何文本写入 cmdlet（`Set-Content`/`Add-Content`/`Out-File`/here-string）写含中文的文档与源码（D90 曾产生 0x07 控制符损坏）；一律用 Write/Edit 工具或 node 脚本（显式 UTF-8） | A22, D10, D90 |
| 新 agent 进场先读 `docs/AI-AGENT-ONBOARDING.md`，再读 `PLAN.md`（历史在 `docs/archive/PLAN-history.md`） | A 必读 |
| 产品决策已锁定（不可再问用户）：Electron 桌面应用 / 多供应商+任务路由 / 整书直塞优先（1M 窗口，RAG 兜底）/ thinking 三层可调 | A7 |

---

## 相关文档

| 文件 | 定位 |
|---|---|
| `AGENTS.md` | 硬约束全文（权威） |
| `docs/decision-log.md` | 决策编年史（D 系列，含证据与推导） |
| `docs/CHANGELOG.md` | 版本变更（Keep a Changelog） |
| `docs/architecture.md` | 架构与分层 |
| `docs/AI-AGENT-ONBOARDING.md` | AI 协作者手册 |
| `docs/audit-report.md` | 历次审查追踪 |
| `docs/archive/PLAN-history.md` | 阶段编年史归档 |
