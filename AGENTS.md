# AGENTS.md — AI-Novel-Studio 实施约束

## 每次任务前必读
- **新 AI agent 进场先读 `docs/AI-AGENT-ONBOARDING.md`**（协作者手册：工作流/验证门禁/实战教训/协作边界——v0.21.0 起，verify-docs 守护其一致性）
- **先读 `PLAN.md` 对应阶段章节**，按清单勾选进度 `[x]`，完成后更新
- 每阶段结束必须跑：`pnpm typecheck` + `pnpm lint`
- **测试 Key 纪律（2026-08-09 起）**：所有 E2E/校准/连通性测试**优先使用 OpenCode Go 网关 key**（来源：`~/.local/share/opencode/auth.json` 的 `opencode-go` 条目；端点 `https://opencode.ai/zen/go/v1`，OpenAI 兼容）。校准脚本传参示例：
  ```powershell
  $auth = Get-Content "$env:USERPROFILE\.local\share\opencode\auth.json" -Raw | ConvertFrom-Json
  $env:DEEPSEEK_API_KEY = $auth.'opencode-go'.key
  $env:DEEPSEEK_BASE_URL = "https://opencode.ai/zen/go/v1"
  ```
  DeepSeek 官方 key（auth.json 的 `deepseek` 条目）仅作备用/对比（D7/D8 校准对比结论：官方直连质量略优，网关作多模型扩展）。

