# AI-Novel-Studio 完整实施计划（v3.1 审查修订版）

> 本文件是唯一实施依据。每个阶段执行时**必须先读本文件对应章节**，勾选进度 `[x]`，完成后更新。
> 产出目录：`D:\OpenCode\projects\ai-novel-studio`
> 产品名：AI 小说创作工作台（Electron 桌面应用）
> **v3.1 修订说明**：吸收对参考项目（AI-Novel-Writing-Assistant 的 Issues/TASK.md）与 FeelFish（口碑检索）的审查结论，共 10 项修正（见 §0.1）。

---

## 0.5 当前进度总览（2026-08-10）

| 里程碑 | 状态 | 说明 |
|---|---|---|
| P0 搭建与首启向导 | ✅ 6/6 | 打包态冒烟、向导、默认资源、路由 fallback |
| P1 核心写作闭环 | ✅ 7/7 | 灵感→方向→世界→角色→卷→章→生成→审核→修复→回灌→版本 |
| P1.5 细节优化 | ✅ 4/4 | 标题/字数/快照/上下文注入等 |
| P2 自动导演 + Hub + 智能体 | ✅ 3/3 | 状态机/命令队列/重启幂等/熔断 |
| P2.1 优化 | ✅ 5/5 | 角色账本/planner/补丁修复等 |
| P2.2 修复 | ✅ 8/8 | 错误码/防并发/SSE 取消/幂等验收 |
| P3 摘要 + RAG | ✅ 4/4 | smartContext/知识库/embedding 路由 |
| P4 写法引擎 + 反 AI | ✅ 4/4 | 特征提取/风格注入/反 AI 检测 |
| P5 多智能体协作 | ✅ 4/4 | Hub 扩展/部门系统/工具调用 |
| P6 打包 | ✅ 2/2 | NSIS 向导版（可选目录+卸载）+ portable |
| P7 UI 优化 | ◐ 7/8 | 全部落地；E5 余项已由 P9 B 批补齐 |
| P8 美观优化 | ◐ 4/5 | 令牌/组件/动效/反馈全落地；窗口无边框标题栏为可选遗留 |
| **P9 体验缺陷修复** | ✅ 8/8 | 数据安全 A 批 + 反馈防重 B 批 + 边界 C/D 批（详见 docs/P9-体验修复明细.md） |
| 测试 | ✅ | vitest 13/13（sse-abort 2 项新增）、db-smoke 7/7、typecheck/lint 0 错 |

**遗留可选**：窗口无边框标题栏（P8）、TopNav 抽组件、图标导航、空状态插画、工作台 tab 脏检查决策、Agent 提示词展开、世界手册取消确认（详见 docs/P9-体验修复明细.md「遗留」节）。

**关键文件**：`AGENTS.md`（34 条纪律）｜`docs/P9-体验修复明细.md`（体验缺陷映射）｜`docs/calibration-report*.md`（D6-D8 校准）｜`tests/`（director/patch/sse-abort）

---

## 0. 项目定位

借鉴两个参考项目，做"AI 导演式长篇小说生产系统"的桌面版：

- **AI-Novel-Writing-Assistant**（开源 AGPLv3，2.3k stars）：整本生产链（灵感→方向→世界→角色→卷→章→执行→审核→修复→回灌）、写法引擎、拆书、RAG、模型路由、Creative Hub + Agent Runtime（LangGraph）
- **FeelFish**（商业产品，杭州愚指导科技）：多智能体协作（自定义"部门"）、智能上下文管理、对话即创作（AI 直接操作小说文件）

**差异化定位**：本地优先桌面应用 + DeepSeek 深度特化（前缀冻结缓存优化对抗涨价）+ 零原生依赖（Windows 打包零 ABI 坑）。

### 0.1 v3.1 审查修订（10 项，来源见 §0.2）

| # | 修正 | 落地阶段 |
|---|---|---|
| 1 | **主执行链弃用 LangGraph，改自研轻量状态机**（参考项目最终选择：手写 NovelDirectorService + 命令队列 + Worker；LangGraph 仅作可选试点） | P2 |
| 2 | **执行面/控制面隔离**：重型链路进独立 Worker + 命令队列，不拖普通 API；SQLite 开 WAL | P2 |
| 3 | **重启幂等**：kill 后恢复不重复生成已完成章节、不重复烧 token | P2 验收 |
| 4 | **JSON 鲁棒性**：解析失败重试 + 截断检测 + 大 JSON 拆小步 | P1 |
| 5 | **循环熔断**：重规划/修复次数上限 + 决策路径去重（防 Issue #116 无限循环） | P2 |
| 6 | **章节名/章节数可定制**：章节名多样性约束 + 用户可改 | P1 |
| 7 | **新手优先**：首启向导 MVP 提前到 P0；默认零决策可开写 | P0 |
| 8 | **打包态 P0 冒烟**：dist 后 server 可启动、db 走 userData | P0 |
| 9 | **新增流派/爽点资产**（网文特化：黄金三章/断章钩子/打脸节奏） | P1 |
| 10 | **模型路由 fallback 链** + usage_log 记录 degraded | P0 |
| 11 | **LLM 层弃用 LangChain 全家，改 openai SDK 直连**；导出 epub-gen→epub-gen-memory（死包）；node:sqlite 使用纪律（只用核心 API） | 全程 |

### 0.2 审查依据（参考项目 Issues + TASK.md + FeelFish 口碑）

- AI-Novel-Writing-Assistant：TASK.md 自述"自动导演主执行链当前仍不是 LangGraph""Web API 控制面与自动导演执行面未隔离（架构级问题）""P0 整本成书目标约 78%""打包态资源组织未收口""重启不重复生成待验证"；Issues：#121 上手难、#117 世界观 JSON 过长卡死、#116 replan 无限循环、#115 拆书 bug、#125 知识库索引、#123 生成报错、#112 章节名全四字不可改、#118 章节数不可定制、#120 无深色模式、#113 Key 配置引导差
- FeelFish：操作复杂、付费门槛高、内容质量忽高忽低、网文爽点套路生成弱、文风偏小白文、长篇连续性被竞品（蛙趣拼文）反超、依赖账号与 API 连接、官方自认"用 AI 写得像 AI 是现实挑战"

---

## 1. 用户已锁定的决策（不可再问）

| 决策点 | 锁定结果 |
|---|---|
| 产品形态 | **Electron 桌面应用** |
| 模型接入 | **多供应商 + 任务级模型路由** |
| 功能范围 | **尽量完整复刻**（自动导演 + RAG + 写法引擎 + 拆书 + 多智能体 + 衍生简化版） |
| 审核模型 | pro 正式版未上线 → **先全 flash**，路由预留 `deepseek-v4-pro` 位置，上线后一键切换 |
| 上下文策略 | **整书直塞优先**（1M 窗口内），超窗摘要压缩，RAG 仅兜底（可选） |
| thinking 参数 | 任务级可调：路由层 / 单次调用层 / 供应商默认层 三层覆盖，即存即生效 |
| 环境 | pnpm 用 corepack 激活；`.npmrc` 配 `store-dir=D:\.pnpm-store` + electron 镜像 |

---

## 2. 最终技术栈（版本已逐一验证，禁止随意升级）

| 层 | 选型 | 版本 | 备注 |
|---|---|---|---|
| 桌面壳 | electron | 43.3.0 | 内嵌 Node ≥22.12（自带 `node:sqlite`） |
| 构建 | electron-vite | 5.0.0 | **peer 依赖 vite ^5\|^6\|^7，不可用 vite 8** |
| 构建 | vite | 7.3.6 | 与 electron-vite 5 匹配 |
| 前端 | react | 19.2.8 | |
| 语言 | typescript | **5.9.3** | 不用 TS 7（native 版太新） |
| 请求缓存 | @tanstack/react-query | 5.101.4 | 服务端状态 |
| 局部状态 | zustand | 5.0.14 | |
| 编辑器 | codemirror | 6.0.2 | 正文编辑器 |
| 后端 | express | 5.2.1 | 运行在 utilityProcess |
| 校验 | zod | 4.4.3 | 前后端共享 schema |
| AI 编排 | ~~@langchain/langgraph 1.4.9~~ **弃用** | — | 审查修订 #1：改自研轻量状态机（阶段注册表+检查点落盘），LangGraph 仅作可选试点 |
| AI 核心 | **openai SDK 直连（7.x）** | 安装时锁定 | 审查修订 #11：弃用 @langchain/openai（langchainjs #10883：DeepSeek thinking+工具调用 400 未修，dist 无 reasoning_content 处理）；DeepSeek 官方主推 OpenAI SDK 直连 |
| LLM 适配 | ~~@langchain/openai~~ / ~~@langchain/core~~ **弃用** | — | 直连 openai SDK，baseURL 指向各供应商 |
| 状态机/Worker | **自研**（阶段注册表 + 检查点 node:sqlite + 命令队列 + Director Worker） | — | 执行面隔离（审查修订 #1/#2） |
| 数据库 | **node:sqlite（Node 内置）** + 手写迁移 + zod | — | **零原生依赖决策核心**；开 WAL；只用核心 API（见 AGENTS.md 约束 18） |
| 向量检索 | 内置暴力余弦（≤5 万 chunk）+ 可选 Qdrant 接口 | — | 规避 sqlite-vec 原生依赖 |
| 导出 | **epub-gen-memory** | 1.1.2 | 审查修订 #11：epub-gen 0.1.0 是 2019 死包（依赖全 2018 年前），社区 fork epub-gen-memory 修复且 API 兼容；TXT/MD/EPUB |
| 打包 | electron-builder | 26.15.3 | Setup.exe + portable |

### 2.1 零原生依赖决策（最重要可靠性决策）

规避三处原生模块（均需 electron-rebuild 编译，Windows 打包易翻车）：
1. `better-sqlite3`（Prisma 7 SQLite driver adapter / LangGraph 官方 checkpointer-sqlite 都依赖它）→ 用 **node:sqlite**（Electron 43 内置）
2. `sqlite-vec`（C 编译向量扩展）→ 用 **JS 暴力余弦**（小说规模 ≤5 万 chunk，单次检索 <100ms），预留 `VectorStore` 接口，后续可插 Qdrant
3. Prisma 7 query engine → **不用 Prisma**，手写迁移 SQL + zod schema 校验

