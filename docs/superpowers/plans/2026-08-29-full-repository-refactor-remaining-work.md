# 全仓库兼容重构剩余工作实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 从当前 `main` 基线继续完成全仓深度审查与兼容重构，使章节生成、任务调度、导演、整本生产、服务端路由、上下文、LLM、客户端和 Electron 均形成清晰且可验证的职责边界。

**Architecture:** 外部 REST、SQLite 数据和用户流程保持兼容；内部按 `chapterGeneration`、`jobs`、`director`、`production` 四个核心域渐进迁移。每批先补契约测试，再接入兼容入口，最后删除旧实现；文档与代码同批更新，不保留长期双轨。

**Tech Stack:** Electron 43.3.0、electron-vite 5.0.0、Vite 7.3.6、React 19.2.8、TypeScript 5.9.3、Express 5.2.1、Node 24 `node:sqlite`、Zod 4.4.3、OpenAI SDK 7.4.0、Vitest、pnpm。

**Spec:** `docs/superpowers/specs/2026-08-24-full-repository-deep-refactor-design.md`

## 0. 当前事实基线

### 0.1 主线状态

- 工作基线：`main` / `origin/main`，本计划对齐提交 `335089a`。
- 产品版本：`v0.24.4`，发布台账已完成翻转。
- 测试基线：远端在 200/200 基线上新增客户端组件、错误边界和安全加固测试；执行 R0 时必须在最新 lockfile 安装完成后重新记录实际文件/测试数。
- 主线已包含审核基线校准、统计面板、伏笔账本、快捷词、本地校对、DOCX 导出、拖拽导入、系统主题、网文要素工坊和演示书。
- 主线还已完成 ChapterExecutionPage 第一轮组件拆分、前端组件测试地基、页面级错误边界、字体异步加载、全请求 X-App-Token、IPC sender 校验、升级前数据库快照，以及 Windows/macOS/Linux 构建目标。
- 主线尚无 `server/src/services/chapterGeneration/`，章节生成仍集中在 `server/src/services/generate.ts`。

### 0.2 隔离分支资产

隔离 worktree 分支 `codex/core-writing-pipeline` 已完成一版章节生成域实现和测试，但它从较早主线分叉，缺少 `b63ca2e` 至 `335089a` 之间的审核、功能、依赖、安全、跨平台、客户端拆分和文档变更。

可复用的行为证据：

- `769f309`：章节抢占与失败恢复。
- `22b243d`：正文、版本、字数与状态事务。
- `6d73396`：后处理拆分。
- `b2eb562`、`b7c9ab8`：编排器和兼容入口接线。
- `5ee220a`：截断内容禁止进入后处理。
- `tests/chapter-generation.test.ts`：状态、事务、空正文、中止、回滚和截断契约。

这些提交只能作为实现参考，不能整段合并：其中版本台账、README、PLAN、依赖和发布记录已落后。正确做法是在最新 `main` 新建隔离 worktree，按测试与行为逐片重放代码，并重新解决当前主线的审核策略、导出和功能批集成。

### 0.3 本计划不包含

- `PLAN.md` 中 A1、B1-B3、B5-B7、C1-C6 等产品功能 backlog。
- pro 模型上线后的校准切换。
- 真实书 #25 的生产执行和真实用户数据库修改。
- 锁定依赖升级、发布、tag 或 GitHub Release；这些仍需单独授权。

## 1. 全局约束

