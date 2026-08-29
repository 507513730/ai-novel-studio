# AI-Novel-Studio · AI Agent 协作者手册

> **新 AI agent 进场必读**（配合 `AGENTS.md` 与 `PLAN.md`——当前版；历史阶段编年史在 `docs/archive/PLAN-history.md`）。
> 本文档是聚合与上下文入口：纪律详见 AGENTS.md，架构详见 docs/architecture.md，查证历史详见 docs/decision-log.md。
> 本文档维护规范见 §17（防过时机制——读完全文请回来对照执行）。

## 1. 角色与总览

- **你是什么**：本仓库（AI-Novel-Studio，Electron 桌面 AI 小说创作工作台）的 AI 协作者。你负责代码/测试/文档/查证。
- **等级平权（重要）**：**所有 AI 协作者等级相同**——包括当前会话的你与任何其他 agent 实例，都是用户使用的工作代理、直接服务用户，无主次之分。§2 协作边界是**全体统一纪律**（发布/真实库/硬约束等需用户明确授权），不是等级差异；多 agent 协作模式见 §15。
- **项目一句话**：把"灵感 → 长篇小说"做成可检视的工作空间——导演规划、方案流水线生产、审核修复闭环、状态回灌、创作约束、风格引擎、成本记账，全部本地运行（127.0.0.1 + 随机端口 + 零云端依赖）。
- **当前版本**：`v0.25.0`（以 package.json 为准；发布经 GitHub Release + 应用内自更新）。
- **里程碑**：O1-O5 + I1-I5 全量完成（v0.9.2→v0.14.0）；学习组收官（联网查找/续写+字数分离/运行轨迹+记忆面+故事板，v0.18-0.20）；两轮全量审查修复（v0.17/v0.21）；**30 万字真实写书进行中**（书 #25，应用内生产）。
- **1.0 判据**（docs/versioning.md §1.1）：真实写书完成 + 核心链 1-2 版无 P0/P1 + 数据格式冻结。

### 版本演进一行表（快速理解现状）
| 版本 | 内容 |
|---|---|
| 0.14 | 风格指纹（I5，文体计量学）——O1-O5+I1-I5 收官 |
| 0.15 | 用户创作约束机制（硬/软分级 · 全链注入 · 主角名自动对齐） |
| 0.16.x | 检查更新（electron-updater 自更新）+ 成本人民币显示（汇率自动获取/手动覆盖） |
| 0.17 | 全量审查修复批 1（状态机自愈/安全加固/camelCase 契约/并发纪律） |
| 0.18 | 联网查找可开关（零 key Wikipedia · 知识库一键导入 · 世界观注入） |
| 0.19 | 编辑器光标续写（Cmd+J → Tab 插入）+ 人类/AI 字数分离 |
| 0.20 | NovelClaw 学习组（运行轨迹时间线/记忆面/故事板；角色库复用已有） |
| 0.21 | 全量审查修复批 2（N1 字数记账/N2 续写 race/P3 全量：实体类型补全/confirm 统一/事务/上限/CSP） |

## 2. 任务工作流（每次任务）

### 阶段 0 · 进场（首次）
1. 读完本文档 → `AGENTS.md` → `PLAN.md`（当前版；历史阶段清单按需查 `docs/archive/PLAN-history.md`）→ `docs/decision-log.md` 最近 10 条
2. `pnpm install`（依赖已锁定——勿随意升级，见 AGENTS 纪律 #2）
3. **安装 pre-push 门禁钩子（一次性）**：`git config core.hooksPath scripts/git-hooks`——push 前自动跑三绿，未过拦截（AGENTS #60b 强制层；新 clone 必须执行）
4. `pnpm dev` 跑通（Electron 三进程；dev 固定端口 3000，浏览器可直连调试）
5. 自验证（文档保鲜锚点）：`pnpm test` 全过、`pnpm typecheck` 0 error——若本文档的基线数字与实际不符，按 §17 规则更新