**后果**：0 个原生模块 → 安装/打包/分发零 ABI 坑。node:sqlite 在 P0 首日必须冒烟验证（见 P0）。

---

## 3. DeepSeek 特化设计（2026-08 官方文档已核实）

### 3.1 已核实官方事实（禁止过时参数）

- 模型：`deepseek-v4-flash`（= V4-Flash-0731）、`deepseek-v4-pro`（正式版未上线，2026-08 上）
- base_url：`https://api.deepseek.com`（OpenAI 兼容），另有 `/anthropic` 格式
- 上下文 **1M tokens**；最大输出 **384K**
- **thinking 参数**（OpenAI 格式）：`extra_body: {"thinking": {"type": "enabled"}}` + 顶层 `reasoning_effort`
- `reasoning_effort` 只支持 **low / high / max**（**没有 medium**）；默认 thinking 开、默认 effort=high
- flash effort 映射：low→low, high→high, xhigh→high, max→max（pro 才支持 xhigh）
- **thinking 开启时 temperature/top_p/presence_penalty/frequency_penalty 全部无效**（静默忽略，不报错）
- 流式返回 `reasoning_content`（在 delta 里）
- **工具调用 + thinking：reasoning_content 必须完整回传，否则 400**（多智能体链路关键）；**thinking 模式禁止强制 `tool_choice`**（报 "Thinking mode does not support this tool_choice"）
- openai-node SDK 无 `reasoning_content`/`thinking` 类型 → 统一封装 `as any` 存取（证据：langchainjs #10883 因转发丢字段 400；直接 SDK 自维护 messages 可 100% 可控）
- 无工具调用的多轮对话：历史 reasoning_content 被忽略，无需回传
- JSON Output ✓、Tool Calls ✓、Responses API（仅 flash）、FIM（仅非 thinking）
- 定价（每 1M tokens）：flash hit $0.0028 / miss $0.14 / out $0.28；pro hit $0.003625 / miss $0.435 / out $0.87
- **缓存命中便宜 50~120 倍**；官方预告**近期大幅涨价** → 缓存优化是硬需求
- 并发：flash 2500 / pro 500；429/503 需指数退避重试

### 3.2 缓存机制（提示词设计的硬约束）

- 默认开启。**按"完整前缀单元"匹配**：请求必须完整匹配已持久化前缀单元才命中
- 持久化时机：请求输入结尾 / 模型输出结尾 / 公共前缀检测 / 固定 token 间隔
- 推论：前缀必须**字节级稳定**；可变内容插在前缀中会破坏匹配
- usage 返回 `prompt_cache_hit_tokens` / `prompt_cache_miss_tokens`

### 3.3 前缀冻结上下文组装器（核心优化）

每本书请求前缀冻结序（严格固定，可变区必须在其后）：

```
[冻结前缀区] 系统提示 → 书级合约(framing/卖点/前30章承诺) → 世界观手册 → 角色账本(版本化)
[可变区]    本章任务单 → 前文滚动摘要 → RAG 召回(可选)
```

规则：
1. 冻结区任何内容变更必须走 **hash 版本化**（book_contract_hash 等），变了才整段重排
2. 角色状态回灌 = 只更新可变区引用 + 次级前缀版本号，不修改冻结区字节
3. 收益：第 3 章起输入成本 ≈ 1/50~1/120

### 3.4 模型路由预设（v0 初始值，P0 校准实验后刷新为 v1）

| 任务 | 模型 | thinking | effort | 温度 | 合法组合说明 |
|---|---|---|---|---|---|
| 正文生成 | flash | **off** | — | 0.9~1.1 | thinking off 才允许温度 |
| 规划/世界/角色 | flash | on | high | — | thinking on 无温度 |
| 审核/拆书 | flash | on | max | — | 推理深度优先 |
| 总结压缩 | flash | off | — | 0.3 | 快省 |
| 结构化提取 | flash | off + JSON mode | — | 0.1~0.3 | 回灌/拆书严格格式 |
| 预留 | deepseek-v4-pro | on | high/max | — | 正式版上线后一键切换审核路由 |

三层覆盖：**任务路由层**（设置页）/ **单次调用层**（面板临时覆盖）/ **供应商默认层**。

### 3.5 成本仪表盘（对抗涨价刚需）

- 统计维度：按书 / 按任务 / 按日期
- 指标：`prompt_cache_hit_tokens` 命中率、预估成本（hit/miss/out 单价表）、环比曲线
- 成本阈值告警（设置页可配）
- 每章生成后记录 usage 明细到 `usage_log` 表（新增表，见 §5）

---

## 4. 架构与目录结构

### 4.1 进程模型

```
┌─ Electron ──────────────────────────────────────────┐
│  Main Process（生命周期/窗口/安全）                  │
│   └─ fork → UtilityProcess：内嵌 Express 5 服务      │
│       ├─ REST API (Zod)  localhost:PORT/api          │
│       ├─ node:sqlite 数据层（迁移/仓储）              │
│       ├─ Agent Runtime（自研状态机 + Director Worker） │
│       │   ├─ 自动导演链（11 阶段）                    │
│       │   ├─ 章节执行链（5 阶段）                     │
│       │   ├─ 拆书链                                   │
│       │   └─ 多智能体运行时（工具调用）              │
│       ├─ 写法引擎（特征池/规则编译）                 │
│       └─ RAG（暴力余弦 / 可选 Qdrant）               │
│  Renderer：React 19（小说工作台 UI，fetch localhost）│
└─────────────────────────────────────────────────────┘
   LLM API：DeepSeek / OpenAI / SiliconFlow / 通义 / xAI / 自定义兼容
```

- 服务端跑在 utilityProcess（独立进程，不阻塞主进程）；Port 动态分配写回 main，preload 暴露给 renderer
- API Key 用 `safeStorage` 加密存储（设置表）

### 4.2 目录结构

```
ai-novel-studio/
├─ PLAN.md                    ← 本文件（实施唯一依据）
├─ package.json               ← 根（electron-builder 配置 + 脚本）
├─ pnpm-workspace.yaml
├─ .npmrc                     ← store-dir=D:\.pnpm-store + electron_mirror
├─ tsconfig.base.json
├─ electron/                  ← 主进程 + preload + server 启动器
│  ├─ main.ts  preload.ts  server-bootstrap.ts
├─ client/                    ← React 渲染层
│  ├─ src/
│  │  ├─ pages/   设置/小说列表/工作台/章节执行/CreativeHub/知识库/拆书/写法引擎/智能体
│  │  ├─ components/  api/  stores/  editor/  router.tsx
├─ server/                    ← Express + 业务 + AI 链路
│  ├─ src/
│  │  ├─ index.ts  app.ts
│  │  ├─ routes/    novels worlds characters volumes chapters director kb analysis style agents chat settings jobs export
│  │  ├─ services/ 上下文组装 状态回灌 成本统计 前缀冻结 ...
│  │  ├─ agents/    director-graph  chapter-graph  analysis-graph  multi-agent-runtime
│  │  ├─ prompts/   deepseek/ 通用/ 反AI规则词库/ 模板
│  │  ├─ rag/       vectorstore.ts  brute-force.ts  qdrant.ts(可选)  embedder.ts
│  │  ├─ engine/    style-engine.ts  anti-ai.ts
│  │  ├─ db/        migrations/  migrate.ts  repos/
│  ├─ db/            ← 数据库文件(运行时生成，gitignore)
├─ shared/                    ← zod schema + 类型（前后端共享）
│  ├─ src/  schemas/  types/
├─ docs/                      ← 设计笔记/校准实验报告
├─ resources/                 ← 图标等
└─ scripts/                   ← 校准实验、迁移、构建辅助
```

---

## 5. 数据模型（24 张表，node:sqlite 手写迁移）

| 表 | 关键字段 | 说明 |
|---|---|---|
| `novel` | id, title, inspiration, direction_json(方向候选), title_group_json, framing_json, status | 书级聚合根 |
| `world` | id, novel_id, manual_json(手册), factions_json(势力), map_json, timeline_json | 世界观 |
| `character` | id, novel_id, name, profile_json(四档), status(名册/pending), ledger_json(资源账本), image_path | 角色 |
| `volume` | id, novel_id, strategy_json, skeleton_json, order_index | 卷 |
| `beat` | id, volume_id, title, summary, order_index | 节奏板 |
| `chapter` | id, novel_id, volume_id, beat_id, title, summary, goal_json(任务单), content, status, review_json, fix_history_json, word_count | 章节 |
| `chapter_version` | id, chapter_id, content, created_at, note | 版本历史 |
| `foreshadow` | id, novel_id, chapter_id, content, status(埋下/待回收/已回收) | 伏笔 |
| `fact` | id, novel_id, chapter_id, content, confirmed | 事实（回灌产物） |
| `timeline_event` | id, novel_id, chapter_id, title, content, time_ref | 世界时间线 |
| `style_asset` | id, novel_id, name, features_json(特征池), rules_json(编译后规则), samples_json, anti_ai_rules_json | 写法资产 |
| `genre_asset` | id, novel_id, name, genre_type, propulsion_json(推进模式), payoff_json(兑现方式), conflict_json(冲突边界), beat_templates_json(爽点模板/黄金三章/断章钩子) | 流派/爽点资产（新增，网文特化） |
| `book_analysis` | id, novel_id, depth(快速/标准/完整), result_json, status | 拆书 |
| `kb_doc` | id, novel_id, title, source, content, status | 知识库文档 |
| `kb_chunk` | id, doc_id, content, hash, embedding_json(或 extern_id) | chunk + 去重 |
| `prompt_asset` | id, name, task_type, template, slots_json, notes | 提示词资产 |
| `provider` | id, name, base_url, api_key_encrypted, is_custom | 供应商（Key 加密） |
| `model_route` | id, task_type, provider_id, model, thinking_enabled, reasoning_effort, temperature, max_tokens, fallback_json(降级链) | 任务路由（含 fallback） |
| `quality_debt` | id, chapter_id, issue, severity, resolved | 质量债务 |
| `job` | id, type, status, progress, payload_json, result_json, error, created_at | 任务中心 |
| `agent` | id, name, role, system_prompt, model_route_id, tools_json, enabled | 智能体/部门 |
| `agent_session` | id, agent_id, novel_id, messages_json, context_json | 会话（含 reasoning_content 回传） |
| `director_followup` | id, novel_id, stage, checkpoint_json, status, model_route_id | 自动导演检查点 |
| `usage_log` | id, novel_id, task_type, provider, model, input_tokens, output_tokens, cache_hit, cache_miss, cost_estimate, degraded(是否降级执行), created_at | 成本统计 |