- 只使用 `node:sqlite` 核心 API；不引入 ORM、原生依赖、LangChain 或 Zustand。
- REST 路径、请求体和返回字段保持兼容，返回字段继续统一 camelCase。
- API 路由只做校验、服务调用和响应映射；重型链路只经 job 表和 scheduler。
- 章节正文、版本快照、字数、AI/人工字数和最终状态必须在短事务中一致写入。
- 所有长任务以产物落库判定幂等；kill 后恢复不得重复生成、重复记账或覆盖新一轮状态。
- JSON 任务继续走 extraction 路由，保留截断检测、限次重试和大任务拆步。
- 新增或修改系统提示词必须走 `prompt_asset`；不得新增系统提示词常量。
- 所有异步客户端入口保留 per-action busy 锁；正文仍通过详情端点按需加载。
- 每批代码变更执行 `pnpm typecheck`、`pnpm lint`、`pnpm vitest run`、`pnpm build`、`pnpm dist`；数据层变更增加 `pnpm db:smoke`。
- 每批文档变更执行 `node scripts/check-docs.mjs`、`node scripts/verify-docs.mjs` 和 `git diff --check`。
- 涉及 Node、Electron、SQLite、Express、OpenAI SDK 或供应商行为时，先查官方文档并写入 `docs/decision-log.md`。
- 每个任务一个逻辑提交；未通过门禁不提交、不推送。

## 2. 执行顺序与依赖

| 批次 | 主题 | 依赖 | 可独立交付 |
|---|---|---|---|
| R0 | 基线与分支整理 | 无 | 是 |
| R1 | 章节生成域重放 | R0 | 是 |
| R2 | Job repository 与 claim identity | R1 | 是 |
| R3 | Scheduler 生命周期与执行器 | R2 | 是 |
| R4 | 导演与整本生产域 | R1-R3 | 是 |
| R5 | 服务端路由和共享错误模型 | R4 | 是 |
| R6 | Context、LLM、DAO 边界 | R5 | 是 |
| R7 | 客户端热点拆分 | R5-R6 | 是 |
| R8 | Electron、安全与发布链拆分 | R7 | 是 |
| R9 | 文档架构、兼容层删除与全仓验收 | R1-R8 | 是 |

任何批次发现 P0/P1 回归时停止进入下一批，先在本批修复并重新跑完整门禁。R1-R4 是核心写书链，优先级高于 R5-R9。

---

## R0：建立最新主线的可执行基线

**Files:**

- Create: `docs/superpowers/audits/2026-08-29-refactor-baseline.md`
- Modify: `docs/audit-report.md`
- Inspect: `server/src/services/generate.ts`, `scheduler.ts`, `director.ts`, `production.ts`
- Inspect: `server/src/routes/chapters.ts`
- Inspect: `client/src/pages/ChapterExecutionPage.tsx`, `electron/main.ts`

**Produces:** 最新主线的职责清单、公共导出清单、REST/数据库兼容清单和每批测试映射。

- [ ] 从最新 `main` 创建新的 `codex/` 隔离 worktree，不复用旧 worktree 作为执行基线。
- [ ] 记录 `git rev-parse HEAD`、`package.json` 版本、`pnpm vitest run` 文件/测试数、`db:smoke` 结果和现有 warning。
- [ ] 列出旧核心文件的全部公共导出和调用者；使用 `git grep` 搜索，不凭文件名推断。
- [ ] 记录 REST 路径、camelCase 返回字段、job type、chapter/job 状态值和现有迁移版本。
- [ ] 将旧分支 6 个章节生成代码提交逐个与当前主线比较，只提取行为差异，不导入旧发布文档。
- [ ] 在 `audit-report.md` 为发现建立 P0-P3 条目，至少包含触发条件、证据、测试和所属批次。
- [ ] 运行文档检查并提交 `docs: establish current refactor baseline`。

**Acceptance:** 基线文档能让未读历史的协作者准确回答“哪些行为不能变、哪些提交只能参考、每个旧入口由谁调用”。

## R1：在最新主线重放章节生成域

**Files:**

- Create: `server/src/services/chapterGeneration/types.ts`
- Create: `server/src/services/chapterGeneration/state.ts`
- Create: `server/src/services/chapterGeneration/persistence.ts`
- Create: `server/src/services/chapterGeneration/postProcess.ts`
- Create: `server/src/services/chapterGeneration/orchestrator.ts`
- Modify: `server/src/services/generate.ts`
- Test: `tests/chapter-generation.test.ts`
- Regression: `tests/config-circuit.test.ts`, `tests/truncation.test.ts`, `tests/sse-abort.test.ts`, `tests/review-policy.test.ts`

**Interfaces:**