### 阶段 1 · 理解任务
- 明确需求性质：功能 / 修复 / 审查 / 查证 / 文档 / 写书支持
- **涉及外部 API/框架行为 → 先上网查证**（官方文档优先；结论记 decision-log，D 纪律 #61/#17）
- 定位代码：grep + 读 file:line；先看同模块既有实现再动手

### 阶段 2 · 计划
- 输出计划：改动文件清单 / 验证策略 / 风险 / 待确认项；**等用户批准再执行**（除非已授权批处理）

### 阶段 3 · 执行
- 最小改动集；遵循现有模式；中文注释、不加无关注释（AGENTS #16）；修复处标 `// v0.x.y（审查 Xx）` 便于回溯
- **真实用户库禁令**：一切实验用内存库或临时 UDATA（见 §10 独立调试）；绝不直接写 `AppData\Roaming\ai-novel-studio\ai-novel-studio.db`（教训①）

### 阶段 4 · 验证（不可跳过）
| 命令 | 门槛 |
|---|---|
| `pnpm typecheck` | 0 error |
| `pnpm lint` | 无新增 error（既有 6 warning 保留） |
| `pnpm test` | 基线全过（以实际输出为准）；新功能必配测试（tests/vXXXX.test.ts） |
| `pnpm build` | 三端构建通过 |
| `pnpm db:smoke` | checks passed（数据层改动时） |
| `pnpm dist` | **任何代码改动后**（AGENTS #35/#36：release 产物时间戳更新；发版时会重跑 dist，两者不冲突） |

> **push 由 pre-push hook 强制门禁**（阶段 0 安装）：`git push` 前自动跑 typecheck/lint/test 三绿，未过拦截——所有 agent 与手操均无法绕过（AGENTS #60b）。

### 阶段 5 · 台账（写时更新）
- `PLAN.md`（当前版版本记录）更新；历史阶段清单勾选在 `docs/archive/PLAN-history.md`（2026-08-22 起归档，append-only 保留）
- 重大变更/查证 → `docs/decision-log.md`（D 系列：`### D## · 日期 · 主题` + 结论 + 来源）
- 功能/修复 → `docs/CHANGELOG.md`（发版时）
- **onboarding 相关章节若被本次改动触及 → 同步回写**（§17 变更驱动纪律）

