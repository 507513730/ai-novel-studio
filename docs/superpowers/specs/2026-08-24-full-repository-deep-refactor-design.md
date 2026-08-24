# 全仓库深度审查与兼容重构设计

**日期：** 2026-08-24  
**范围：** `client/src/`、`server/src/`、`electron/`、`shared/`、`tests/`、`scripts/`、根目录工程文件与全部文档  
**目标：** 在保持 REST API、SQLite 数据格式、用户操作流程和现有数据兼容的前提下，重构整个仓库；第一优先级是核心写书链稳定性，最终形成清晰、可测试、可持续演进的业务域架构。

## 1. 背景与已确认决策

当前仓库的功能完整度和安全基础较好，已有任务队列、重启恢复、章节原子抢占、配置错误熔断、前缀冻结、模型 fallback、结构化输出重试和发布门禁。主要技术债集中在职责过载与跨模块状态耦合：

- `client/src/pages/ChapterExecutionPage.tsx` 约 1865 行。
- `server/src/routes/chapters.ts` 约 819 行。
- `server/src/services/director.ts` 约 801 行。
- `server/src/services/context.ts` 约 725 行。
- `electron/main.ts` 约 659 行。
- `generate.ts` 同时承担抢占、上下文构造、模型调用、后处理、版本、字数、usage、正文落库和失败恢复。
- `scheduler.ts` 同时承担 job 抢占、payload 解析、watchdog、任务分派、进度投影和收尾。

本设计采用以下已确认决策：

1. 进行全仓审查和深度重构，而不是局部修补。
2. 保持现有 REST API、数据库格式和用户操作行为兼容。
3. 第一批优先保护生成、导演、整本生产、任务调度和重启幂等。
4. 以统一核心域架构为目标，通过兼容适配层分批迁移；不进行一次性切换。
5. 文档作为独立重构流，建立基线、随代码同步并在最终阶段统一治理。

## 2. 设计原则

- **单一事实源：** 章节状态、job 生命周期、正文落库、错误分类分别只有一个权威实现。
- **按业务域组织：** 以章节生成、任务、导演、整本生产为边界，不创建万能 pipeline 框架。
- **外部兼容、内部重构：** 路径、字段、数据和用户流程不变，允许彻底调整内部模块。
- **产物驱动幂等：** 恢复和跳过以实际产物为准，不只读取状态字段。
- **事务边界清晰：** 正文、版本、字数和最终状态在一个明确事务中落库。
- **错误语义明确：** 配置、取消、暂时性供应商错误、输出校验、持久化和内部不变量分别处理。
- **不增加无必要依赖：** 保持 `node:sqlite`、react-query 和组件本地 state，不引入 ORM、LangChain 或全局 store。
- **兼容层临时存在：** 兼容入口必须有迁移调用者和删除旧实现的明确步骤，禁止长期双轨。

## 3. 目标架构

```text
API / Scheduler
      │
      ▼
业务域应用服务
      ├── chapterGeneration
      ├── jobs
      ├── director
      └── production
              │
              ▼
共享基础能力
      ├── llm
      ├── context
      ├── errors
      └── database repositories
```

建议目录：

```text
server/src/services/
  chapterGeneration/
    orchestrator.ts
    state.ts
    persistence.ts
    postProcess.ts
    types.ts
  jobs/
    repository.ts
    lifecycle.ts
    payload.ts
    executors.ts
    scheduler.ts
  director/
    stages.ts
    checkpoint.ts
    artifacts.ts
    executors/
    pipeline.ts
  production/
    chapterPolicy.ts
    progress.ts
    pipeline.ts
  shared/
    errors.ts
```

`llm`、`context` 和现有数据库薄接口按职责逐步拆分，但不为了目录整齐而强制搬迁稳定代码。

### 3.1 章节生成域

- `orchestrator.ts` 只编排一次章节生成。
- `state.ts` 负责原子抢占、完成、失败、配置错误恢复和中止状态转换。
- `persistence.ts` 负责正文、版本、字数、状态和必要 usage 的持久化事务。
- `postProcess.ts` 负责主角名替换、约束检查和反 AI 重写。
- 原 `generate.ts` 初期保留公共签名并转发到新实现；调用者迁移完成后删除旧实现。

### 3.2 Job 域