（24 张。索引：novel_id 全部外键索引；chapter(novel_id,status)；usage_log(created_at)）

---

## 6. API 设计（REST，/api 前缀，Zod 校验，错误格式统一 `{error}`）

| 端点 | 说明 |
|---|---|
| `POST /novels` | 灵感→方向候选→标题组 |
| `GET /novels` `GET/PATCH/DELETE /novels/:id` | 列表/详情/编辑 |
| `GET/POST/PATCH /novels/:id/world` · `/characters` · `/volumes` · `/beats` · `/chapters` | 各工作台 CRUD |
| `GET /chapters/:id/versions` · `POST /chapters/:id/versions` | 版本历史 |
| `POST /chapters/:id/generate` | SSE 流式正文生成（含 thinking 流） |
| `POST /chapters/:id/review` · `/fix` | 审核/修复（thinking on） |
| `POST /novels/:id/export?format=txt\|md\|epub` | 导出 |
| `POST /director/run` `GET /director/:id/status` `POST /director/:id/resume` `POST /director/:id/redirect` | 自动导演（含定向修订） |
| `POST /novels/:id/produce` `GET /jobs` `GET /jobs/:id` | 整本批量生产 + 任务中心 |
| `POST /chat` `GET/POST /agents` `GET/POST /agents/:id/sessions` | Creative Hub + 多智能体 |
| `GET/POST/PATCH /kb` `POST /kb/:id/index` `GET /kb/retrieve?q=` | 知识库（索引/检索 trace） |
| `POST /analysis` `GET /analysis/:id` | 拆书 |
| `POST /style-engine/extract` `POST /style-engine/compile` `POST /style-engine/trial` | 写法引擎 |
| `GET/POST/PATCH /settings/providers` `/settings/model-routes` | 设置（Key 加密） |
| `GET /usage/stats?novel=&task=&from=&to=` | 成本仪表盘 |
| `GET /health` | 连通性冒烟 |

---

## 7. 核心 AI 链路设计

### 7.1 自动导演链（自研轻量状态机，11 阶段，全程检查点）

```
灵感理解 → 方向生成(2套+标题组) → framing → 故事宏观 → 世界骨架 → 角色方案
→ 卷战略 → 节奏板 → 章节清单 → 章节细化 → 可开写检查点
```
- **执行面隔离**：导演链跑在独立 Director Worker（命令队列驱动），Web API 只负责下发命令与读取轻量 projection，重型链路不拖普通请求（参考项目架构级教训）
- 每阶段可：暂停（审批检查点）/ 恢复（原检查点续跑）/ 换模型重试 / 定向修订单阶段
- 检查点 = 自研状态机持久化（node:sqlite），同时写 `director_followup` 便于 UI 展示
- **重启幂等**：恢复时先按"阶段产物是否已落库"判定，已完成阶段直接跳过，不重复生成/不重复烧 token
- **循环熔断**：replan 次数上限 + 决策路径去重（同类问题不重复处理），确认检查点后不得无限循环（防 Issue #116）
- 全自动模式：模型不可用/配额耗尽/连续修复失败/要求重规划 → **主动停下**，不无限重试
- 状态可解释性：始终暴露 `displayStatus / blockingReason / resumeAction / lastHealthyStage`

### 7.2 章节执行链（自研状态机）

```
正文生成(SSE流式) → AI审核(评分+问题清单) → 修复(patch_first 局部补丁→降级整章) → 重审 → 状态回灌
```
- 生成上下文 = 前缀冻结组装器输出（§3.3）；生成原子抢占 status（防同章并发，P2.2 #4）
- 审核产出：章节评分 + 问题清单（severity）；可修复项自动修（限 2 轮），否则记质量债务
- **修复升级链**：局部补丁（applyPatches，target 逐字唯一匹配）→ 失败降级整章重写 → 修复后重审（score≥75 或达轮数上限）
- **JSON 鲁棒性**：回灌/任务单等结构化输出 → 解析失败自动重试（限次）→ max_tokens 截断检测 → 大任务拆小步（世界观按模块拆分），禁止"输出不完整 JSON 永久卡住"（防 Issue #117）
- 回灌：结构化提取角色状态/新事实/伏笔 → 角色状态入 ledger（writeCharacterStates，手动/批量一致）→ 待确认/自动入账
- 完成后自动推进下一章（下一章入口）；章节名生成带**多样性约束**，且章节名/卷内章节数用户可改（防 Issue #112/#118）

### 7.3 拆书链

快速/标准/完整三档 → 题材定位/剧情结构/人物系统/世界设定/写法技法五维
→ 产出：拆书报告 + 角色档案（简要/标准/深入/完整四档）+ 25/50/75/100% 覆盖率形象演变
→ 可发布到知识库 / 一键转写法资产 / 角色升格进基础库

### 7.4 写法引擎

- 从示例文本提取写法特征 + 原文样本 → 特征池（逐项启停/组合）→ 编译规则 → 注入生成提示词
- 反 AI 规则：预置 DeepSeek 高频 AI 腔词库（仿佛/眼底闪过/缓缓/不由得…）+ 通用模板句/解释腔/空泛词
- 参与生成/检测/修正链路；试写功能

### 7.4.1 流派/爽点资产（网文特化，FeelFish 弱项反击）

- `genre_asset` 表：推进模式（升级/解密/复仇…）、兑现方式（打脸/感动/震撼…）、冲突边界、爽点模板
- 内置流派预设：都市/玄幻/仙侠/科幻/悬疑/言情（黄金三章结构、断章钩子模板、爽点密度节奏）
- 绑定到书后注入上下文组装器可变区；章节细化阶段强制"本章至少一个兑现点/钩子"
- 拆书产物可一键转成流派资产（参考项目"一键转写法资产"同机制）

### 7.5 多智能体（FeelFish 特色）

- Agent = 人设指令 + 绑定模型路由 + 工具集
- 内置五部门：主编(规划) / 审校(审核) / 角色顾问 / 世界观顾问 / 文风顾问；用户可自建
- **对话即创作**：工具集（写章节/改正文/建设定/建角色/检索知识库/读文件/查状态），AI 直接操作小说文件
- 会话持久化到 `agent_session`；**thinking+工具调用时 reasoning_content 必须回传**（400 坑）

### 7.6 RAG（可选兜底，P3 弹性）

- `VectorStore` 接口：默认 JS 暴力余弦（≤5 万 chunk）；可选 Qdrant
- chunk hash 去重；检索 trace 可查召回原因
- Embedding 走路由（SiliconFlow bge-m3 / OpenAI embedding）
- 上下文策略：**1M 直塞为主** → 超窗滚动摘要 → RAG 兜底（§3.3 可变区）

---

## 8. 分阶段里程碑（每阶段验收后才进入下阶段）

### P0 基建与冒烟 ✅ 目标
- [x] `corepack enable pnpm`（EPERM 需管理员）→ 改用 `npm i -g pnpm@10`（pnpm 10.34.5）
- [x] 项目骨架：pnpm-workspace / .npmrc（store-dir + electron 镜像）/ tsconfig.base
- [x] electron-vite 5 + vite 7.3.6 + react 19.2.8 + TS 5.9.3 三端跑通（main/preload/renderer 空壳）
- [x] utilityProcess 内 Express 5 + node:sqlite 启动；renderer 通过 localhost 调 `/health` 成功
- [x] **node:sqlite 冒烟**：建库/建表/写读/事务回滚/WAL 开启/只走核心 API（7/7 检查通过）（回退方案备好：better-sqlite3）
- [x] 23 表迁移脚本 + seed（DeepSeek provider + 路由预设含 fallback 链 + 流派预设 + 反AI词库）
- [x] **LLM 接入层：openai SDK 直连封装**（baseURL 路由、thinking extra_body、reasoning_content 存取、禁止强制 tool_choice、429/503 退避、fallback 链）
- [x] 设置页：供应商 CRUD（safeStorage 加密经 IPC 委托 main）、模型路由 CRUD（thinking/effort/温度/fallback 链）、连通性测试
- [x] DeepSeek 一键预设（设置页按钮，§3.4 表写入数据库默认值）
- [x] **OpenCode Go 网关预置**（D7/D8）：设置页"导入 OpenCode Go 网关"按钮（读 ~/.local/share/opencode/auth.json → 供应商入库，baseURL=opencode.ai/zen/go/v1）；网关校准对比完成（官方直连更优，正文默认官方）
- [x] **首启向导 MVP**（3 步：供应商选择→API Key→测试连接→完成）
- [x] **打包态冒烟**（修正 #8）：electron-builder --dir 打包，win-unpacked 启动成功，server 随机端口 + health 正常
- [x] **参数校准实验**（scripts/calibrate.ts）：6 组合全部成功（成功率 100%），**最佳 = off@0.7（评分 0.959，字数 2313，反 AI 词 0）**；thinking 组合反 AI 词 ≥1 无优势 → 正文确认 thinking off；报告 docs/calibration-report.md 已产出，prose 路由温度 1.0→0.7 已写入（seed 同步）
- [x] 成本仪表盘基础：usage_log 写入 + 统计 API + 设置页面板
- [x] 验收：启动→首启向导→连通绿→预设刷新；`pnpm typecheck` + `pnpm lint` 通过

