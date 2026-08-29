# 重构基线（R0 产物，2026-08-29）

> 对应计划：`docs/superpowers/plans/2026-08-29-full-repository-refactor-remaining-work.md`（R0）
> 目标读者：未读历史的协作者——回答三件事：哪些行为不能变、哪些提交只能参考、每个旧入口由谁调用。
> 分支：`codex/refactor-r0-r1`（基于 main @ `3beac22`）；旧参考分支 `codex/core-writing-pipeline`（`f1cae17`）原样保留。

## 1. 基线快照

| 项 | 值 |
|---|---|
| 基线提交 | `3beac22`（= origin/main，v0.24.4，工作区干净） |
| 测试基线 | `pnpm vitest run`：45 个文件 / 257 用例全绿（本分支安装后实测） |
| db:smoke | 7 项检查通过（seed 幂等 / 23+ 表 / 事务回滚 / 外键 / busy timeout 等） |
| 现有 warning | `MODULE_TYPELESS_PACKAGE_JSON`：node 将 `server/src/db/migrate.ts` 按 ESM 重解析的性能提示（package.json 无 `"type": "module"`，既有现状，不在本计划处理） |
| `server/src/services/chapterGeneration/` | main 上存在但为空目录（8 月 25 日遗留，git 未跟踪）——R1 是真实待办 |

## 2. 兼容清单（重构不得改变的外部行为）

### 2.1 REST

- 路由文件（15 个）：`agents/analysis/assets/automation/chapters/export/genres/novels/prompts/resources/settings/solutions/style/volumes/worlds.ts`。
- 路径、HTTP 方法、状态码、返回字段统一 camelCase（AGENTS #20）保持不变；章节正文仅经 `GET /:novelId/chapters/:chapterId` 详情端点按需加载，列表不携带 content（AGENTS #33）。
- 兼容锁定方式：R5 引入 contract tests；R0/R1 阶段以"调用方零改动"为兼容证据。

### 2.2 数据

- chapter.status 客户端可设枚举：`planned | imported | written | reviewed | done | failed`（`routes/volumes.ts:362-364`）；`generating` 为内部瞬时态，仅由两处原子 claim 写入，禁止客户端手动设置（v0.17.0 M13）。
- job.type 全集：`director | production | debt-fix | refine-range | solution-chapter`（`scheduler.ts:154-264` 消费）；job 状态：`queued → running → done|failed|cancelled`。
- 迁移最新版本：**20**（`server/src/db/migrate.ts:472`）；R1 无新增迁移，R4.1 才引入 `chapter.generation_token`。
- 字数语义（v0.22.0 N1）：整章替换为覆盖语义——`ai_words = 当前内容 CJK 字数`、`human_words = 0`；累计语义仅在 PATCH 增量编辑有效。

### 2.3 章节生成公共契约（R1 重放对象）

- `generate.ts` 公共导出仅 3 个（`generate.ts:10-37`）：
  - `interface GenerateOptions { signal?; onDelta?; onThinking?; tripleReview?; include?; guidance? }`
  - `interface GenerateResult { content; wordCount; aborted; usage }`
  - `generateChapter(db, novelId, chapterId, opts?): Promise<GenerateResult>`
- 调用方（git grep 实查，全量）：

| 调用方 | 位置 | 用途 |
|---|---|---|
| `routes/chapters.ts` | :5 import, :177 调用 | 单章 SSE 生成（:165 独立发 context 事件；onDelta→delta 等） |
| `services/production.ts` | :2 import, :98/:101/:107 调用 | 整本生产；wordCount<200 重试 1 次 |
| `services/hub.ts` | :6 import, :156 调用 | hub 工具 chapter_generate（TOOL_TIMEOUT_MS 真实中断） |
| `tests/config-circuit.test.ts` | :6 import, :68 调用 | ConfigError 恢复抢占前状态契约 |

- 原子抢占 SQL（`generate.ts:44-48`，`solutionRunner.ts:303-311` 同文复制）：
  `UPDATE chapter SET status='generating', updated_at=datetime('now') WHERE id=? AND novel_id=? AND status NOT IN ('generating')`，changes=0 抛 `'章节正在生成中（或状态不允许），请等待完成'`。
- 失败复位守卫：`AND status='generating'`（generate.ts:141/239-241；chapters.ts:200-202；hub.ts:167-169；solutionRunner.ts:539）。
- 重启恢复：`scheduler.ts:331-335` 遗留 `generating` 章节重置 `planned`；scheduler 启动重置遗留 running job→queued（AGENTS #23）。
- 空内容保护：显式 guarded 置 failed、不建版本（generate.ts:139-145，v0.17.0 H2）。

## 3. 核心文件公共导出与调用者（git grep 实查）

### 3.1 `services/generate.ts`（245 行）——见 §2.3。

### 3.2 `services/scheduler.ts`（350 行）