## 硬性约束（禁止违反）
1. **零原生依赖**：禁止引入 better-sqlite3 / sqlite-vec / Prisma / 任何需要 electron-rebuild 的包。数据层只用 `node:sqlite` + zod + 手写迁移。
2. **版本锁定**（已逐一验证，禁止随意升级）：electron 43.3.0、electron-vite 5.0.0、vite **7.3.6（不可用 8）**、react 19.2.8、typescript **5.9.3**、express 5.2.1、zod 4.4.3、**openai SDK（直连，7.x，安装时用 `npm view openai version` 锁定）**、@tanstack/react-query 5.101.4、zustand 5.0.14、codemirror 6.0.2、**epub-gen-memory 1.1.2（epub-gen 0.1.0 是 2019 死包，禁用）**、electron-builder 26.15.3、**lucide-react ^1.31.0（P11 引入，纯 JS 图标库）**。**禁止引入 @langchain/langgraph、@langchain/openai、@langchain/core**（审查结论：LangChain 对 DeepSeek 是负资产——reasoning_content 字段丢失 bug 未修，见 langchainjs #10883；改 openai SDK 直连）。
3. **pnpm 专用**：禁止 npm/yarn。`.npmrc` 已配 pnpm store 目录（本机示例：`store-dir=<你的磁盘根>\.pnpm-store`，按本机调整）+ electron 镜像。
4. **DeepSeek 参数合法性**（官方核实）：`reasoning_effort` 只有 low/high/max（无 medium）；**thinking 开启时 temperature/top_p/penalty 全部无效**；**V4 默认 thinking 开——非 thinking 路由必须显式传 `thinking:{type:'disabled'}`，否则温度无效且可能返回空 content**（D12 实测）；`thinking` 参数必须走 `extra_body`；**thinking 模式禁止强制 `tool_choice`**（会 400）；工具调用时 assistant 消息的 `reasoning_content` 必须**原样回传**否则 400（openai-node 无此类型，统一封装 `as any` 存取，不得用 LangChain 转发）。
5. **前缀冻结**：上下文组装固定序 = 冻结前缀区（系统提示→书级合约→世界观→角色账本）+ 可变区（任务单→前文摘要→RAG）。冻结区变更必须 hash 版本化。
6. **API Key 安全**：必须用 Electron `safeStorage` 加密后入库，禁止明文存储、禁止打日志。
7. **产品决策已锁定**（不可再问用户）：Electron 桌面应用 / 多供应商+任务路由 / 尽量完整复刻 / 先全 flash（pro 预留路由位）/ 整书直塞优先（1M 窗口，RAG 兜底）/ thinking 三层可调。
8. **执行面/控制面隔离（参考项目架构级教训）**：自动导演等重型链路必须跑在独立 Worker + 命令队列中，禁止在普通 API 请求内同步跑长链路；状态经轻量 projection 轮询暴露；SQLite 开 WAL。API 路由不得新增直接执行重型链路的入口。
9. **重启幂等**：任何长链路/批量任务必须幂等——重启/中断后恢复不得重复生成已完成章节、不得重复烧 token。验收必须包含"kill 后恢复不重复"验证。
10. **JSON 鲁棒性**：所有结构化输出（世界观/任务单/回灌/拆书）必须：解析失败自动重试（限次）、max_tokens 截断检测（截断即重试或拆步）、大 JSON 任务拆小步（世界观构建按章节/模块拆分）。禁止"AI 输出不完整 JSON 导致流程永久卡住"。
11. **循环熔断**：自动导演/重规划/修复必须有次数上限 + 决策路径去重（同类问题不重复处理），禁止 replan_required 确认后无限循环（参考项目 Issue #116）。
12. **章节名/章节数可定制**：章节名生成必须有多样性约束（禁止全四字），章节名与卷内章节数必须用户可改。
13. **新手优先**：首启向导 MVP（供应商选择→API Key→默认资源补全）必须在 P0 落地；任何设置页默认值必须"零决策可开写"。
14. **打包态早验证**：打包后 server 入口、资源路径、db 路径必须以应用目录为基准（app.getPath('userData')），P0 必须做打包冒烟，不拖到 P6。
15. **模型路由 fallback**：model_route 必须支持 fallback 链（主模型失败自动降级），usage_log 记录 degraded 标记。
16. **代码规范**：不写无关注释；文件命名与现有结构一致；新组件先看同类已有组件。
17. **调研-更新闭环（强制）**：实现中遇到技术阻碍或不确定的 API/参数，**必须先上网查官方文档核实（禁止凭记忆写）**；结论必须回写 PLAN.md（§12 技术决策日志或对应章节）后才能继续。每阶段验收前自查本约束是否违反。
18. **node:sqlite 使用纪律**（Electron 43 = Node 24.17，模块为 RC 状态）：**只用核心路径**——`prepare()` + `get/all/iterate/run` + `exec('BEGIN/COMMIT/ROLLBACK')` + `timeout` 选项（busy_timeout 默认 0 必须显式设置）+ `PRAGMA journal_mode=WAL` + `enableForeignKeyConstraints`；**禁用** SQLTagStore、自定义函数（database.function/aggregate）、applyChangeset/Session、loadExtension（这些有 segfault 级 open bug，见 nodejs/node #65149/#65102/#64795）。数据层必须封装 DAO 薄接口，隔离 DatabaseSync 细节，便于必要时切换。
19. **服务安全边界**：本地 Express 只监听 `127.0.0.1` + 随机端口（`port: 0`），禁止固定端口（dev 模式除外，AI_NOVEL_PORT=3000）；**CORS 必须用 services/security.ts 的 originGuard 白名单（P2.2 #1/D20）**：允许 `null`(file://) + localhost/127.0.0.1 任意端口 + dev 5173，其他 Origin 403；禁止全开 cors()；app 退出钩子必须 server.close + kill utilityProcess，禁止 Windows 孤儿进程。
20. **API 字段命名**：所有 REST API 返回统一 camelCase，与 shared/types 对齐；禁止 snake_case 直出（参考 D5 教训）。新增路由时必须核对客户端类型。
21. **结构化输出任务路由纪律**（D9）：所有要求 JSON 输出的任务（方向/世界/角色/卷/章节/细化/审核/修复/回灌）统一用 **extraction 路由**（thinking off + jsonMode 生效）；禁止用 thinking 路由跑 JSON 任务（D9 实测空输出/截断）。大 JSON 必须拆步（世界观 3 步、角色 2 批）。
22. **PowerShell 编码陷阱**（D10）：禁止用 PowerShell `Set-Content` 重写含中文的源码文件（会破坏 UTF-8）；一律用 Write/Edit 工具或 node 脚本（显式 UTF-8）。
23. **执行面隔离纪律**（P2/D16）：重型链路（导演/整本生产）只经 job 表 + scheduler 执行；API 只下发命令；scheduler 启动时必须重置遗留 running→queued（重启幂等）；阶段幂等以"产物落库判定"为准，不以状态字段。
24. **Creative Hub 工具调用**（D15）：chat 路由必须 thinking off（工具+thinking 会空 content）；assistant 消息回传必须含 tool_calls 字段（否则 400）；reasoning_content 同步回传；agent_session.agent_id 可空。
25. **P2.1 新增纪律**：
    - 角色状态写入统一走 `services/ledger.ts` 的 writeCharacterStates（手动与批量路径一致）
    - 导演/生产命令统一走 `services/jobQueue.ts`（enqueueDirectorJob 防并发），禁止直接调 runDirectorPipeline
    - 修复策略 patch_first：先 applyPatches（target 逐字唯一匹配）→ 失败降级整章重写
    - 导演 ready 的收尾逻辑放主循环 done 前（isStageDone 会拦截 runStage 内的 ready 代码，D18）
    - hub 系统提示用 buildHubSystemPrompt（动态书卡）
    - 每次改动跑 `pnpm vitest run`（现有 tests/patch.test.ts + tests/director.test.ts）