### 阶段 6 · 发布（仅用户批准）
- `pnpm release --bump=minor|patch --push`（7 步自动：工作区检查 → bump → verify-docs 台账 → 全量验证 → dist → 提交推 tag → CI + 打包态等价验收 PASS 门槛）
- 台账三件：CHANGELOG 补 `[Unreleased]` 占位 / versioning §7 行 / PLAN（当前版版本记录，verify-docs 强制）
- CI 构建 GitHub Release（exe/blockmap/**latest.yml**）→ 用户应用内自更新（更新页「设置 → 更新」）

### 阶段 7 · 收尾（完成即推送——AGENTS #60b）
1. **提交**：门禁全过后立即 `git commit`（一个 commit = 一个逻辑单元，Conventional Commits）
2. **推送**：`git push origin main`——远程是共享工作面，禁止改动滞留本地（push 前 `git status` + `git log origin/main..HEAD` 预览；被拒则 `git pull --rebase`）
3. **确认 CI**：push 触发 lint/test/build——CI 红 → push 者本人优先修
4. 汇报：完成内容 / 验证结果 / 需用户真机验证项
- **例外（不推）**：发布类 bump/tag/release（走 release.mjs 用户批准）；门禁未过的中间态/本地实验（不建 WIP 分支）

### 协作边界（全体协作者统一适用——任一 agent 实例均遵守同一授权门槛）
| 允许 | 禁止（需用户明确授权） |
|---|---|
| 代码 / 测试 / 文档 / 查证 / 调试 | 发布（release / tag / CI 操作） |
| 内存库与临时 UDATA 实验 | 真实用户库任何写操作 |
| 约束内的小型重构 | 升级锁定依赖 / 改 AGENTS 硬约束 / 删用户数据 |

## 3. 验证门禁（发布链路）

- `node scripts/verify-docs.mjs`：版本台账一致性（CHANGELOG 含 `## vX.Y.Z` 与 `[Unreleased]`、versioning §7 行、PLAN 记录、**onboarding 一致性检查组** §17）
- `pnpm test`（vitest，tests/ 目录，按版本命名 vXXXX.test.ts）
- `pnpm db:smoke`：数据库冒烟（7 项检查）
- 打包态等价验收（发版自动）：模拟 file:// Origin:null + token 跑 SSE 生成/导出/鉴权——PASS 才放行
- CI：build.yml 构建并上传 Release 资产（含 latest.yml）；commitlint 校验 Conventional Commits；**push 触发 lint/test/build**（完成即推送纪律的兜底——见 §2 阶段 7）

## 4. 仓库地图

```
electron/           主进程：main.ts（窗口/菜单/utilityProcess/safeStorage 加密/updater/shutdown）
server/src/         服务进程（Node 隔离）：routes/（~17 路由）services/（业务）db/（迁移+种子）prompts/
  services 关键文件：chapterGeneration/（章节生成域：state/persistence/postProcess/orchestrator——
                    generate.ts 已缩为兼容转发，公共签名不变）/ jobs/（job 域：repository/lifecycle/
                    payload/executors/scheduler/progress——jobQueue.ts 与 scheduler.ts 兼容转发；claim token 守卫见 D112/D113）
                    / director/（导演域：stages/checkpoint/artifacts/executors/pipeline——director.ts 兼容转发；
                    产物判定唯一事实源见 artifacts.ts）/ production/（生产域：chapterPolicy/progress/pipeline——
                    production.ts 兼容转发；批次决策见 chapterPolicy.ts）/ context（前缀冻结）
                    / llm（路由+降级+记账） / planner（导演 prompt 统一） / ledger（状态账本）
                    / scheduler / director / production / solutionRunner / debtFix / tripleReview
                    / retrieval（TF-IDF） / styleEngine / smartContext / constraintEngine
                    / settingBrief / webSearch / currency / keyCrypto / security
client/src/         React 19：pages/（~20 页）workspace/（工作台 8 面板）components/ editor/ utils/
shared/src/         前后端共享类型（@shared/types.ts，camelCase 契约——新增响应必须补类型，AGENTS #20）
tests/              vitest 单测（vXXXX.test.ts 按版本命名；143 基线）
scripts/            db-smoke / calibrate / e2e（round.mjs 全功能 + longbook.mjs 长书）/ release.mjs / verify-docs.mjs / v072-pack-verify.mjs
solutions/          方案包（mc-good2-0 市场包 / 帝路十章——写书方案）
site/               GitHub Pages 市场页
.github/workflows/  build.yml（Release 构建+latest.yml）/ commitlint.yml / pages.yml
resources/          图标与源文件
docs/               architecture / decision-log / versioning / CHANGELOG / test-report / audit-report / calibration-report / getting-started / README
```

## 5. 技术栈与硬约束摘要（详见 AGENTS.md 全文）

| 领域 | 约束 |
|---|---|
| 数据层 | **零原生依赖**：只用 `node:sqlite` 核心路径（prepare/get/all/run + exec BEGIN/COMMIT + timeout + WAL + FK）；禁用 SQLTagStore/自定义函数/applyChangeset/loadExtension（segfault 风险） |
| 版本锁定 | electron 43.3.0 / electron-vite 5 / vite 7.3.6（不可 8）/ react 19.2.8 / ts 5.9.3 / express 5.2.1 / zod 4.4.3 / openai 7.4.0 / @tanstack/react-query 5.101.4 / codemirror 6 / electron-builder 26.15.3；**禁 LangChain**（负资产） |
| 安全边界 | Express 仅 127.0.0.1 + 随机端口（dev=3000）；originGuard 白名单 + null-origin 强制 token；API Key 必须 safeStorage 加密（禁明文/禁日志）；打包态 CSP（index.html meta——webRequest 不拦 file://）；破坏性 IPC 校验 sender frame |
| 命名 | REST 全 camelCase 与 shared/types 对齐；禁 snake_case 直出 |
| 执行面 | 重型链路（导演/整本生产/修复）只走 job 表 + scheduler（1.5s 轮询单例串行，watchdog 超时）——API 只下发命令；重启幂等（running→queued + generating→planned 重置） |
| 结构化输出 | JSON 任务统一 extraction 路由（thinking off）；解析失败限次重试；max_tokens 截断检测；大 JSON 拆步 |
| 查证 | 外部 API/框架行为必须先上网查证官方文档，结论回 decision-log（D 系列） |
| 编码 | **禁止 PowerShell Set-Content 重写含中文源码**（破坏 UTF-8）——用 Write/Edit 工具或 UTF-8 脚本文件（教训②） |

## 6. 核心机制速览（意图层——实现细节以代码为准）

| 机制 | 要点 |
|---|---|
| **章节状态机** | planned → generating → written → reviewed → done / failed；原子抢占（NOT IN generating）；异常/空内容必复位 failed；重启重置 generating→planned |
| **生成链（SSE）** | `generateChapter` 流式 **直接落库**（content/word_count/status + ai_words 记账）——客户端脏检查会跳过 PATCH，**记账必须在服务端**（教训⑥）；abort 携带流内累积 |
| **上下文组装** | 冻结前缀区（系统提示→书级合约→世界观→角色账本→外部资料→约束→引导）hash 版本化 + 可变区（连续性状态→流派→三方会审→任务单→前文摘要）；预算守卫先裁可变区 |
| **三方会审** | 生成前主编/世界观/角色各一条约束（失败降级不阻塞，必须可见告警） |
| **质量债闭环** | 审核 <75 分 → 自动修复队列（patch_first 逐字匹配 → 整章重写；每章限 2 轮；同问题去重） |
| **回灌 + 记忆面** | 回灌提取角色状态/事实/伏笔 → ledger 账本（character.ledger_json.states，上限 100）+ 势力 currentState；章节页「记忆面」面板可手动增删（与 AI 回灌共用账本） |
| **创作约束** | novel.constraints_json 硬/软分级；硬约束全链注入（导演/方案/生成/修复）+ 主角名自动对齐（≥2 字 + 冲突保护前缀）；违反记录 quality_debt |
| **方案流水线** | solution.steps_json（agentId/role/stage/include/maxTokens/if）→ whole_book 逐章生产（outline→draft→final）；失败回退默认生成（可见告警）；if.field 已消费 |
| **导演** | runDirectorPipeline 多阶段（方向→设定简报→世界观→角色→卷→章）经 job 队列执行；resume 原子入队 |
| **成本记账** | usage_log 按 USD 计（PRICING 表查证自官方页）；显示层 ×汇率（启动自动获取 er-api，手动可覆盖）；月度预算预警（CNY 口径） |
| **联网查找** | 开关默认关；零 key Wikipedia（zh 优先/en 兜底，仅"无结果"才降级）；知识库一键导入；世界观生成可选注入；5s 超时 + 1h 缓存 |
| **自更新** | electron-updater（静态导入——动态 import CJS 有 interop 坑，教训④）；GitHub provider + latest.yml；打包态启用/开发模式跳过/便携版不支持 |
| **字数分离** | 累计语义：AI 产出服务端记账（生成/流水线/修复落库累加），人工输入客户端 delta（保存 PATCH 上报）；版本恢复不重复计 |

## 7. 数据模型要点

- 关键表：novel / volume / chapter / character（ledger_json 账本）/ world / beat / fact / foreshadow / kb_doc（**novel_id=0 = 全局占位**，全局文档对书可见）/ solution / agent / skill / agent_skill / model_route（**reserved 标记未消费路由**）/ provider（api_key_encrypted = safeStorage 密文）/ job（payload_json/result_json/trace 轨迹）/ usage_log / quality_debt / chapter_version / app_settings / prompt_asset / base_character（全局角色模板）
- 章节状态枚举：planned / imported / written / reviewed / done / failed（generating 为内部态，PATCH 不可手动置）
- job 类型：director / production / debt-fix（payload 含 novelId——查询必须 `json_extract(payload_json,'$.novelId')`）
- 幂等判定：以**产物落库**为准（非状态字段）

## 8. 环境变量（调试必知）

| 变量 | 用途 |
|---|---|
| `AI_NOVEL_USER_DATA` | 数据目录（server 启动必填） |
| `AI_NOVEL_PORT` | dev=3000；生产随机端口（port:0） |
| `SERVER_TOKEN` | null-origin 请求鉴权（打包态必设；未设时 null-origin 一律 403） |
| `ELECTRON_RENDERER_URL` | dev renderer 地址（electron-vite 注入） |
| `AI_NOVEL_DEBUG=1` | 三方会审日志 |
| `AI_NOVEL_ALLOW_PLAINTEXT=1` | **独立 server 调试模式**（非 utilityProcess 时允许明文 key——仅调试/验收） |
| `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD` | Windows 代码签名（可选；缺失仅告警） |

## 9. 测试规范

- 文件按版本命名：`tests/vXXXX.test.ts`（如 v0210.test.ts）
- 模式：`makeDb()`（内存库 + applyMigrations + seedIfEmpty）→ `makeApp()`（express + originGuard + json + **按真实应用前缀挂载路由**（如 `/api/novels`——Express 5 下裸 '/' 挂载 + 参数首段路由不匹配，教训③））→ `withServer()`
- 关键纯逻辑必配单测（planner 解析/状态机重置/约束引擎/记账 SQL 语义/汇率/联网开关等）
- 凭证纪律：e2e/校准用 OpenCode Go 网关 key（`~/.local/share/opencode/auth.json` 的 `opencode-go` 条目，端点 `https://opencode.ai/zen/go/v1`），不落盘不提交

## 10. 独立 server 调试模式（写书链路排障）

```powershell
# 模拟打包态（非 utilityProcess）——必须 AI_NOVEL_ALLOW_PLAINTEXT=1，数据用临时目录
$env:AI_NOVEL_USER_DATA = "$env:TEMP\ains-debug"
$env:AI_NOVEL_PORT = 0
$env:AI_NOVEL_ALLOW_PLAINTEXT = "1"
node out/main/server.js
```
- 只读真实库排查可用 `readOnly: true` 打开（绝不写）
- 修正真实库数据的脚本：先备份（复制 db）→ `applyMigrations` 补齐列 → 短事务写入 → 应用在跑时避免写入（SQLITE_BUSY）

## 11. 实战教训（务必知道——全部来自真实事故）

1. **真实用户库禁令**：`AppData\Roaming\ai-novel-studio\ai-novel-studio.db` 被用户应用独占；独立 node server 写库会以**明文 key 落库** → 用户应用 safeStorage 解密失败 → 全部 LLM 调用挂掉。生产/导演一律应用内执行；独立操作只读或临时库。
2. **PowerShell 中文编码**：**禁止 PowerShell 任何文本写入 cmdlet（`Set-Content` / `Add-Content` / `Out-File` / here-string 追加）写含中文的文档与源码**——统一用 Write/Edit 工具或 UTF-8 node 脚本（教训来源含真实反例：D90 曾用 Add-Content 追加产生 0x07 控制符损坏，verify-docs 现自动拦截此类损坏）。
3. **Express 5 挂载坑**：`app.use('/api', router)` + router 内以 `/:param` 开头的路由**不匹配**（404）——真实应用挂具体前缀（`/api/novels` 等）；测试挂载须对齐。
4. **动态 import CJS interop**：`import('electron-updater')` 解构 `{ autoUpdater }` 得 undefined（cjs-module-lexer 检测失败）→ 报"checkForUpdates undefined"——静态导入解决。
5. **Windows 信号**：`SIGTERM` 在 Windows 不触发（Node 官方文档确认）；SIGINT/SIGBREAK 可用；正常关闭走 shutdown 消息。
6. **SSE 生成直接落库**：客户端脏检查（text===saved）会跳过 PATCH → 会话 delta 丢失 → 记账必须在服务端落库点（ai_words 教训）。
7. **fetch 必带超时**：raw fetch 无超时会在网络异常时挂起（AI 操作/市场面板/汇率都踩过）——统一 apiFetch/AbortController.timeout。
8. **CSP 对 file:// 无效**：webRequest 不拦 file 协议——打包态 CSP 必须用 index.html meta。
9. **产物名与 latest.yml 一致**：nsis artifactName 必须固定（横线命名）——空格名产物 vs 横线元数据 → updater 404。
10. **零 key 端点**：汇率 er-api（rates.CNY）、联网 Wikipedia action API 实测可用；DDG Instant Answer 空结果弃用。

## 12. 危险操作清单（防误触）

- `wipe-data`（清空全部数据）/ 恢复备份 / 删除小说 / 清理任务 / 删除卷或章节——UI 均有确认，代码路径有 sender 校验；协作时这些操作需用户明示
- 发布（release/tag/CI）只在用户批准后执行
- 改 AGENTS.md 硬约束 / 升级锁定依赖——需用户批准

## 13. 发布流程速查

### 发布类型分层（v0.22.3 决议，AGENTS #57 / D97——消除"其他 agent 被 #57 拦住"的困惑）
| 类型 | 触发 | 处理 |
|---|---|---|
| **PATCH 修复** | `client/src\|server/src\|electron\|shared/src` 改动 → **CI release-readiness 强制 bump + 发布** | 合规路径：bump PATCH + CHANGELOG 段 → `pnpm release --push`（非"乱发版"） |
| **MINOR 功能批** | 功能批次完成 | bump minor → release --push（正常流程） |
| **MAJOR** | 1.0 判据达成 | 稳定承诺 |
| **免发版** | 仅 docs/scripts/tests 改动（CI 不拦） | 按 #60b 完成即提交推送，**不 bump** |

- **禁止**：无 CI 依据的 bump / 重复发版 / 仅文档改动 bump——这些才是 #57 要挡的"乱发版"
- **优先级**：CI release-readiness 硬约束 > 字面纪律（src 改了就必须发版，不要被"改动即发版不可取"拦住——那是过时语义）

### 流程
1. `pnpm release --bump=minor|patch --push`（或先手工 bump 后 `--push`）
2. 若 [3/7] verify-docs 失败 → 补台账：CHANGELOG 当前版本段 + `[Unreleased]` 占位、versioning §7 行、PLAN（当前版版本记录）→ 提交 → 重跑
3. [5/7] 本地 dist；[6/7] 提交 + tag 推送；[7/7] CI 构建 Release（等 5-10 分钟）→ `node scripts/release.mjs --release-notes-only` 补 Release body
4. 打包态等价验收 PASS 是放行门槛（release.mjs 自动跑，失败则修）
5. 用户应用内「设置 → 更新」自升级（差分 blockmap → 重启安装）

## 14. 当前状态与排期

- **写书（唯一真实书 #25「帝路十章」）**：卷 72 荒域初鸣——已产出 11 章（约 3.3 万字），**剩余 9 章**（#514/#517-524，failed 空）；卷 73-75（上界风云 25 章 / 黑暗前奏 25 章 / 荒古终章 24 章）共 **74 章待生产**。生产在用户应用内执行（绑定方案「帝路十章」id 1；硬约束：主角 Jing/双雄并肩/系统克制/版权边界）。
- **排期**：写书收官 → 按 1.0 判据评定（无排期中的新功能版本；功能请求以用户实际要求为准）。
- 写书期间每卷完成后用户抽读验收——你的任务常与写书支持相关（工具/数据/文档）。

## 15. 协作约定

- 中文交流；回答简洁（命令行界面）
- 先计划后执行；不确定必查证；改代码必验证（§2 阶段 4）
- 提交遵循 Conventional Commits（feat/fix/chore/docs/refactor/test）；提交是公开历史
- 不做超出任务范围的事；发现文档/代码不一致时回报并修正

### 多 agent 协作模式（等级相同，无主次）

- 用户可能同时运行多个 agent 会话（如：其他协作者与本会话并行/接力）——每个会话独立工作，经 git 提交与文档协作。
- **默认推送 main 是协作方式**（AGENTS #60b 完成即推送）：任务完成且门禁通过即 push——其他人基于最新代码工作；push 被拒（远程有新提交）→ `git pull --rebase` 保留双方意图。
- **提交前先 `git status`**：避免覆盖其他协作者未提交的工作；冲突时保留双方意图、向用户说明。
- **CI 红**：push 者本人优先修复（AGENTS #58/#60b）。
- **发现其他协作者的错误** → 如实回报用户并修复（范例：协作者指出 D90 写入损坏并修复 + 标注 D80-D89 不可恢复）。
- **被指出错误** → 承认、确认修复、**补机制防再犯**（范例：D90 损坏 → 教训②措辞升级 + verify-docs 控制字符检查，发布自动拦截）。
- **共享工作面**：docs/（onboarding/decision-log/CHANGELOG/versioning）、PLAN.md、AGENTS.md——谁改谁回写，§17 保鲜纪律适用全体。

## 16. 文档索引（何时读哪份）

| 文档 | 何时读 |
|---|---|
| 本文档 | 每次进场 + 任务开始 |
| AGENTS.md | 任何代码改动前（61+ 硬纪律） |
| PLAN.md | 了解当前状态/版本记录/遗留 backlog；历史编年史（P0-P30+ 清单）在 docs/archive/PLAN-history.md |
| docs/architecture.md | 理解进程模型/数据流/目录导览 |
| docs/decision-log.md | 查证结论与历史决策（D 系列）；新查证回填 |
| docs/versioning.md | 发版；1.0 判据；台账 |
| docs/archive/PLAN-history.md | 完整实施编年史（历史阶段清单/版本记录；需查历史时读） |
| docs/CHANGELOG.md | 各版本发布说明；发版时更新 |
| docs/getting-started.md / README.md | 用户向内容 |

## 17. 本文档维护规范（防过时机制——**适用全体协作者**，请严格遵守）

1. **单一事实源**：版本/命令/测试数以 package.json/scripts/实际输出为准——本文档只写"意图与上下文"，易变数字一律标注来源（如 `（以 pnpm test 为准）`）。
2. **变更驱动**：任何功能/机制/纪律变更，若触及本文档章节 → 同批回写（与 AGENTS #56 文档同步纪律一致）。
3. **新教训回填**：新的实战教训 → decision-log（D 系列）+ 本文档 §11（通用则入）。
4. **自验证锚点**：进场阶段 0 跑门禁时对照 §2/§3——数字不符即按上两条更新。
5. **发布守护**：verify-docs.mjs 含「onboarding 一致性」+「文档健康」（控制字符）检查组——发布时自动断言。
6. **更新责任**：任何 agent 在任务中改动机制/数字/纪律时，负责同步本清单（§15 多 agent 协作：谁改谁回写）。