- `generate.ts` 保留现有 `generateChapter`、`GenerateOptions`、`GenerateResult` 公共签名。
- `state.ts` 是抢占和失败恢复唯一入口。
- `persistence.ts` 是正文和版本最终落库唯一入口。
- `postProcess.ts` 不直接写 `chapter` 或 `chapter_version`。
- `orchestrator.ts` 只协调上下文、LLM、截断检测、后处理和持久化。

- [ ] 先移植状态和持久化契约测试，确认当前主线失败原因是新模块不存在。
- [ ] 实现原子抢占；`ConfigError` 恢复抢占前状态，普通错误置 `failed`。
- [ ] 实现短事务持久化；空正文不创建版本，中止正文保存为 `AI 生成（中止）`。
- [ ] 保证事务更新 `changes=0` 时回滚，禁止生成版本而正文未更新。
- [ ] 移植主角名替换、约束登记和反 AI 重写；短重写或重写失败保留原文并记录 `degradedReasons`。
- [ ] 将截断检查放在任何后处理副作用之前。
- [ ] 将 `generate.ts` 缩为兼容导出，删除其旧的重复持久化与状态逻辑。
- [ ] 重新接入当前主线的 `reviewPolicy`、AI/人工字数和 usage 行为，确认功能批没有被旧实现覆盖。
- [ ] 运行 focused tests、完整门禁和打包；更新 architecture、decision log、PLAN、CHANGELOG 与 onboarding。
- [ ] 提交按状态、持久化、后处理、编排、文档拆成 4-5 个可回退逻辑单元。

**Acceptance:** 最终 `chapter.content` 与最新 `chapter_version.content` 一致；截断不会产生后处理副作用；ConfigError、普通失败、空正文、中止和事务回滚均有绿色测试。

## R2：Job repository、payload 和 claim identity

**Files:**

- Create: `server/src/services/jobs/types.ts`
- Create: `server/src/services/jobs/payload.ts`
- Create: `server/src/services/jobs/repository.ts`
- Create: `server/src/services/jobs/lifecycle.ts`
- Modify: `server/src/services/jobQueue.ts`
- Modify: `server/src/db/migrate.ts`
- Test: `tests/job-repository.test.ts`, `tests/job-payload.test.ts`, `tests/job-lifecycle.test.ts`

**Interfaces:**

- `JobType` 明确列出 `director | production | debt-fix | refine-range | solution-chapter`。
- `parseJobPayload(type, raw)` 通过 Zod 返回对应判别联合；损坏 payload 形成语义化失败，不抛出未处理 rejection。
- `claimNextJob()` 返回 `{ job, claimToken }`；token 每次 claim 唯一。
- `updateClaimedJob()`、`finishClaimedJob()`、`failClaimedJob()` 必须同时匹配 `id + claim_token + status='running'`。
- `jobQueue.ts` 保持既有入队函数签名，内部转发 repository。

- [ ] 先为 queued 原子抢占、payload 损坏、JSON novelId 精确查重和状态转换写失败测试。
- [ ] 增加向前兼容迁移 `job.claim_token TEXT`，旧数据默认为 NULL；迁移可重复执行。
- [ ] 实现 repository camelCase 映射，禁止在上层散布 snake_case row 类型。
- [ ] 实现合法生命周期 `queued → running → done|failed|cancelled` 与 `queued → cancelled`。
- [ ] 验证旧 token 的 update 返回 `changes=0`，不能修改新 claim。
- [ ] 将 retry 保留的 `modelOverride` 纳入强类型 payload，并验证其优先级语义未丢失。
- [ ] 运行 job focused tests、现有 `p19`/`job-migration`/`scheduler-payload` 测试、db-smoke 和完整门禁。
- [ ] 更新数据模型和迁移文档，提交 `refactor: isolate job repository and lifecycle`。

**Acceptance:** job 表的所有运行态写入都可由 claim identity 拒绝迟到协程；损坏 payload 只失败该任务，不影响 scheduler 进程。

## R3：Scheduler 生命周期、watchdog 与执行器映射

**Files:**