26. **job 匹配纪律**（P2.2 #3/D21）：job 表按 novelId 查询必须用 `json_extract(payload_json,'$.novelId') = ?`，禁止 `LIKE '%"novelId":N%'` 前缀匹配（12 vs 123 误伤）。
27. **章节生成并发守卫**（P2.2 #4/D21）：generateChapter 入口必须原子抢占 `UPDATE chapter SET status='generating' WHERE id=? AND status NOT IN ('generating')`，失败抛错；禁止无守卫直调。
28. **错误码语义化**（P2.2 #9/D22）：全局错误中间件 ZodError→400、SQLite 约束（FOREIGN KEY/UNIQUE/NOT NULL）→409、其余 500；禁止全 500。
29. **单测纪律**（P2.2/D19）：关键纯逻辑（applyPatches/isStageDone/上下文组装/前缀冻结 hash）必须配 vitest；改动对应模块必须跑 `pnpm vitest run`。
30. **死配置纪律**（P2.2 #7/D22）：新增 model_route task_type 必须被实际消费或标 `reserved: true`；新增表必须有读写路径（禁止空壳 schema 无注释）。
31. **公共 planner 纪律**（P2.2 #6/D22）：导演/规划类 prompt 与解析函数统一放 `services/planner.ts`，禁止在 routes/director 里重复内联同款 prompt；prompt 改动只改 planner。
32. **空内容保存保护**（P9 A1/D24）：章节正文保存前必须做空内容保护——服务端已有正文时，禁止以空内容覆盖或置 `written`；正文加载完成前禁用保存；`saveContent` 失败必须上抛（切章等调用方据此中断切换）。
33. **章节正文加载规范**（P9 A1/D24）：正文只经独立详情端点 `GET /:novelId/chapters/:chapterId` 按需加载；章节列表接口禁止携带 content；快速切章必须用序号/AbortController 丢弃过期响应；SSE 取消兜底必须携带流内累积内容（本地兜底，abort 后服务端事件收不到）。
34. **客户端操作防重规范**（P9 B1）：所有异步操作（生成/审核/修复/回灌/快照/入账/增删改/开关/发布/导出）必须 per-action busy 锁 + disabled（入口先检查 busy）；以 ChapterExecutionPage `withBusy`/generateBusyRef 为范本。
35. **发布闭环纪律**（P10 D26）：UI/导航/交互修复交付时，必须重新执行 `pnpm dist` 并验证新安装包（用户拿到的是安装包不是源码）；禁止"代码已修但未打包"状态交付。
36. **每次改动同步打包（用户强制，2026-08-10 起）**：**任何**代码改动（前端/后端/样式/修复/优化）完成后，必须执行 `pnpm dist` 同步重建 `release\AI-Novel-Studio Setup 0.1.0.exe`（NSIS）与 `release\AI-Novel-Studio-0.1.0-portable-x64.exe`（portable），确认两个产物时间戳已更新；打包失败视为改动未完成。
37. **IPC 竞态纪律**（P11-1.2/D28）：主进程 → renderer 的单向 `webContents.send` 消息（如 server-ready）在 renderer 未注册监听时发送会**静默丢失**——必须"主动拉取（invoke/handle）+ 缓存补发"双保险；renderer 侧关键启动链路加轮询兜底。