- `repository.ts` 负责入队、抢占、取消、更新和完成。
- `lifecycle.ts` 维护 `queued → running → done|failed|cancelled` 的合法转换。
- `payload.ts` 在边界处完成一次 Zod 校验，执行器接收强类型对象。
- `executors.ts` 维护 job type 到执行器的显式映射。
- `scheduler.ts` 只负责轮询、watchdog 和调用执行器。
- 原 `jobQueue.ts` 和 `scheduler.ts` 在迁移期作为兼容入口。

### 3.3 导演域

- `stages.ts` 定义阶段顺序和元数据。
- `checkpoint.ts` 只保存当前位置、用户决策、熔断计数和展示状态。
- `artifacts.ts` 判断阶段产物是否完整，是幂等恢复的事实源。
- `executors/` 按方向、framing、宏观、世界观、角色、卷、节奏、章节和细化拆分。
- `pipeline.ts` 负责循环、取消、熔断和阶段推进。

### 3.4 整本生产域

- `chapterPolicy.ts` 决定跳过已有正文、普通错误继续、配置错误熔断和取消边界。
- `progress.ts` 生成对 UI 友好的进度投影。
- `pipeline.ts` 按章循环并调用统一章节生成域，不自行解释章节状态或重复正文落库逻辑。

## 4. 状态、事务与错误模型

### 4.1 章节生成数据流

```text
validate → claim → prepare → generate → post-process → persist → complete
               │                       │
               ├─ ConfigurationError ──┴→ 恢复抢占前状态
               ├─ 普通异常 ─────────────→ failed
               ├─ 空输出 ───────────────→ failed
               ├─ max_tokens 截断 ──────→ failed
               └─ 用户中止 ─────────────→ 保存部分正文 + written
```

规则：

- `claimChapter()` 原子抢占并返回抢占前状态，后续不得重新猜测原状态。
- post-process 完成后才执行最终正文事务，避免原文和重写正文形成两个不一致落库阶段。
- `completeGeneration()` 在一个事务内写正文、版本、字数和最终状态。
- 正常 usage 继续由 LLM 层记账；中止缺少 usage 时由生成域估算补账。
- 约束登记或反 AI 重写失败属于显式降级，不回滚已经成功生成的正文。

### 4.2 Job 生命周期与恢复

```text
queued → running → done
   │         │
   │         ├→ failed
   │         └→ cancelled
   └──────────→ cancelled
```

- 启动时将遗留 `running` job 重置为 `queued`。
- 将没有正文产物的遗留 `generating` 章节重置为 `planned`。
- 执行器启动前检查产物；已有完整产物则跳过，禁止重复调用模型。
- `modelOverride` 从 payload 一直传递到候选构建，并优先于 fallback 链。
- 全部章节失败时 job 必须失败，禁止虚报 `done`。
- 取消在 LLM 调用、阶段之间和章节之间等安全边界生效。

### 4.3 统一错误类型

- `ConfigurationError`：路由、密钥、解密或必需配置错误；修正配置前不可重试。
- `CancellationError`：用户主动取消，不按系统故障记录。
- `TransientProviderError`：超时、限流和临时网络错误；允许 fallback 或限次重试。
- `OutputValidationError`：空内容、JSON 非法、截断或结构不完整。
- `PersistenceError`：事务或数据库约束失败；不得继续后续阶段。
- `InvariantError`：状态或产物违反内部不变量；立即停止并保留诊断信息。

现有 `ConfigError` 的公共兼容行为保留，可在内部映射为统一错误类型。

## 5. 全仓迁移批次

### 批次 0：审查与契约基线

- 建立 P0-P3 审查清单。
- 为章节状态、job 生命周期、导演 artifact、生产熔断和重启恢复补特征测试。
- 建立文档基线，定位重复事实、漂移、断链、旧模块名和过期截图。
- 不改变产品行为。

### 批次 1：章节生成域

- 拆分 `generate.ts`。
- 统一抢占、失败恢复、正文版本、字数、usage 和后处理落库。
- 迁移 SSE 和整本生产调用者。
- 删除旧实现，仅保留必要公共导出。

### 批次 2：Job 与 scheduler

- 拆分 `jobQueue.ts` 和 `scheduler.ts`。
- 统一 payload 校验、生命周期、执行器注册、watchdog、取消、恢复和进度投影。
- 验证执行中 kill 后恢复不重复生成。

### 批次 3：导演与整本生产