- Create: `server/src/services/jobs/executors.ts`
- Create: `server/src/services/jobs/progress.ts`
- Create: `server/src/services/jobs/scheduler.ts`
- Modify: `server/src/services/scheduler.ts`
- Modify: `server/src/services/jobQueue.ts`
- Test: `tests/scheduler-lifecycle.test.ts`, `tests/scheduler-recovery.test.ts`
- Regression: `tests/job-migration.test.ts`, `tests/scheduler-payload.test.ts`, `tests/v0170.test.ts`

**Interfaces:**

- `JobExecutor<TPayload>` 接收 `{ db, claim, payload, isAborted, reportProgress }`。
- 执行器注册表显式映射全部 job type；未知类型立即标记失败。
- scheduler 只负责轮询、claim、watchdog、执行器调用和运行锁。
- 旧 `services/scheduler.ts` 保留 `startScheduler`、`stopScheduler`、`isSchedulerBusy` 兼容导出。

- [ ] 将 director、production、debt-fix、refine-range、solution-chapter 分支迁入执行器映射。
- [ ] 将 trace 去重、上限 300 和 progress 百分比移入 `progress.ts`。
- [ ] watchdog 只按当前 claim token 回收；旧协程随后报告进度、失败或完成均被拒绝。
- [ ] 启动恢复将遗留 running job 置 queued 并清空旧 claim token。
- [ ] `stopScheduler` 清除 timer，并使当前执行器在下一安全边界观察中止；不得产生新的 claim。
- [ ] 覆盖取消不被 done 覆盖、全部章节失败不能虚报 done、未知 type、异常逃逸兜底和 model override 清理。
- [ ] 故障注入：claim A 运行中被 watchdog 回收，claim B 重新执行，A 迟到失败不能覆盖 B。
- [ ] 运行完整门禁和打包，提交 `refactor: make scheduler execution token scoped`。

**Acceptance:** scheduler 文件不再包含五类任务的业务循环；重启、watchdog、取消和迟到协程测试全部通过。

## R4：章节 generation token、导演域和整本生产域

### R4.1 章节 generation token

**Files:** `chapterGeneration/types.ts`, `state.ts`, `persistence.ts`, `orchestrator.ts`, `db/migrate.ts`, `tests/chapter-generation.test.ts`。

- [ ] 增加 `chapter.generation_token TEXT` 向前兼容迁移。
- [ ] `claimChapter` 生成章节级 token；它与 job claim token 分离，生命周期不同。
- [ ] 完成、失败和空正文更新都匹配 `id + novel_id + generation_token + status='generating'`。
- [ ] 新一轮抢占后，旧生成协程的失败处理和持久化必须返回 stale claim 错误且不改数据。

### R4.2 导演域

**Files:**

- Create: `server/src/services/director/stages.ts`, `checkpoint.ts`, `artifacts.ts`, `pipeline.ts`
- Create: `server/src/services/director/executors/*.ts`
- Modify: `server/src/services/director.ts`, `planner.ts`
- Test: `tests/director-artifacts.test.ts`, `tests/director-recovery.test.ts`

- [ ] 将阶段顺序和元数据集中到 `stages.ts`，禁止字符串阶段在多处复制。
- [ ] `artifacts.ts` 按实际 world/character/volume/chapter 产物判断完成，不单信 checkpoint 状态。
- [ ] checkpoint 只保存当前位置、用户决策、熔断计数和展示状态。
- [ ] 每个阶段执行器只生成一种产物；prompt 和解析仍统一复用 planner。
- [ ] 保留 ready 收尾位于 done 判定之前、决策路径去重和循环次数上限。
- [ ] 故障注入：阶段产物落库后 kill、checkpoint 未更新；恢复时跳过已完成模型调用。

### R4.3 整本生产域

**Files:**

- Create: `server/src/services/production/chapterPolicy.ts`, `progress.ts`, `pipeline.ts`
- Modify: `server/src/services/production.ts`, `solutionRunner.ts`
- Test: `tests/production-policy.test.ts`, `tests/production-idempotency.test.ts`