## 常用命令
- `pnpm dev`：开发（electron-vite 三端；dev 固定 AI_NOVEL_PORT=3000，浏览器直连调试）
- `pnpm typecheck` / `pnpm lint` / `pnpm test`（vitest run，tests/ 目录）
- `pnpm db:smoke`：数据库冒烟（7 项检查）
- `pnpm build`：三端构建；`pnpm dist`：NSIS 向导版 + portable 打包（release/）
- `pnpm calibrate`：模型参数校准（用 OpenCode Go 网关 key，见「每次任务前必读」）

## 项目结构
```
client/src/    React 渲染层：pages/（页面）、workspace/（工作台面板）、components/（通用）、editor/（CodeMirror 主题/选区工具）
server/src/    服务层：routes/（API）、services/（generate/context/llm/planner/ledger/jobQueue 等）、db/（迁移+种子）、prompts/
electron/      主进程：main.ts（窗口/菜单/utilityProcess/安全加密）
shared/        前后端共享类型（types.ts）
tests/         vitest 单测（director/patch/sse-abort）
docs/          校准报告 + P9 体验修复明细
```

## 用户环境
- Windows / PowerShell 5.1；Node v24.15.0；pnpm 由 corepack 激活；无全局 electron
- 测试凭证：OpenCode Go 网关 key（`~/.local/share/opencode/auth.json`，不落盘不提交）

41. **主题/外观纪律**（P13 F0/D36）：界面配色统一走 CSS 变量体系（4 套主题 / 深色 3 色 / accent 体系），窗口外观走 nativeTheme + titleBarOverlay + IPC theme-set；CodeMirror 主题与 CSS 变量保持一致。
42. **重试换模型纪律**（P13 G1/D37）：重试若指定 modelOverride 必须写入 job payload（重排队时 model_route 可能已变）；scheduler 构建候选时 override 优先于 fallback 链。

43. **代码签名纪律**（P14 C3）：electron-builder 打包 Windows 安装包需要 .pfx 证书——通过 `WIN_CSC_LINK`（文件路径/base64）与 `WIN_CSC_KEY_PASSWORD` 传入 `pnpm dist`；无证书时 electron-builder 仅告警，但用户侧可能被 SmartScreen 拦截/报毒。
44. **e2e 测试纪律**（P14 D）：发版前必须跑 `node scripts/e2e/round.mjs <n>` 至少 1 轮（T1-T4 全功能，opencode-go 网关 key 从 auth.json 读取不落盘）；所有 callLlmJson 的 prompt 必须含 json 字样（D41；json_object response_format 硬要求）；动态 import CJS 包在 utilityProcess 下要处理双层 default（D42）。
45. **图标/静态渲染纪律**（P16 P3/D45）：Playwright 中 `img` 加载 `file://` SVG/PNG 被 Chromium 拦截（导致全白截图）——渲染图形必须用内联 <svg> 元素或 data URI；应用图标源文件（SVG）必须入库 resources/icon-sources/。
46. **提示词资产纪律**（P17-5A/D50）：新增或修改系统提示词必须走 prompt_asset（sys_* ），禁止新增 SYSTEM_* 代码常量；提示词工作台编辑后删除 invalidatePromptCache。
47. **检索后端接口纪律**（P17-5B/D51）：知识库检索统一走 Retriever 接口（TfidfRetriever 默认 / EmbeddingRetriever 预留）；新后端实现接口不侵入上下文组装逻辑；引入 embedding 供应商时在设置页切换后端。
48. **备份恢复纪律**（P18 B/D54）：备份 = 复制 db 三件套到目录（含 backup-info.json）；恢复必须校验 db 存在 → 替换 → 退出；恢复/清除前必须 ConfirmDialog。
49. **角色模板纪律**（P18 D1/D55）：模板库统一走 base_character 表；应用到书 = INSERT character（roster），重名 409；不往书内 character 直接写模板。
50. **证据回溯纪律**（P18 D2/D56）：拆书类生成任务的结论必须带章节证据引用（{summary, evidence[{chapterId, quote}]}）；prompt 注入章节编号、quote 逐字约束、解析器校验 chapterId；旧格式数据降级兼容。