- 按目标边界拆分 `director.ts` 和 `production.ts`。
- 导演以 artifact 判定完成；整本生产统一复用章节生成域。
- 保留循环熔断、决策去重和配置错误整批熔断。

### 批次 4：服务端路由

- 将 `routes/chapters.ts` 拆为生成、审核修复回灌、版本、搜索、上下文预览和 AI 编辑操作。
- 按同样标准审查 `volumes.ts`、`solutions.ts`、`novels.ts` 和 `settings.ts`。
- 路由只做参数校验、服务调用和响应映射；REST 契约保持不变。

### 批次 5：上下文、LLM 与数据访问

- 拆分冻结上下文、动态上下文、预算裁剪和检索逻辑。
- 拆分候选构建、请求体、供应商调用、usage 提取和错误映射。
- 将流程中的散落 SQL 收拢到薄 repository/DAO，仍只使用允许的 `node:sqlite` 核心路径。

### 批次 6：客户端

- 拆分 `ChapterExecutionPage.tsx` 的加载、生成控制、编辑会话、审核修复、版本和布局职责。
- 再处理 `StudioPage.tsx`、`NovelWorkspacePage.tsx` 和 `client/src/api.ts`。
- 保留 react-query 与本地 state；所有异步入口继续使用 per-action busy 锁。

### 批次 7：Electron、安全与发布链

- 拆分窗口、server lifecycle、IPC、更新器和主题模块。
- 复核 trusted sender、safeStorage、CSP、utilityProcess 关闭和 server-ready 主动拉取加缓存补发。
- 保持用户数据目录和 updater 产物约定不变。

### 批次 8：兼容层删除与架构守护

- 删除旧入口、死代码和不可达实现。
- 增加轻量依赖方向检查，阻止路由重新直接承担业务 SQL 或长链路执行。
- 完成最终全仓文档治理和架构一致性检查。

## 6. 文档架构优化

当前文档已具备 Diátaxis 索引、当前 PLAN 与历史归档分离、乱码和断链检查，但仍存在受众混淆、事实重复和语义漂移。已确认的具体问题包括：

- AI 协作者手册被归入新用户教程。
- `docs/README.md` 将当前 `PLAN.md` 错称为历史。
- onboarding 的真实写书进度落后于 PLAN。
- README 的 E2E 范围仍写 T1-T4，而当前门禁是 T1-T5。
- `decision-log.md`、CHANGELOG 和校准报告的长期检索性不足。
- 检查脚本不能发现锚点错误、重复事实、旧路径和跨文档语义漂移。

### 6.1 目标文档结构

```text
README.md / README.en.md
PLAN.md
AGENTS.md

docs/
  README.md
  AI-AGENT-ONBOARDING.md
  architecture.md
  decision-log.md
  versioning.md
  CHANGELOG.md
  test-report.md
  audit-report.md
  competitive-analysis.md
  user/
    getting-started.md
    writing-workflow.md
    model-setup.md
    backup-restore.md
    troubleshooting.md
    export-and-update.md
  development/
    repository-map.md
    local-development.md
    testing.md
    data-model.md
    api-contracts.md
    error-model.md
  operations/
    release-checklist.md
    packaging.md
    ci.md
  collaboration/
    contribution-workflow.md
  reference/
    calibration/
      README.md
      flash.md
      pro-official.md
      pro-gateway.md
    decisions/
      README.md
      archive-D001-D099.md
  superpowers/
    specs/
    plans/
  archive/
    PLAN-history.md
```

治理与协作的权威文档永久保留现有路径：`docs/AI-AGENT-ONBOARDING.md`、`docs/architecture.md`、`docs/decision-log.md`、`docs/versioning.md`、`docs/CHANGELOG.md`、`docs/test-report.md`、`docs/audit-report.md` 和 `docs/competitive-analysis.md`。原因是 `AGENTS.md`、发布脚本和协作者工作流对这些入口有明确约定。新目录用于面向特定受众的补充文档、校准分卷、旧决策归档和设计计划，不用路径美观换取治理入口不稳定。

`docs/decision-log.md` 保持为当前决策入口和新增决策落点；较旧决策可迁入分卷归档，但索引和 D 编号链接必须留在原文件。校准报告迁移时保留兼容链接，完成全仓引用迁移并验证后再删除无用旧分报告。

### 6.2 文档单一事实源