- [ ] `chapterPolicy` 统一决定跳过已有产物、普通失败继续、ConfigError 整批熔断和取消边界。
- [ ] production 只调用统一 `generateChapter`，不重复解释章节抢占或持久化。
- [ ] 方案整本生产继续透传 `modelOverride`、solutionId 和中止检查。
- [ ] kill 后恢复以正文和版本产物判定跳过；不得因旧 status 再次调用模型。
- [ ] 全部失败时 job failed；部分失败时结果包含 done/failed/degraded 统计。

**Acceptance:** 导演和生产顶层兼容文件仅保留公共导出；故障注入能证明产物驱动幂等和旧协程隔离。

## R5：服务端路由与统一错误模型

**Files:**

- Create: `server/src/services/shared/errors.ts`
- Split: `server/src/routes/chapters.ts`
- Review/Split: `routes/novels.ts`, `volumes.ts`, `solutions.ts`, `settings.ts`, `automation.ts`
- Modify: `server/src/services/apiError.ts`
- Test: `tests/api-contracts.test.ts`, `tests/error-mapping.test.ts`

- [ ] 定义 `ConfigurationError`、`CancellationError`、`TransientProviderError`、`OutputValidationError`、`PersistenceError`、`InvariantError`；现有 `ConfigError` 保持兼容映射。
- [ ] 将 chapters 路由拆为 CRUD/详情、生成、审核修复回灌、版本、搜索/上下文、AI 编辑模块，并由原 router 聚合。
- [ ] 路由中移除业务 SQL 和长链路循环；数据库访问迁入对应服务或 repository。
- [ ] 保持所有路径、HTTP 方法、状态码和 camelCase 响应；用 contract tests 锁定。
- [ ] 复核 ZodError→400、SQLite 约束→409、其余→500，取消语义不伪装成 500。
- [ ] 对 novels/volumes/solutions/settings/automation 使用同一审查标准，只拆职责过载部分，不为目录整齐搬动稳定代码。
- [ ] 完整 API 回归、E2E 无真实 key 的确定性部分、构建和打包通过。

**Acceptance:** 路由只含输入校验、服务调用和响应映射；旧客户端无需修改即可通过合同测试。

## R6：Context、LLM 与薄 DAO

### R6.1 Context

**Files:** `services/context.ts`，新建 `services/context/frozen.ts`, `dynamic.ts`, `budget.ts`, `hash.ts`, `types.ts`。

- [ ] 用特征测试锁定冻结前缀顺序、hash、预算裁剪优先级和当前 RAG 未启用语义。
- [ ] 冻结区、可变区、预算和 hash 各自单一职责；兼容 `context.ts` 公共导出。
- [ ] 冻结区变更继续 hash 版本化；禁止改变系统提示→合约→世界→角色的顺序。

### R6.2 LLM

**Files:** `services/llm.ts`，新建 `services/llm/routes.ts`, `candidates.ts`, `request.ts`, `usage.ts`, `errors.ts`, `types.ts`。

- [ ] 锁定 thinking、JSON mode、tool choice、reasoning_content 回传和 fallback 候选顺序。
- [ ] `modelOverride` 优先于 fallback；V4 非 thinking 显式发送 `thinking:{type:'disabled'}`。
- [ ] 供应商调用、usage 提取和错误映射分离；API key 永不出现在 error、trace 或日志。
- [ ] 现有 `llm.ts` 仅保留兼容导出，调用者逐一迁移。

### R6.3 DAO

- [ ] 只为同一 SQL 在两个以上流程重复、或事务边界需要集中保护的实体建立薄 repository。
- [ ] 优先收拢 chapter、job、director checkpoint、usage 和 prompt asset；不建立通用 ORM 基类。
- [ ] 所有数据库测试使用内存库或临时目录，增加 db-smoke 覆盖新迁移。

**Acceptance:** context 和 llm 兼容入口不再包含完整实现；冻结前缀、DeepSeek 参数和 usage 语义均有契约测试。

## R7：客户端热点拆分复核与收尾

**Files:**