## P21 创造工坊纪律 / 智能体资产化（v0.21.0（审查 P3 LOW）：乱码注释重编码，按残留片段与代码行为重建）

51. **版本发布纪律**：docs/versioning.md 定 SemVer 规则（MINOR=新功能 / PATCH=修复）；发版 = bump package.json + tag vX.Y.Z + push tag；CI 校验 tag==version；禁止 force tag / 重复 tag；发布走 GitHub Release（versioning.md §6）。
52. **方案步骤纪律**（P21）：方案步骤 = solution 的 steps_json（agentId/role/stage/include/maxTokens/if）；stage 仅限 post_generate/review/whole_book；步骤引用的智能体必须存在；方案执行统一走 hub/runner。
53. **Feelfish 导入纪律**：agent md 解析 YAML frontmatter（name/description/tools/skills）；导入去重——agent 按 name，skill 按 name + novel_id=0 判定已存在。
54. **方案生成纪律**：/solutions/generate 必须走 callLlmJson + schema 校验 + 限次重试；长任务超时按 90s 处理；降级时记录 degradedReasons。

55. **发布流程纪律**：版本发布必须走 `pnpm release`（scripts/release.mjs，含 versioning.md §3 校验），禁止手动改版本/tag；发布前必须执行 `pnpm dist`（产物在 release/），发布走 GitHub Release。
56. **文档同步纪律**：功能/修复/版本变更同步更新 docs/README.md；重大变更记入 CHANGELOG.md / PLAN.md / decision-log.md；发版必须同步 CHANGELOG。**v0.21.0 起：机制/纪律/教训变更若触及 `docs/AI-AGENT-ONBOARDING.md` 章节（§6/§8/§11/§14）必须同批回写**（onboarding 保鲜纪律，verify-docs 守护存在性与锚点）。

57. **发版纪律**：仅正式发布/里程碑在 main 上 bump 并执行 `pnpm release --push`；"改动即发版"不可取——release/ 产物 = 正式交付，变更必须记入 PLAN/decision-log。
58. **CI 纪律**：CI 失败必须本地复现修复，禁止用 if: false 跳过流程或静默吞错。

59. **默认模型纪律**：默认主模型为 **deepseek-v4-flash**；新模型必须先校准对比（k3/pro/glm/gpt 等）再启用；e2e/校准/演示链路统一用 flash。

60. **提交规范（开放仓库）**：commit 遵循 Conventional Commits——feat/fix/docs/refactor/test/chore/ci 等类型 + scope 可选（如 feat(p30)）；破坏性变更必须标注 BREAKING CHANGE 页脚；PR 由 CI 检查（.github/workflows/commitlint.yml），本地不装钩子；commit 是公开历史，禁止空描述、禁止裸 commit 内容。

61. **每批开工前查证纪律**：每个批次开工前，对涉及的外部依赖/API/框架行为先上网查证（官方文档优先），查证结论与来源记入 decision-log；无外部依据的本地设计决策也要显式标注「本地设计」。禁止凭印象实现关键机制（历史教训：Node close 语义、SDK 重试叠加均为查证发现的认知修正）。

61b. **文档断言纪律**（D87 教训）：docs 更新必须断言验证——脚本化 replace 后 grep 命中目标串，失败即报错；版本台账（versioning §7）每次发布必须同步且与 CHANGELOG 逐条核对；发布前跑 node scripts/verify-docs.mjs（release.mjs [3/7] 已内置）。