- 导出：`JobRecord`、`startScheduler(db, intervalMs=1500):327`、`stopScheduler():343`、`isSchedulerBusy():348`。
- 调用方：`server/src/index.ts:87`（startScheduler，server 启动时）。stopScheduler/isSchedulerBusy 当前无 server 内调用者（保留兼容导出）。
- 内部职责（R3 拆分对象）：轮询 claim、五类 job 业务循环（:154-264 内联）、watchdog、进度 trace 去重、启动恢复。

### 3.3 `services/director.ts`（826 行，services/ 最大文件）

- 导出：`DirectorStage:36`、`STAGE_LABELS:49`、`STAGE_ORDER:63`、`DirectorCheckpoint:77`、`DirectorTask:90`、`loadDirectorTask:114`、`saveDirectorTask:132`、`isStageDone:149`、`runDirectorPipeline:699`、`directorProgress:824`。
- 调用方：`routes/automation.ts:4`（directorProgress）、`services/scheduler.ts:2`（runDirectorPipeline）、`services/hub.ts:5`（directorProgress）。
- 纪律：runDirectorPipeline 禁止绕过 jobQueue 直接调用（AGENTS #25）。

### 3.4 `services/production.ts`（367 行）

- 导出：`ProductionProgress:19`、`runProductionPipeline:29`。
- 调用方：`services/scheduler.ts:3`（唯一）。

### 3.5 `services/jobQueue.ts`

- 导出：`EnqueueOptions:9`、`enqueueDirectorJob:14`、`isJobCancelled:43`、`TypedJobType:50`、`enqueueTypedJob:52`、`enqueueProductionJob:73`、`isJobAborted:95`。
- 调用方：`routes/automation.ts:6`（director+production）、`routes/volumes.ts:20`（refine-range）、`routes/solutions.ts:16`（solution-chapter + production）。

## 4. 旧分支参考资产（只能逐片重放，禁止整段合并）

`codex/core-writing-pipeline`（`f1cae17`）从较早主线分叉，缺 `b63ca2e..335089a` 的审核、功能、依赖、安全、跨平台与客户端变更。其版本台账/README/PLAN/依赖/发布记录全部落后，**只有以下行为证据可作实现参考**：

| 提交 | 内容 | 重放结论 |
|---|---|---|
| `769f309` | 章节抢占与失败恢复（state.ts：claimChapter/failClaimedChapter） | 结构可复用；claim 错误文案需换回 main 完整版 |
| `22b243d` | 正文/版本/字数/状态短事务（persistence.ts） | 结构可复用；含 changes=0 回滚契约 |
| `6d73396` | 后处理拆分（postProcess.ts） | 结构可复用；**约束登记取"最后一章"是 bug**，重放必须改为传入 chapterId |
| `b2eb562`/`b7c9ab8` | 编排器与兼容入口接线（orchestrator.ts + generate.ts 3 行 shim） | 结构可复用；degradedReasons 需透出（旧版被忽略） |
| `5ee220a` | 截断内容禁止进入后处理（截断检查前置） | 直接采纳（spec §4.1 同款要求） |
| `tests/chapter-generation.test.ts` | 225 行状态/事务/空正文/中止/回滚/截断契约测试 | 移植并新增"约束登记落在被生成章节"回归用例 |

## 5. R1 重放适配清单（本基线的核心结论）

1. **约束登记 chapterId 修复**：postProcess 签名改 `(db, novelId, chapterId, rawContent)`，violations 登记到被生成章节（旧分支 bug：`SELECT id FROM chapter WHERE novel_id=? ORDER BY id DESC LIMIT 1`）。main 现状（generate.ts:156）本就传正确 chapterId，重放不得回退。
2. **截断检查前置**：`!aborted && llmResult.truncated` 判定移到主角名替换等一切后处理之前（main 现状在替换之后，generate.ts:111 vs :115）。
3. **单一落库事务**：main 现状先 INSERT version + UPDATE chapter（:127-138），反 AI 重写成功后二次 UPDATE 仅改 chapter 不更新版本快照（:197-199）→ 重写后 `chapter.content ≠ 最新 chapter_version.content`。重放版：后处理全部完成后单事务落库（版本=最终正文），消除分叉。
4. **行为保真项**：claim 错误文案 `'章节正在生成中（或状态不允许），请等待完成'`；约束违反/反 AI 命中/重写失败的 console.warn；ai_words 覆盖语义（N1）；abort 补账（C4）；ConfigError 恢复抢占前状态（v0.24.3）；`GenerateResult` 增可选 `degradedReasons?`（加法兼容，orchestrator 内 consume 并告警）。

## 6. 明确不做（留待后续批次）

- solutionRunner.ts 复制的 claim/复位 SQL 收拢（R4.3 整本生产域）。
- production.ts:238/330 无守卫置状态（其余路径均有守卫）→ R4.3。
- `chapter.generation_token` 迁移（R4.1）；job claim token（R2）。
- R2-R9 全部；依赖升级、发版、tag、GitHub Release（需单独授权）。

## 7. R0 审查发现

见 `docs/audit-report.md` 新增「重构基线审查（2026-08-29）」一节（R0-F1 ~ R0-F6）。