- 当前版本：`package.json`。
- 当前计划与 backlog：`PLAN.md`。
- 历史阶段：`docs/archive/PLAN-history.md`。
- 用户可见版本变化：CHANGELOG。
- 技术决策：决策索引和分卷日志。
- 当前架构：architecture。
- 强制纪律：`AGENTS.md`。
- 协作者工作流：onboarding。
- 测试事实：自动化输出；文档只记录发布级结果，不长期硬编码易漂移数字。

### 6.3 文档实施节奏

1. 批次 0 建立文档基线和迁移清单。
2. 每个代码批次同步更新 architecture、decision log、PLAN、CHANGELOG，以及被触及的 onboarding 内容。
3. 服务端完成后优化开发文档和状态图。
4. 客户端与 Electron 完成后优化用户文档、排障和截图。
5. 最终批次统一迁移目录、清理跳转并增强检查脚本。

检查工具增加：Markdown 锚点、旧路径和旧模块名扫描；版本与测试数字漂移检测；中英文 README 关键能力对齐；架构文件路径存在性；PLAN 与 onboarding 当前状态一致性。`docs/archive/` 只豁免历史乱码，不再整体豁免断链。

## 7. 审查标准与报告格式

- **P0：** 数据损坏、密钥泄露、重复烧 token 或无法恢复的生产事故。
- **P1：** 核心写书链错误、幂等失效、正文丢失或任务虚报完成。
- **P2：** 边界混乱、错误语义不一致、明显性能问题或重要测试缺口。
- **P3：** 重复代码、局部复杂度、命名和文档可读性问题。

每个发现必须记录：文件和位置、触发场景、当前与期望行为、严重度依据、现有测试、推荐修复、兼容风险和所属批次。

每批交付必须说明：

- 发现的具体问题和证据。
- 新旧职责映射。
- 修改与删除的文件。
- 行为兼容证明。
- 测试、构建、安装包和必要 E2E 结果。
- 尚未解决的风险及后续批次。

## 8. 测试与验证

### 8.1 测试层次

- **特征测试：** 重构前锁定现有正确行为。
- **单元测试：** 状态机、错误分类、payload、artifact、预算裁剪和正文计数。
- **集成测试：** API → job → scheduler → pipeline → generation → SQLite 事务结果。
- **故障注入：** 配置缺失、解密失败、超时、fallback、空输出、截断、中止、约束失败、重启、重复入队、全部失败和 kill 后恢复。

所有数据库实验使用内存库或临时 `AI_NOVEL_USER_DATA`，禁止写真实用户库。

### 8.2 每批门禁

代码批次：

```text
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm dist
```

数据层改动增加 `pnpm db:smoke`。文档批次增加 `node scripts/check-docs.mjs` 和 `node scripts/verify-docs.mjs`。发布前至少执行一轮 T1-T5 E2E；优先使用 OpenCode Go 网关 key，异常时按既有纪律使用官方 key 对照。

### 8.3 外部查证

每个批次涉及 Electron、Node、SQLite、Express、OpenAI SDK 或供应商行为时，先查官方文档，再将结论和来源写入 decision log。无外部依据的架构选择明确标注为本地设计。

## 9. 迁移与回退策略

- 每批形成可独立验证和回退的逻辑提交。
- 新实现先通过旧公共入口接入，完成调用者迁移后删除旧实现。
- 数据库不做破坏性迁移；新增迁移必须向前兼容并具备 db-smoke。
- 任何状态或产物语义变化必须先有契约测试。
- 发现真实行为与设计不一致时，停止该切片，记录证据并重新确认，而不是扩大修改范围。
- 不升级锁定依赖，不触碰真实用户数据库，不执行发布或 tag，除非获得用户明确授权。

## 10. 完成标准

全仓重构完成需要同时满足：

1. 核心域各自有清晰入口、状态规则和测试边界。
2. 章节状态、job 生命周期、正文落库和错误分类各有唯一事实源。
3. 原大型兼容入口不再包含旧业务实现。
4. REST、数据库和用户流程兼容，现有数据无需手工迁移。
5. 全量类型、lint、单测、构建、db-smoke、安装包和 E2E 门禁通过。
6. kill 后恢复不重复生成或重复记账。
7. 文档按目标架构组织，单一事实源明确，检查脚本能阻止主要漂移类型。
8. 所有 P0/P1 发现关闭；P2/P3 均已修复或有明确保留理由和后续计划。