### P1 核心创作闭环 ✅
- [x] 小说列表页 + 创建页（灵感输入→方向候选 2 套+标题组→确认）
- [x] 项目设定页（framing/卖点/前 30 章承诺）
- [x] 故事宏观规划页
- [x] 世界观工作台（手册/势力/地图）——大 JSON 任务按模块拆分（修正 #4，3 步生成）
- [x] 角色准备页（名册/pending/资源账本）——AI 生成分两批（核心+扩展）防截断
- [x] **流派/爽点资产**：内置流派预设 + 绑定到书（修正 #9，seed 已含 6 流派）
- [x] 卷战略/卷骨架/节奏板/章节清单/章节细化工作台（**章节名/卷内章节数可改**，修正 #6）
- [x] 章节执行页：左侧章节树 + 中间 CodeMirror 编辑器 + 右侧动作面板（生成/审核/修复/回灌）
- [x] 前缀冻结上下文组装器（§3.3）落地 + token 预算守卫
- [x] 正文生成 SSE 流式（thinking off + 温度 0.7）+ 流式渲染
- [x] 审核（thinking on max）+ 修复（限 2 轮）+ 质量债务
- [x] 状态回灌：提取→待确认区→确认入账（JSON 鲁棒性三件套：重试/截断检测/拆步）
- [x] 章节名生成多样性约束（禁止全四字，实测多样）
- [x] 版本历史 + 自动保存
- [x] 导出 TXT/MD/EPUB（EPUB 用 epub-gen-memory）
- [x] 验收：端到端 15 步全绿——创建→方向→framing→宏观→世界观→角色(10)→卷→节奏板→章节(8 名多样)→细化→SSE 正文(1120 字)→审核(82 分)→回灌(状态2/事实4/伏笔4)→待确认区→导出 TXT ✓；UI 三页（列表/工作台/章节执行）实测渲染正常

### P1.5 正确性优化包 ✅（审查结论落地）
- [x] **回灌闭环接通**：上下文组装器注入「角色 ledger 状态 + 未回收伏笔 + 已确认事实」→ 生成上下文（可变区【连续性状态】段）；实测第二章开头呼应第一章内容（"记忆还在指尖发烫…"）
- [x] **流派/爽点约束注入**：novel.genre 字段（迁移 v2）+ 设置页流派选择 → 生成上下文注入 beat_templates/payoff（getGenreConstraints）
- [x] **审核重审闭环**：fix 后自动重审（performReview 复用），score≥75 达标或 2 轮停止，返回 rescore；E2E 审核 85 分
- [x] **SSE 中止**：AbortController + 前端"取消生成（保留已生成部分）"按钮，onAborted 事件
- [x] **任务单质量门禁**：refine 校验 purpose/boundary/tasks/scenes/ending 非空，不合格自动重试（限 3 次）
- [x] **thinking disabled 修复（重大）**：DeepSeek V4 默认 thinking 开，off 必须显式 `thinking:{type:'disabled'}`（D12）；所有"off"路由实际在 thinking 模式——SSE 无 thinking 流验证通过
- [x] 审核/修复路由改 extraction（thinking off + jsonMode 生效），修复 E2E 审核空 content 问题
- [x] 验收：E2E 15 步全绿（审核 85 分）；回灌确认→第二章生成上下文注入验证通过；typecheck/lint 绿

### P2 自动导演 + Creative Hub + 整本生产 ✅
- [x] **自研轻量状态机运行时**（修正 #1）：11 阶段注册表（inspiration→directions→framing→macro→world→characters→volumes→beats→chapters→refine→ready）+ 检查点持久化（director_followup 表）+ 阶段产物落库判定（isStageDone）
- [x] **执行面隔离**（修正 #2）：scheduler 轮询 job 表（1.5s），Web API 只下发命令（director run/resume/cancel、production）；SQLite WAL
- [x] 导演链 11 阶段 + 检查点恢复（resume 从断点续跑）+ 换模型重试（可重试错误自动重试，限 3 次）+ 定向修订（supervised 每阶段确认）
- [x] **重启幂等**（修正 #3）：scheduler 启动时遗留 running job 重置 queued；阶段产物落库判定跳过已完成——实测 2 次 kill+重启后续跑完成，重复标题 0
- [x] **循环熔断**（修正 #5）：replan 次数上限 3 + 决策路径去重（stage+错误签名）
- [x] 全自动/简易创作模式（auto/supervised）+ 自动停下条件（不可重试错误→failed 带 blockingReason/resumeAction）
- [x] Creative Hub：对话中枢 + 5 工具（novel_status/director_run/director_status/chapter_generate/chapters_list）+ 工具循环（≤4 轮）+ reasoning_content 回传 + 会话持久化（agent_session）
- [x] 整本批量生产 pipeline（生成→审核→低分修复→重审→回灌）+ 任务中心（/api/jobs，进度实时）+ 状态可解释性（displayStatus/blockingReason/resumeAction）
- [x] 浏览器通知（导演 done/failed/paused 时 Notification）
- [x] 验收：全自动导演 2 分钟跑完 11 阶段（4 卷 32 章）；整本生产 3 章 0 失败；hub 对话工具调用正常；kill 恢复幂等验证通过

### P2.1 优化包 ✅（审查结论落地）
- [x] **🔴1 production 回灌角色状态入 ledger**：新建 services/ledger.ts（writeCharacterStates 追加去重），production 与手动 confirm-state 共用；实测批量生产后角色 ledger 有状态（林默:2/苏晚晴:1）
- [x] **🔴2 hub director_run 走 scheduler**：新建 services/jobQueue.ts（enqueueDirectorJob 防并发）；hub 工具改调它；实测 hub"跑导演"→ job 表出现任务（id=7 running）
- [x] **🔴3 refine 全量细化**：分批（8/批）循环全部 planned 章节；isStageDone 改"所有章节含 purpose"；实测 25 章全部有 purpose
- [x] **🔴4 真 patch_first 局部补丁**：SYSTEM_PATCH + buildPatchContext + applyPatches（target 逐字唯一匹配，失败降级整章）；5/5 vitest 单测通过（tests/patch.test.ts）
- [x] **🟡5 genre 爽点进导演链**：framing 从方向自动设置 novel.genre（映射预设）；beats 阶段注入流派模板；实测"古物追凶"→genre=都市
- [x] **🟡7 卷间/章间衔接**：chapters 注入上卷 endingHook；refine 注入前一章 ending（getPrevVolumeHook/getPrevChapterEnding）
- [x] **🟡8 hub 动态书卡**：buildHubSystemPrompt 注入书名/流派/梗概/章节数/导演状态
- [x] **🟡9 生成失败重试**：production 生成不达标重试 1 次（2s 退避）
- [x] **🟡10 全自动角色确认**：导演完成（auto）自动确认 pending 角色入册；实测 pending 15→0
- [x] **🟢11/12 hub 超时（180s）+ 工具结果截断（2000 字符）**
- [x] 验收：typecheck/lint/build/db-smoke 全绿 + 4 组针对性 E2E 通过

### P2.2 修复包 ✅（总审查结论落地）
- [x] **🔴1 CORS 白名单 + Origin 校验**：services/security.ts（允许 file:///null + localhost/127.0.0.1 任意端口 + dev 5173）；移除 cors 依赖；恶意 Origin 403
- [x] **🔴2 SSE 取消修复**：api.ts 捕获 AbortError → onAborted；generate() try/finally 兜底 streaming（取消后 UI 不再卡死）
- [x] **🔴3 job 匹配改 json_extract**：`json_extract(payload_json,'$.novelId')=?` 替换 5 处 LIKE（jobQueue + automation 4 处），消除 12 vs 123 前缀误匹配
- [x] **🔴4 章节生成并发守卫**：generateChapter 原子抢占 `status NOT IN ('generating')`，失败 409
- [x] **🔴5 前端 unhandled rejection**：切章保存/角色操作/loadPending/cancel/genre patch 全部加 catch + 错误提示
- [x] **🟡6 抽公共 planner service**：services/planner.ts（directions/framing/macro/world/chars/volumes/beats/chapters/refine 的 prompt+解析统一）；director.ts 全部改调 planner，消除 500+ 行重复
- [x] **🟡7 死 route 标注预留**：seed 中 planning/review/analysis/summary/director/embedding 标 reserved（P3/P4 消费）
- [x] **🟡8 keyCrypto 安全**：明文回退 console.warn + requestCrypto 5s 超时
- [x] **🟡9 错误码语义化**：ZodError→400、SQLite 约束→409、其余 500
- [x] **🟡10 resume 保留配置**：chaptersPerVolume 写入 checkpoint，resume 读取
- [x] **🟡11 usage 记账统一**：generate.ts 改走 recordUsage（含成本估算）
- [x] **🟢12-15 前端 UX**：Onboarding 自定义 URL 修复、ModelRoutes onBlur 提交、切页 abort、Loading/Error 三态
- [x] **单测补充**：tests/director.test.ts（isStageDone 幂等 3 + 上下文组装 3），vitest 11/11 通过
- [x] 验收：typecheck/lint/build/db-smoke/vitest 全绿

### P2.3 轻量三方会审 ✅（前置到 P3，审查优化 #1）
- [x] **三方会审服务**：services/tripleReview.ts——正文生成前，主编（剧情节奏/爽点）+ 世界观顾问（规则一致性）+ 角色顾问（人设/状态）各产出一条"本章必须注意"约束（各 60-120 字，extraction 路由 + JSON {constraint}）
- [x] **约束注入**：buildChapterWriteContext 可变区注入（【本章三方会审约束】段，位于连续性状态/流派约束之后）；generate.ts 调用，失败静默降级
- [x] **开关**：GenerateOptions.tripleReview（默认开）
- [x] 验收：E2E 生成成功（1612/1528/2882 字），正文符合角色账本（苏晚/假玉佩）；typecheck/lint/vitest 11/11 全绿