- Review: `client/src/pages/ChapterExecutionPage.tsx`
- Review: `client/src/pages/chapter/ChapterPanels.tsx`, `EditorArea.tsx`, `ResourcePanel.tsx`, `ReviewPanel.tsx`, `VersionHistoryPanel.tsx`, `types.ts`
- Review/Split: `StudioPage.tsx`, `NovelWorkspacePage.tsx`, `client/src/api.ts`
- Create: `client/src/pages/chapter/hooks/*`, `components/*`, `state/*`（仅 reducer/types，不引入全局 store）
- Test: `tests/client-chapter-state.test.ts`, 组件测试或 Playwright smoke

- [ ] 先审查 `2eb6c73` 的拆分结果并绘制剩余状态来源：server state、正文加载、编辑会话、生成流、审核修复、版本、布局；不重复拆已经独立的展示组件。
- [ ] 抽取 `useChapterLoader`，保留 AbortController/序号丢弃过期响应和正文详情端点。
- [ ] 抽取 `useGenerationController`，保留 SSE 累积内容、中止兜底和 generateBusyRef。
- [ ] 抽取 `useEditorSession`，保留空内容保护、saveContent 上抛和切章失败中断。
- [ ] 复核已拆出的审核修复、版本、资源和布局组件 props；只继续拆仍然承担异步编排或跨域状态的部分。
- [ ] 所有异步操作继续通过 per-action busy 锁；不新增 Zustand 或隐式全局状态。
- [ ] 对 Studio、Workspace、api.ts 只处理重复请求编排和超大职责，保留 react-query server state。
- [ ] 运行快速切章、生成中止、保存失败、版本恢复、快捷词和本地校对 UI smoke。

**Acceptance:** 在现有第一轮拆分基础上，ChapterExecutionPage 只负责编排页面布局；`chapter-panels.test.tsx`、快速切章和生成中止回归测试通过；用户操作路径不变。

## R8：Electron 模块拆分、安全复核与跨平台发布收尾

**Files:**

- Split: `electron/main.ts`
- Create: `electron/window.ts`, `serverProcess.ts`, `ipc.ts`, `updater.ts`, `theme.ts`, `shutdown.ts`
- Test: `tests/electron-security-contract.test.ts`, `scripts/v072-pack-verify.mjs`

- [ ] 抽取窗口与 titleBarOverlay；主题继续经 nativeTheme + IPC 同步。
- [ ] 抽取 utilityProcess 生命周期；启动、ready 缓存、主动拉取、异常退出和 shutdown 单一实现。
- [ ] 抽取 IPC 注册并集中 trusted sender 校验；破坏性操作不得绕过确认和 sender 验证。
- [ ] 抽取 updater，保持静态导入、便携版限制和 latest.yml/产物命名约定。
- [ ] 复核 `f404bdb` 已完成的全请求 X-App-Token 与 IPC sender 校验，补齐 safeStorage 密钥边界、null-origin token、CSP、随机端口和 Windows 孤儿进程处理的合同测试。
- [ ] 复核 `52fca79` 的升级前数据库快照和失败回退，确认不触碰用户运行中数据库。
- [ ] 复核 `00dcbc1` 的 Windows/macOS/Linux 构建矩阵；Windows 仍需生成 NSIS + portable，macOS/Linux 产物按各自 runner 验证。
- [ ] 打包后运行 server 入口、资源、db 路径、SSE、导出、鉴权和更新元数据等价验收。

**Acceptance:** `electron/main.ts` 只负责装配；安装版和便携版均生成，打包态验收通过，用户数据目录约定不变。

## R9：文档架构、兼容层删除与最终验收

### R9.1 文档架构

**Files:**

- Modify: `docs/README.md`, `architecture.md`, `AI-AGENT-ONBOARDING.md`, `decision-log.md`, `versioning.md`, `audit-report.md`, `PLAN.md`
- Create: `docs/user/*`, `docs/development/*`, `docs/operations/*`, `docs/reference/*`（按 spec §6 实际需要创建）
- Modify: `scripts/check-docs.mjs`, `scripts/verify-docs.mjs`