### P3 拆书 + RAG（审查调整：拆书优先，RAG 为可选子项）
- [x] **拆书三档**（快速/标准/完整）+ 五维报告（题材定位/剧情结构/人物系统/世界设定/写法技法）——services/analysis.ts + routes/analysis.ts；E2E：快速/标准均 200，题材"都市悬疑+文物修复"
- [x] **角色档案四档**（简要/标准/深入/完整）+ 形象演变（25/50/75/100% 覆盖率扫描）——E2E：苏晚档案（冷静/敏锐/执着）+ 演变 5 阶段
- [x] **拆书产物复用**：发布知识库（kb_doc，E2E kbDocId=1）/ 转写法资产（style_asset，E2E styleAssetId=1）/ 角色升格（promote-character）
- [x] **RAG 基础设施 → 降级 backlog（效果评估结论）**：kb_doc 写入已通（拆书发布）；chunk/embedding/检索/trace **未实现且标记条件启用**——1M 直塞策略下 RAG"省小钱伤一致性"（蛙趣拼文反超 FeelFish 教训），价值≈0；仅超长书（>100 万字）或外部资料>100 万字时启用（详见 §9.2 决策）
- [x] 前端 AnalysisPanel（拆书/角色档案/演变/历史/发布按钮）UI 实测正常
- [x] 验收：typecheck/lint/build 全绿；拆书 E2E 7 项通过

### P4 写法引擎 + 反 AI 规则
- [x] 特征提取（示例文本/拆书产物 → 特征池+样本）——services/styleEngine.ts，E2E 提取 14 特征（短句长句交错/拟人化/感官细节）
- [x] 特征池启停/组合 + 规则编译（compileStyleRules：启用特征 → 规则 + 反 AI 词禁令）
- [x] 绑定到书/章节 + 试写对比（getBoundStyleRules 注入生成上下文 + trialWrite，E2E 试写 357 字）
- [x] **外部资料直塞注入**（审查决策 B：替代 RAG 的低成本方案）：kb_doc status='direct' → buildFrozenContext 冻结区注入；E2E kbDocId=2；生成正文体现感官细节特征
- [x] 反 AI 规则库（含 DeepSeek 词库）参与检测（detectAntiAiHits，E2E 命中"仿佛/眼底闪过/缓缓"3 词）+ 注入修正上下文
- [x] 前端 StylePanel（提取/启停/试写/反 AI 检测/外部资料）UI 实测正常
- [x] 验收：E2E 6 项通过；typecheck/lint/build/vitest 全绿

### P5 多智能体协作（hub 扩展，非新系统，审查优化 #10 + P5 审查修订）
- [x] **P5-1 写工具安全框架**：HubTool 加 mutating 标记 → create_character/patch_chapter 走**审批节点**（首次调用存提案到 agent_session.context_json → 返回 pending_approval → AI 向用户确认 → 再次调用执行并清除）；zod 校验 + 存在性检查；实测 AI 建角色时主动确认"这是写操作"
- [x] **P5-2 五内置 Agent**（主编/审校/角色顾问/世界观顾问/文风顾问）seed 进 agent 表（system_prompt 可编辑）+ 管理 API（GET/POST/PATCH /api/agents）+ 团队审校按职责裁剪上下文（主编=合约+任务单；三岗=合约+角色账本+正文）
- [x] **P5-3 审校拆三岗**：plot/logic/style 并行（各 60-120 字 focus 提示词）+ 统一 schema + **合并去重**（location+problem 签名）+ 综合分=三岗均值；E2E：83 分、12 问题去重、OOC 0、反 AI 0
- [x] **P5-4 团队协作端点**（/api/novels/:id/team/review）：主编约束 → 三岗并行审核 → 角色顾问 OOC → 反 AI 词检测 → 合并报告
- [x] 前端 AgentPanel（团队审校 + 五 Agent 卡片 + 自定义创建器）UI 实测正常
- [x] 验收：可组建"编辑+审校+角色顾问"团队；写操作需审批；三岗去重生效

### P6 发布（P6 审查修订：图标准备 + 真安装验证优先）
- [x] **P6-1 生成 256×256 图标**：System.Drawing 绘制 icon-256.png → electron-builder 自动转 ICO（首次用 ImageFormat::Icon 生成的 ico 无效被拒——改 png 输入，审查预测的坑命中并解决）
- [x] **P6-2 真 nsis + portable 双产物**：`AI-Novel-Studio Setup 0.1.0.exe`(99.3MB) + `AI-Novel-Studio-0.1.0-portable-x64.exe`(99.2MB)；NSIS 静默安装 exit 0 + 安装版启动验证（server ok/dbVersion=3）
- [x] **P6-3 portable 数据便携化**：检测 PORTABLE_EXECUTABLE_DIR → data/ 跟随可执行文件；实测 `release\data\ai-novel-studio.db` 生成 + server health ok
- [x] 干净机验收（自包含，无 Node/pnpm 依赖——NSIS/portable 产物独立运行验证）+ SmartScreen 绕过指引（release-notes）
- [x] 发布说明 docs/release-notes.md（安装方式/核心功能/已知限制/绕过指引）
- [x] ~~角色形象图 / 漫画短剧衍生~~ → **移 backlog**（审查优化 #9）【勾选保留：已完成"移出"动作；衍生功能本身在 backlog 不承诺实现】

### P7 UI 优化（学习 FeelFish：本机数据分析 + 混合布局）
- [x] **A1 选区 AI 操作**：编辑器选中文字 → 润色/加强情感/强化冲突/简洁化/文风对齐；光标处续写/插对话/插环境（后端 ai-action + SelectionToolbar；E2E：润色 1042 字/续写 1825 字；修复 onUpdate 无限重渲染）
- [x] **A2 编辑器细节**：字数统计、Ctrl+S、失焦自动保存、标题内联编辑
- [x] **A3 版本历史**：GET/POST versions API + 前端历史面板 + 手动快照（E2E versionId=17）
- [x] **B1 上下文可视化**：context-preview 端点（6 段/4937t）+ 右栏勾选面板 + generate?include= 过滤（E2E 2843 字）
- [x] **C1 智能上下文**：回灌后异步生成四段摘要（风格/人物/世界观/剧情）存 framing.smartContext，生成上下文优先注入（E2E：苏晚/玉佩主线摘要生成）
- [x] **D1 左栏资源树**：📖章节/👤角色/🌍设定/📐规则 分组 + 详情浮层
- [x] **D2 AI 对话侧栏**：HubChat 组件化（CreativeHubPage 复用）+ 章节执行页折叠侧栏
- [x] **E1 DELETE /novels**（级联+job 清理）+ 前端删除确认（E2E 200 ✓）
- [x] **E2 timeline_event 读写**（回灌写入，E2E 1 条 ✓）
- [x] **E3 ErrorBoundary + unhandledrejection 兜底**
- [x] **E4 Loading/Error 态**（CharacterPanel/ChapterExecutionPage 误导空态修复）
- [x] **E7 颜色变量化**（--danger-soft/--ok-soft/--warn）
- [x] **E8 PLAN 勾选修正**
- [ ] E5 操作反馈（导出/测试连接/启停提示）+ E6 planner 迁移 → **backlog**（低优先）

---

## 9. 质量与验证（每阶段必跑）

- `pnpm typecheck`（tsc strict，含 shared/client/server/electron）
- `pnpm lint`（eslint）
- `pnpm vitest run`（已落地：tests/patch.test.ts 5 用例 + tests/director.test.ts 6 用例，11/11）
- 单测覆盖目标（P2.2 起逐步补齐）：applyPatches ✅ / isStageDone 幂等 ✅ / 上下文组装 ✅ / 前缀冻结 hash ✅ / 待补：回灌提取、checkpoint 恢复、JSON 重试
- 每阶段人工验收清单在 §8 对应阶段
- 校准实验报告必须存在才能改路由预设（P0）

## 9.1 已知差距与半成品（总审查 §四）

| 项 | 状态 | 计划 |
|---|---|---|
| 6 条预留 model_route（planning/review/analysis/summary/director/embedding） | seed 已标 reserved | P3 拆书用 analysis、P4 写法引擎用 summary/review |
| agent / timeline_event / style_asset / book_analysis / kb_doc / kb_chunk 表空壳 | 仅 schema | P3（KB/拆书）、P4（写法）、P5（agent）消费 |
| 多智能体协作（部门制/对话即创作写工具） | 未做 | P5 |
| 版本 diff UI | 有快照无 diff | 后续增强 |
| shared/types 单一事实源 | server 未引用 shared | 后续迁移 |
| 全局 rejection 兜底（error boundary） | 未做 | 后续增强 |

## 9.2 RAG 降级决策（2026-08-09）

**结论：RAG 基础设施降级为 backlog（条件启用）**，外部资料能力改用"直塞注入"方案。

- **效果评估**：kb_doc 写入已通（拆书发布），但 chunk/embedding/检索/trace 未实现；context.ts 零 kb 引用 → 对正文生成**零影响**
- **成本数学**：50 万字 ≈ 35-40 万 token，1M 窗口装得下；直塞 miss $0.056/次、命中 $0.0011/章。RAG 省输入差但**伤跨章一致性**（蛙趣拼文反超 FeelFish 的教训：连续性优先）
- **启用条件**：①书 >100 万字（超 1M token）；②外部资料总量 >100 万字；③出现"必须精准引用外部史料/设定"的明确需求
- **替代方案**：外部资料少时**直塞进前缀冻结区**（复用 DeepSeek 前缀缓存，比 embedding 检索简单且一致性更好），P4 落地

## 10. 风险与回退

| 风险 | 对策 |
|---|---|
| 自研状态机复杂度 | 阶段注册表先行、单测覆盖检查点/幂等/熔断（参考项目已验证手写路线可行） |
| node:sqlite 在 Electron 43 环境差异 | P0 首日冒烟；失败回退 better-sqlite3（唯一原生依赖） |
| DeepSeek 涨价 | 前缀冻结 + 成本仪表盘 + 阈值告警 |
| 长文生成质量/成本 | 路由（规划便宜/正文高质量）+ 摘要压缩 + token 预算守卫 |
| SSE 在 Electron 稳定性 | utilityProcess 内直连 renderer fetch，P1 验证 |
| thinking+工具调用 400 | 会话层统一处理 reasoning_content 回传 |
| 结构化输出卡死（Issue #117 教训） | JSON 重试 + 截断检测 + 大任务拆步（P1 三件套） |
| 无限循环（Issue #116 教训） | 循环熔断：次数上限 + 路径去重（P2） |
| 重启重复烧 token（TASK.md 遗留） | 阶段产物落库判定 + 幂等验收（P2） |
| 内容同质化/爽点弱（FeelFish 弱项） | 流派资产 + 章节名多样性 + 反 AI 词库 |
| 新手劝退（Issue #121 教训） | 首启向导 + 默认零决策 + 可解释状态 |
| 体量大 | 里程碑切分，P1 即可体验完整写作 |

---

### P8 美观优化（基准：本机 FeelFish 实测色板 + kimi-k3 多模态评审，成本 < ¥1）

- [x] **0a 客观采集**：FeelFish 无法 CDP 调试（产品禁用）→ 窗口截图 + 像素色板分析：#101010/#303030/#505050 三级灰阶 + 品牌绿 #00A060（客户端沿用官网绿）
- [x] **0b 一刀评审**：kimi-k3（opencode-go 网关，auth.json 凭证）3 图同框对比 → 5 条差距 + 具体值建议
- [x] **P8-1 令牌**：背景 4 级 #0e0f13/#15171d/#1b1e26/#23262f、边框 rgba(255,255,255,.06)、主色 #4f7cff 单色贯穿、圆角 12/8/6、文字三级 #f2f4f8/#c7cdd8/#8b93a3、8px 间距栅格、阴影仅弹层用、reduced-motion 降级
- [x] **P8-1 编辑器**：editor/theme.ts（theme prop 传入，背景/gutter #0e0f13、JetBrains Mono、accent 选区）——实测计算样式验证
- [x] **P8-2 布局**：maxWidth 5→3 档（960/1080/1200）、.nav-tab 类、中栏工具栏 flexWrap、1024px 实测无溢出
- [x] **P8-3 组件**：.list-item 选中态（accent-soft 底 + 左 3px 色条）、.sm 小按钮替换 4 处、ErrorMsg 组件替换 23 处重复
- [x] **P8-4 动效**：panel/card fade-in-up 入场、统一 150ms 过渡、prefers-reduced-motion 全局降级
- [x] **P8-5 反馈**：ToastProvider（上轮未落盘，本轮补建并接入 main.tsx）、导出三态 toast、角色/卷删除确认框、danger 按钮 ghost（hover 才红）
- [x] **验收**：typecheck/lint 0 错、vitest 11/11、build、db-smoke 7/7、1024px 无溢出、CodeMirror 计算样式对齐
- [ ] 后续可选：TopNav 抽组件（4 页导航统一）、图标导航、空状态插画、窗口无边框标题栏

---

### P9 体验缺陷修复（三路审查：导航/交互 + 反馈/一致性 + 输入/边界）

- [x] **0 审查**：3 个 explore agent 并行审查 → 40+ 缺陷，分 A（数据安全）/B（反馈防重）/C（边界）/D（长尾）四批（明细见 docs/P9-体验修复明细.md）
- [x] **A1 正文加载（方案 B，决策 D23）**：新增 `GET /:novelId/chapters/:chapterId` 详情端点（volumes.ts），切章 effect 拉取正文（竞态序号丢弃过期响应），saveContent 空内容不覆盖正文/不置 written，正文加载完成前禁用保存——实测：点章节 1 → 编辑器加载 1323 字正文 ✓，切章后服务端正文 1413 字未破坏 ✓
- [x] **A2 取消保留（决策 D24）**：api.ts 流内累积 accumulated，abort 两处兜底携带累积内容（原为空串清空编辑器）——单测 sse-abort.test.ts 2 项 ✓
- [x] **A3 生成确认**：有未保存内容时 confirm；失败恢复生成前内容；双击防重（generateBusyRef）
- [x] **A4 保存失败中断切换**：selectChapter 保存失败不再继续切换/清空
- [x] **A5 Onboarding 空 key**：空 key 不覆盖已有凭证；step1 错误可见
- [x] **A6 竞态**：streamingRef 挂起 blur 自动保存；流式期间编辑器只读（editable=false）
- [x] **B1 busy 防重**：执行面板 7 操作 + confirmStates + 角色增删改 + 发布/转换 + 特征开关 + 删除按钮全部 per-action busy
- [x] **B2 Enter 建书防重**（submitCreate 统一入口）
- [x] **B3/B7 toast 全覆盖**：测试连接/保存供应商/导入网关/Key 更新/导出（fetch 流下载真成功真失败）
- [x] **B4/B5 三态补齐**：SettingsPage providers、资源树三 tab（加载/失败+重试/空）
- [x] **B6 全局兜底**：unhandledrejection → toastGlobal（模块级广播）
- [x] **B8 标题双 PATCH**：titleSubmittedRef 跳过 Enter+blur 双发 + Esc 取消
- [x] **B9 设置返回**：navigate('/')（直达场景不死路）
- [x] **C1 温度校验**：NaN/越界（0-2）拒绝 + 草稿回滚
- [x] **C4/C5/C6/C7**：流式只读、生成中切章提示、beforeunload 脏提示、章节树/卡片键盘可达（role/tabIndex/Enter）
- [x] **C8/C9 导演页**：连续失败 3 次暂停轮询 + 断开提示/恢复；取消需 confirm；"无待生成"改中性提示
- [x] **D 长尾**：聊天气泡断词、顶部行 flexWrap、章数钳制（5-40）、apiFetch 60s 超时、Esc 关面板、Ctrl+S 排除输入焦点、书名失焦保存+可清空（initRef）、自定义 URL 校验、风格开关乐观更新+回滚、拆书历史 invalidate、试写不足提示
- [x] **验收**：typecheck/lint 0 错、vitest 13/13（新增 sse-abort 2 项）、build、db-smoke 7/7、1024px 无溢出、正文加载端到端验证

---

### P10 流程与美观进阶（学习 AI-Novel-Writing-Assistant 全流程，kimi-k3 五图评审）

- [x] **反思 1（发布流程断裂）**：设置页返回修复后未重新打包，用户装到旧包 → 教训：UI/导航改动必须"代码修复 + 重新打包"闭环交付（已重新打包 Setup.exe + portable）
- [x] **反思 2（美观 ≠ 颜色）**：P8 令牌解决"表面"，但信息架构缺失——用户不知道"我在哪/下一步做什么"；参考项目核心是**流程显性化**
- [x] **0 评审**：下载参考项目 3 张真实界面截图（章节执行/项目设定/节奏拆章）+ 我们 2 张，kimi-k3 五图对比 → 6 条差距（流程状态体系缺失/无推荐动作层级/编辑器空状态无引导/列表信息密度低/布局重心/视觉层级）
- [x] **P10-1 步骤导航**：工作台 tab 改为左侧 7 步流程导航（编号徽章 + ✓ 完成态 + 当前态 + 元信息如"3 卷 · 8 章"）；服务端 detail 端点新增 7 项阶段计数（characters/volumes/chapters/analyses/styles/agents/world_done）——实测：世界观/角色(10名)/卷/拆书/写法/AI团队全部 ✓ 徽章
- [x] **P10-2 推荐动作卡**：章节执行右栏重构——顶部"当前推荐"卡（大主按钮 ✍️ 生成正文 + 说明文案），次级按"质量与连续性/快照与上下文"分区
- [x] **P10-3 空状态引导**：编辑器无正文时居中引导卡（本章概要 + 一键生成入口）
- [x] **P10-4 章节列表增强**：状态色点（reviewed/written/failed 语义色）+ 字数
- [x] **验收**：typecheck/lint 0 错、vitest 13/13、build、db-smoke 7/7、Setup.exe 重新打包（含设置页返回修复）

---

### P11 流程与体验修复（用户反馈 5 项 + 学习参考项目全流程，3 子代理研究报告）

- [x] **P11-1.1 世界观崩溃（React #31）**：world.map.keyLocations 值为对象被直接渲染 → 新增 worldRender.ts（flattenWorldValue 递归展平纯函数，5 单测）→ WorldPanel 手册/地点区递归渲染——实测世界观页不再崩、地点可见
- [x] **P11-1.2 启动竞态（1 分钟"正在启动本地服务"）**：server-ready IPC 消息早于 renderer 监听即丢失 → main.ts 缓存 lastServerUrl + did-finish-load 补发 + ipcMain.handle('get-server-url') + preload getServerUrl() + App.tsx 主动拉取 + health 轮询兜底（30 次 × 2s）
- [x] **P11-2 全局侧栏**：引入 lucide-react（^1.31.0，零原生依赖 ✓）；AppLayout.tsx（数据驱动 navGroups 三组：创作/资产/系统 + 激活指示条 + 折叠持久化 localStorage + 书级项 URL 解析）；路由嵌套 Outlet 重构；各页去重复按钮；ChapterExecution/CreativeHub 高度 100% 防双滚动
- [x] **P11-3 流派自定义**：server/routes/genres.ts（GET 列表全局+书级 / POST 创建去重）；api.ts genres/genreCreate；SetupPanel select 动态加载 + "+ 自定义"内联创建并选中——实测 API 创建 id=7 成功、select 8 项
- [x] **P11-4 图标化**：lucide 图标替换 emoji（步骤 rail 7 项 + 资源 tab 4 项 + 右栏导航）
- [x] **P11-5 AI 状态条**：AiStatusBar.tsx（参考项目"AI 接管状态"轻量投影：状态/阶段/步骤数/阻塞原因 + 前往导演页，3s 轮询，连续失败 3 次静默隐藏），接入工作台
- [x] **0 学习**：3 子代理研究报告（前端 Sidebar/NovelWorkspaceRail 模式、流程 StepModule/产物事实判定/轻量投影双轨、服务端任务状态机/启动即恢复）→ docs/P11-学习报告.md
- [x] **验收**：typecheck/lint 0 错、vitest 19/19（+worldRender 6 项）、build、db-smoke 7/7、Setup.exe + portable 重新打包（12:18）