- [ ] 权威治理入口保持原路径，不移动 onboarding、architecture、decision-log、versioning、CHANGELOG、test-report、audit-report、competitive-analysis。
- [ ] 用户文档按首启、写作、模型、备份、排障、导出/更新拆分；开发文档按仓库、测试、数据、API、错误模型拆分。
- [ ] 将易漂移数字改为“以命令输出为准”；版本只以 package.json 为事实源。
- [ ] 为旧决策和校准报告建立索引/归档，保留兼容链接后再迁移引用。
- [ ] 增强检查：Markdown 锚点、旧路径/模块、架构路径存在、中英文 README 关键能力、PLAN/onboarding 当前状态。
- [ ] `docs/archive/` 只豁免明确标注的历史乱码，不整体豁免断链。

### R9.2 兼容层删除

- [ ] 用 `git grep` 确认所有调用者已迁移后，删除旧业务实现；公共兼容导出仅在外部测试或稳定 API 仍依赖时保留。
- [ ] 删除死代码、重复 SQL、重复状态转换和旧模块名；不删除历史迁移。
- [ ] 增加轻量架构守护测试：routes 不导入重型 pipeline，生产不直接写章节正文，postProcess 不写 chapter，scheduler 不内联业务执行器。

### R9.3 最终全仓验收

- [ ] `pnpm typecheck`
- [ ] `pnpm lint`
- [ ] `pnpm vitest run`
- [ ] `pnpm db:smoke`
- [ ] `pnpm build`
- [ ] `pnpm dist`
- [ ] `node scripts/check-docs.mjs`
- [ ] `node scripts/verify-docs.mjs`
- [ ] `node scripts/e2e/round.mjs <n>` 至少一轮 T1-T5；优先 OpenCode Go 网关 key。
- [ ] 在临时用户目录执行 kill/restart：导演、整本生产、章节生成均不重复产物或 token 记账。
- [ ] 安装版与便携版时间戳、文件名、latest.yml 和 blockmap 一致。
- [ ] 全部分批做最终代码审查；P0/P1 清零，P2/P3 修复或在 audit-report 记录保留理由。

**Acceptance:** spec §10 八项完成标准全部满足；文档描述与当前代码路径一致；不存在未说明的兼容双轨。

## 3. 每批交付模板

每批最终报告必须包含：

1. 基线提交与结束提交。
2. 发现及严重度，附文件/测试证据。
3. 新旧职责映射和兼容入口。
4. 数据库迁移及回退策略。
5. focused tests 和完整门禁原始结论。
6. 安装包文件名、时间戳和打包态验证。
7. 同批更新的 architecture、decision log、PLAN、CHANGELOG、onboarding。
8. 尚存风险、下一批依赖和禁止提前处理的事项。

## 4. 暂停与回退条件

- REST 合同或已有数据需要破坏性迁移：停止该批，形成单独设计与用户确认。
- 真实用户数据库成为唯一复现条件：停止写操作，只做只读诊断并改用匿名备份或最小复现。
- 依赖官方行为不确定：先查官方文档并落 D 系列决策，未查证不继续实现。
- focused test 通过但完整门禁出现无关工作区改动：不覆盖他人改动，先定位来源并分离提交。
- 打包失败或两个 Windows 产物未更新：该批未完成，不得宣称交付。
- kill/restart 重复调用模型、重复版本或重复 usage：按 P0/P1 阻断后续批次。

## 5. 完成定义

- [ ] R0-R9 均有独立提交、审查记录和绿色门禁。
- [ ] 章节状态、job 生命周期、正文落库、错误分类均只有一个事实源。
- [ ] 旧大型文件只保留装配/兼容职责，或有量化保留理由。
- [ ] REST、SQLite 和用户流程兼容，旧数据无需手工修复。
- [ ] kill 后恢复不重复生成、版本、记账或覆盖新 claim。
- [ ] 全仓 P0/P1 关闭，P2/P3 有明确处理结果。
- [ ] 文档信息架构、索引和自动检查与代码同步。
- [ ] 最终 E2E、打包态和安装包验证通过。