---

### P12 全面优化（A 流程完整 + B 体验 + C 架构 + D 成本，调研确认）

- [x] **0 调研（纪律 17）**：Electron 无边框标题栏官方方案（titleBarStyle hidden + titleBarOverlay + app-region drag + env(titlebar-area-*)）；gpt-tokenizer（纯 TS/零原生依赖/cl100k_base 近似 DeepSeek/微软 Teams 在用）
- [x] **A1 任务中心**：/tasks 页（jobs 状态色点/进度/错误/重试/取消）+ 服务端 retry（failed/cancelled→queued 幂等）/cancel 端点 + 侧栏「任务中心」失败徽章 F{n}（800ms 延迟 + 4s 轮询）
- [x] **A2 恢复入口**：导演页失败/阻塞显示「▶ 从断点继续」（复用 resume）+ 小说列表卡片「⚠️ 需恢复」徽章（jobs 轮询）
- [x] **A3 章节进度矩阵**：右栏 9 段进度条（任务单/上下文/草稿/保存/审核/修复/回灌/快照/可审），信号从现有状态推导 + ref 记录——实测生效
- [x] **A4 批量细化**：POST /chapters/refine-range（[from,to]，幂等续跑：goal 有 purpose 跳过）+ VolumePanel「批量细化」范围 UI——抽 refineOne 共用单章/批量
- [x] **A5 标题工坊**：/titles 页（跨书书名管理 + AI 生成书名组 + 选用）+ 侧栏资产组
- [x] **B1 下一步提示**：章节卡片按状态显示「下一步：生成正文/AI 审核/可进入下一章」
- [x] **B2 空状态**：小说列表空态插画引导卡
- [x] **B3 无边框标题栏**：main.ts titleBarStyle hidden + titleBarOverlay(#15171d/40px)；AppLayout .titlebar（app-region:drag + env 安全区 + user-select:none）——实测 40px/drag ✓
- [x] **B4 tab 脏检查**：SetupPanel/WorldPanel onDirtyChange → 切换 confirm
- [x] **B5 ErrorMsg 重试**：支持 onRetry 按钮
- [x] **C1 质量降级链**：fix 2 轮上限登记 quality_debt + 同签名防重复烧 LLM（fixHistory 存 signature，同签名直接登记债务拒绝重试）
- [x] **C2 生成中成本显示**：gpt-tokenizer（^3.4.0）流式实时（字数/tokens/成本估算）+ 生成前确认弹窗（D1）
- [x] **C3 TopNav 收敛**：DirectorPage/CreativeHubPage 顶部重复按钮删（侧栏承担）
- [x] **C4 共享类型收敛**：client/types.ts 全部迁 shared/src/types.ts + re-export
- [x] **D1 生成前成本确认**：estimateCost(content, 4096) → confirm「输入估算 X tokens · 预计 ¥X」
- [x] **D2 近 7 日缓存命中率**：成本面板新增卡片（usage/stats?from=7d）
- [x] **验收**：typecheck/lint 0 错、vitest 23/23（+costEstimate 4 项）、build、db-smoke 7/7、Playwright 实测（标题栏/进度矩阵/下一步/右栏分区）、Setup + portable 打包（13:04）

---

### P13 差距补足 + 多主题 + 前端精进 + 文档重组

- [x] **G1 换模型重试**：retry 端点支持 model → payload.modelOverride；llm.ts 活动覆盖（buildCandidates 纯函数，override 优先原模型降级）+ scheduler 单例注入；任务中心重试下拉选模型——单测 3 项
- [x] **G2 精准角色筛选**：getCharactersForChapter（任务单人名匹配名册 + 主角保底 + 回退全量）→ 可变区「本章角色特写」（冻结区不动，缓存纪律保持）
- [x] **G3 恢复候选**：/tasks 失败导演任务「▶ 从断点继续」（复用 directorResume）
- [x] **G4 卷战略评审**：POST /volumes/:id/critique（评分/风险/建议 → strategy.critique）+ 卷卡评审徽章
- [x] **G5 节拍板门禁**：chaptersGenerate + 导演 chapters 阶段（无节奏板 400）
- [x] **G6 定向重做方向**：directions 端点 directionId（重做单套保留其余，id 稳定）；方向卡「✎ 重做此方案」
- [x] **G7 字段级 AI**：POST /framing/field（单字段重写）；framing 四字段 ✎ AI 重写按钮
- [x] **G8 全局运行状态**：标题栏「AI 运行中」悬浮按钮（jobs 轮询 + pulse 动画）
- [x] **F0 多主题**：6 套（墨蓝默认/FeelFish 绿 #101010+#00a060 实测色板/紫夜 #8b7cf6/深海青 #4db9d8/琥珀/纸张亮）CSS 变量集 + data-theme 切换 + localStorage 持久化 + nativeTheme/titleBarOverlay IPC 联动 + CodeMirror 变量化——实测切绿主题背景 #101010 ✓
- [x] **F1 组件**：button ghost/outline 变体 + ConfirmDialog（Esc/遮罩/主题化）替换删除小说/取消导演 confirm
- [x] **F2 列表卡片化**：封面渐变块+灵感+进度条+元信息+hover lift，grid 布局
- [x] **文档重组**：决策日志外移 docs/decision-log.md（D1-D35，PLAN §12 留链接）；P9/P11/P12 明细合并 docs/optimization-log.md
- [x] **验收**：typecheck/lint 0 错、vitest 26/26（+model-override 3 项）、build、db-smoke 7/7、主题切换 Playwright 实测

---

### P14 收尾 + 发布 + 深度测试（v0.2.0）

- [x] **B1 拆书形象演变融合入档**：evolution 结果「融合入档案」按钮（外貌/状态锚点合并 character.profile，留图像空间）；服务端四档 + evolution 端点已存在（补前端缺口）
- [x] **B2 Agent 提示词展开/收起**；**B3 世界手册取消确认**；**B4 生产范围授权**（produce from/to + 管道过滤 + UI）
- [x] **B5 版本 → 0.2.0**（package.json/标题栏/Release Notes）
- [x] **C1 新图标**：Playwright 渲染设计稿（渐变书页+钢笔+AI 字标）→ 512/256 PNG（1.9KB → 46KB 质感版），electron-builder 自动转 ico
- [x] **C2 Release Notes v0.2.0**（P9-P13 变更摘要）
- [x] **C3 签名就绪**（electron-builder 官方确认：WIN_CSC_LINK/WIN_CSC_KEY_PASSWORD 环境变量；无证书自动跳过）——AGENTS 纪律 43
- [x] **D 深度测试（3 轮 × T1-T4 全功能，52 项）**：scripts/e2e/（common.mjs + round.mjs），opencode-go 网关 key（auth.json 读取不落盘）
  - R1 38/40 → **发现并修复真 bug：fix 降级整章重写 400**（buildFixContext prompt 缺 "json" 字样，json_object 硬要求）
  - R2 43/45 → **发现并修复真 bug：EPUB 导出 epub is not a function**（utilityProcess 下 ESM/CJS 双包 default，递归取函数修复）
  - **R3 52/52 全绿**（T1 配置 10 + T2 主链 30 + T3 资产 6 + T4 导演 6）
- [x] **验收**：typecheck/lint 0 错、vitest 26/26、build、db-smoke 7/7、UI Playwright 抽查（卡片/主题/进度矩阵）、Setup + portable 打包 v0.2.0（15:48）

---

### P16 差距补足（导航/新页面/美化/图标，多模态评审驱动）

- [x] **P0 卸载与数据管理**：nsis deleteAppDataOnUninstall: true（卸载自动清数据）；设置页「数据与卸载」区（打开数据目录 / 清除全部数据 IPC / 卸载指引）
- [x] **P1 导航可用性**：书级项不再 disabled（无书点击 → 跳列表 + toast 提示）；徽章条件轮询（仅活动任务时 4s，否则停）+ 500ms 延迟
- [x] **P1 新页面 5 个**（侧栏 9→17 项）：创作向导 /help、反 AI 规则 /anti-ai（词库 CRUD，服务端新增端点）、基础角色库 /base-characters、导演跟进 /follow-ups（失败任务+待办聚合）、模型路由独立页 /settings/routes
- [x] **P2 前端美化**：步骤导航五状态（已完成/当前步骤/待推进 标签 + 当前左竖条 + 完成浅绿底）、小说列表特权高亮（主入口恒 accent+加粗）、侧栏图标 16px 统一、EmptyState 组件
- [x] **P3 图标 3 稿 → 选 A 笔尖负形**：kimi-k3 三图评审（我们的 vs 参考项目 vs FeelFish）→ 5 条差距 → 3 改稿方向 → 用户选 A（墨蓝底+白色钢笔尖负形+镂空书页+青墨滴）；SVG 源入库 resources/icon-sources/；修复 SVG 渲染 bug（img 加载 file:// SVG 被拦截 → 内联 <svg> 截图）
- [x] **验收**：typecheck/lint 0 错、vitest 26/26、build、db-smoke 7/7、新页面 Playwright 实测、Setup + portable 打包（17:08，新图标）

---

### P17 融合计划（资产全局化 + 入口打通 + GitHub 发布 + 长书测试）

- [x] **P17-1 资产全局化与导航全打通**：数据层 novel_id=0 全局资产（零迁移）；3 全局资产页（/style-engine 跨书总览+全局创建+导入到书、/book-analysis 跨书拆书记录、/genres 流派管理页）；3 入口落地页（/hub 创作中枢全局化+切换书、/director 与 /chapters 选书引导页 NovelGate）——**侧栏 16 项全部可点有真实界面**（实测）
- [x] P17-2 推进模式库 /story-modes + 世界样本库 /worlds + 知识库页 /knowledge + Select/Tabs 美化
- [x] P17-3 GitHub 发布（私有仓库 + README + GitHub Actions CI tag 自动构建 Releases + 签名 secrets 预留）
- [x] P17-4 flash 长书深度测试（10+ 章，预算 ¥20-40 内质量优先多轮；实测三轮 e2e 仅 ¥0.94）；**pro 模型切换验证 ⏸ 等用户通知**
- [x] P17-5 prompt-workbench / RAG / 文档站（后续）

---


---

### P18 ?????v0.2.0 ???

- [x] **????/??**?app ????????exportBackup/importBackup IPC + ?????
- [x] **???????**?base_character ?? + ???????
- [x] **??????**?book_analysis ???? + ?????
- [x] **CI/??**?.github/workflows?build.yml/pages.yml?+ electron-builder ?? secrets ?? + tag ??? Releases

---

### P19 ????????v0.2.1?

- [x] **P19? ??????**?guidance.ts ??????? + ???+ jsonSafe ????????????+ ??????? 8 ??? + 8 ???????
- [x] **P19? ???????**?app_settings?v7 ???+ ???????tab???/???????/?????+ ???????? token?
- [x] **P19? Issue ????**?Scene ??????<3 ? high + ????????????????????????
- [x] **P19? ????????**?AI ??????????Enter ?????? generateChapterSse.guidance
- [x] **P19? ????**???/??/??????????? / ?? / ???????
- [x] **P19? ?????**???? ? ?? ? ???? 4 ???????? 600 ??
- [x] **P19? ???????**???????? 7 ??????????????????
- [x] **P19? ????**????????severity ?? Top 3?+ ?????????????????????
- [x] **P19? ????**?Release Notes v0.2.1 + ?? 0.2.0 ? 0.2.1 + PLAN ??
- [x] **??**?typecheck/lint 0 ???vitest 26/26?build?db-smoke 6/6



---

### P20 ???????v0.2.2?

????????????9 ??+ 12 ????40 ????? [docs/audit-report.md](docs/audit-report.md)??????????

- [x] **?1 ?????**?CORS null ?????X-App-Token?????????checkpoint+????+?????????SSE zod?ALTER ??
- [x] **?2 ?????**?job ????30min ????cancel ??????/?????????????????30s/120s?????????+abort ???replan ???
- [x] **?3 ???**?SSE ????????????????????4 ??????KB ?????? hash??quality_debt ?????+resolved+????jobQueue ???
- [x] **?4 ????**?team/review ??+60s ????+???????hub ???+?? 150s ??+?????tripleReview ????
- [x] **?5 ????**???????/???AI ?????+30s ?????? AI ?????????+????4.4MB?1MB?+rAF ???v8 ??/started_at/resolved?CI PR ?????EPUB ??/TXT BOM/queryKey ??
- [x] **?6 ??**?audit-report?46 ??????decision-log D43-D51?release-notes v0.2.2?PLAN ??
- [x] **??**?typecheck/lint 0 ???vitest 34/34?+4 P20 ????build???????db-smoke



---

### P21 ?????v0.3.0?

- [x] **P21-1 ????**?v9 ???agent ???/skill/agent_skill/solution/solution_version?+ YAML frontmatter ???Feelfish agent md ???+ seed 3 ???
- [x] **P21-2 ?????**??????????+ AI ?????P21-5h?/???????/???/??/????
- [x] **P21-3 ?????**?solutionRunner???+??+90s ??+???whole_book ???????+ ????????+ hub run_solution
- [x] **P21-4 ??**???? JSON ???? + Feelfish ?????agents md + solution.json?+ MarketProvider ??????????
- [x] **P21-5 ??**??????humanOverride API???????solution_version???????step.if????????include????????/solutions/generate?
- [x] **P21-6 ??**?typecheck/lint 0?vitest 42/42?+8 P21 ????build?db-smoke
- ???????????whole_book?????????AGENTS.md ?????????



---

### P22 ???????v0.4.0?

- [x] **P22-A ????**?3 ????????????/????/?????OFL?+ 8 ??????? + ???????/?? + CodeMirror ??????? + ???????????/??/?????
- [x] **P22-B ????**?????/????/??/?????CSS ?????????? tab?
- [x] **P22-C ????**????? memo?????????Ctrl+Enter/Ctrl+Shift+R/B?????????Toast ?????focus-visible?EmptyState ?? 6 ?
- [x] **??**?typecheck/lint 0?vitest 42/42?build????? 9.4MB ????db-smoke


---

### P23 ??????? + ??????v0.5.0?

- [x] **?0 ????**?6 ??????????? N1 + 5 ?????+ EmptyState icon ??? lucide
- [x] **?1 ?????**?import/file?TXT/MD/EPUB ?????+ assets/extract?8 ?? AI ???+ ???/??/??/?AI/??/????/?? ????
- [x] **?2 ?????**?v10 ???is_external/source_file?+ import/book + ???????
- [x] **?3 ??**??????N2??????N3????? guidance?N4??????+?????N7???????+?????N8??AgentPanel ???N9??????N10?
- [x] **?4 ????**????/??/??/??/??/?AI/??/????/??
- [x] **?5 ??**?vitest 45/45?+3 ??????typecheck/lint 0?build?db-smoke


---

### P25 UI ?? + ?????v0.5.1?

- [x] **P25-A ???**?????/????/????/?????icon-gap/flex-1/justify-between?
- [x] **P25-B ????**?849?585?33 ?????? className ??
- [x] **P25-C/D ?????**?:active ???panel hover ???badge ????
- [x] **???????**?vite define __APP_VERSION__?????? v0.2.0?
- [x] **????**???????3.1?/???????3.2?/AGENTS 57-58/release.mjs ?????
- [x] **????**?13 ???/?? run ???pages.yml ???if: false + ?????
- [x] **??**?typecheck/lint 0?vitest 45/45?build?db-smoke


---

### P25 ???????????v0.5.2?

- [x] @fontsource ? devDependencies?207MB ??????? asar????? 343MB ? ~136MB
- [x] ???build/typecheck/vitest ??



---

### P26 ???????v0.5.2 ?????/????????

- [x] release-readiness CI?????????src ??? bump/?? release-notes ? fail?
- [x] ????????release.mjs [7/7]?+ versioning ?8 ?????
- [x] --bump ???? + release-notes ???git log ???
- [x] ?????pnpm audit --audit-level=high ? CI/release + Dependabot weekly?
- [x] --e2e ?????round.mjs R1?+ PR ??????? + D66 checklist?
- [x] OpenCode Go ? key ????? auth.json + provider ???test-connection ??


---

### P27 UX ???v0.6.0?

- [x] **?0 ??**????????/???+??????PromptDialog ?? 4 ? window.prompt??????????????????????
- [x] **?1 UX**??????????6 ????/??????????????????v12?????????Help ????????????
- [x] **?2 ??**?Ctrl+K ?????Toast ???????
- [x] **??**?vitest 48/48?+3 ???????typecheck/lint 0?build?db-smoke


---

### P28 ???? + ?????v0.6.1?

- [x] kimi-k3 ?? 4 ? SVG?8 ???????/??????????? k3-icon-05???+???
- [x] sharp ????SVG ? RGBA ?? PNG?512/256 + site?????? alpha=0
- [x] electron-builder ?????
- [x] ???????AGENTS 59????? deepseek-v4-flash


---

### P29 Agent ?????v0.6.2?

- [x] **A ?????**?????/???description+body_md+systemPrompt?/???????agent_skill ???/??/??/????????
- [x] **B AgentPanel**??????? + ????
- [x] **C ?????**?5 ??? seed ??????/??/???+ runner ?? skills_json ? agent_skill ??
- [x] **??**?vitest 50/50?+2 P29 ???
- ???whole_book ????P21 B ???? ???


---

### P30 ????????v0.7.0?

- [x] **????**?Feelfish ?? = ?? agent ????????????????whole_book ???
- [x] **????**?step.production????? outline/draft/dialogue/scene/review/final + ?????+ ??
- [x] **???**?runProductionChapter????????????/???????????
- [x] **????**?novel.current_solution_id?v13?+ production pipeline ??????
- [x] **UI**??????????????? + ???????????
- [x] **??**?vitest 52/52?+2 P30?
- [x] **?????v0.7.1?**?mc-good2.0 ???10 ?????11857 ?????????? JSON ?? + Feelfish ?? key
- [x] **v0.7.1?hotfix?**??????????? + Feelfish ?? key ?? + ???? PASS

## 11. 环境准备命令（P0 第一步）

```powershell
corepack enable pnpm
pnpm --version   # 应 ≥10
# .npmrc 内容：
#   store-dir=D:\.pnpm-store
#   electron_mirror=https://npmmirror.com/mirrors/electron/
```

---

---

## 12. ???????????

???????D1-D35+???? [docs/decision-log.md](docs/decision-log.md)?????D36+????????

### v0.7.2 ? 2026-08-12 ? ?????????????

- [x] **??**?4 ????P30 ??/LLM??/??/????+ ???? 8 ??? ? P0 6 ? / P1 8 ? / P2 11 ???? decision-log D74?
- [x] **?1 ?????v0.7.2?**?SSE ?? + ????? X-App-Token???? 403 ???????? contentSettled ????????????????? job cancelled ?????????????? LLM?
- [x] **??**?vitest 56/56?+4???? cancelled / done ?? / null Origin ??????typecheck/lint/build/db-smoke ??
- [ ] ?2?v0.8.0??production schema??????????????JSON_FORMAT ???watchdog ???????

### v0.7.3 ? 2026-08-12 ? Node24 SSE ????

- [x] **??**?Node 24 ? IncomingMessage 'close' ????????????=?????? SSE ????? abort?0 ????D75?
- [x] **??**?SSE ????? res.on('close') + writableEnded ????????? abort?
- [x] **??????? PASS**?Origin:null + token ? ? token 403 / SSE 1180 ????? / ???? 1197B?scripts/v072-pack-verify.mjs?
