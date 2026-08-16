# ???????D1-D35?2026-08-09 ~ 2026-08-10?

> ? PLAN.md ?12 ?????P13 ????????????????PLAN.md ????????????????????

## 12. 技术决策日志（调研-更新闭环的落点）

> 规则：遇到技术阻碍/不确定点时，先上网调研核实（官方文档优先），把结论记在这里（或更新对应章节），再继续实现。按时间倒序。

### D1 · 2026-08-09 · 技术栈成熟度深度审查（证据：两个并行调研 agent 抓取的官方文档/仓库/issue）

**结论总览：方案链成熟可行，2 个依赖需替换，3 条使用纪律需遵守。**

| 项 | 结论 | 证据 |
|---|---|---|
| Electron 43 内嵌 Node | **Node 24.17.0**，node:sqlite 无需 flag | releases.electronjs.org/release/v43.0.0；electron/electron#45532（2025-02 关闭：上游 22.13/23.4 起无 flag） |
| node:sqlite 历史回归 | 37.2.0 唯一坏版（No such binding: sqlite），已修并 backport 到 36/37/38 分支 | electron/electron#47671（confirmed）、#47706（merged 2025-07-15）；Windows 有专门符号冲突 patch |
| node:sqlite 稳定性 | **RC（Stability 1.2）**；segfault 级 bug 全集中在 SQLTagStore/UDF/Session/loadExtension | nodejs.org v24.x sqlite 文档；nodejs/node#65149/#65102/#64795（open） |
| **→ 纪律** | **只用核心 API**（prepare/get/all/run/iterate + exec 事务 + timeout + WAL + FK），封装 DAO 薄层；禁用 SQLTagStore/function/aggregate/Session/loadExtension | 已写入 AGENTS.md 约束 18 |
| utilityProcess | **GA 稳定**，仅 `error` 事件标 Experimental；electron-vite 官方支持 `?modulePath` fork | electronjs.org/docs/latest/api/utility-process；electron-vite 文档 |
| Express 5 + SSE 于 utilityProcess | 常见成熟模式；坑：固定端口冲突、renderer CORS（file:// origin）、asar 路径、退出清理 | gist/reddit/stackoverflow/juejin 实践；**→ 纪律见 AGENTS.md 约束 19** |
| electron-vite 5.0.0 | 成熟（5.6k stars，2025-12 发布稳定 8 个月，6.0 beta 中），vite ≤7 限制确认 | github.com/alex8088/electron-vite |
| **@langchain/openai → 弃用** | DeepSeek thinking+工具调用 400 bug 未修（#10883），dist 无 reasoning_content 处理（#11111 PR 未合），官方主推 SDK 直连 | langchainjs#10883/#11111/#10954 |
| **→ 改 openai SDK 直连** | baseURL 指各供应商；self-manage messages；reasoning_content `as any` 存取；thinking 走 extra_body；禁强制 tool_choice | 已写入 AGENTS.md 约束 2/4 |
| zod 4.4.3 | 正式版稳定（4.0 于 2025-07），有 `/v3` 逃生通道 | registry.npmjs.org/zod |
| codemirror 6 / react-query 5 / zustand 5 | 全部稳定活跃 | npm registry |
| **epub-gen 0.1.0 → epub-gen-memory 1.1.2** | epub-gen 是 2019 死包（依赖全 2018 前）；社区 fork 修复且 API 兼容 | registry.npmjs.org/epub-gen（7.5 年未更新）；github.com/cpiber/epub-gen-memory |
| electron-builder 26.15.3 | 稳定；Electron 43 x64 有真实构建成功案例；绕开 `nsis.oneClick:false + perMachine:true` 组合（#10022） | electron-builder#10022/#10006/#10032 |

**影响**：版本锁定表已更新（AGENTS.md 约束 2）；§2 技术栈表已更新；DeepSeek 纪律已补充到 §3.1。

### D2 · 2026-08-09 · 参考项目审查修订（10 项）
见 §0.1 修订表（LangGraph 弃用、执行面隔离、重启幂等、JSON 鲁棒性、循环熔断、章节名定制、新手优先、打包态早验证、流派资产、路由 fallback）。

### D3 · 2026-08-09 · @vitejs/plugin-react 6.0.5 与 vite 7 不兼容
- **问题**：构建报 `Package subpath './internal' is not defined by "exports"`（plugin-react 6.0.5 的 dist 引用 vite/internal，而 vite 7.3.6 无此导出）
- **证据**：npm peerDependencies — plugin-react 6.x 要求 vite ^8；5.2.0 支持 ^4.2||^5||^6||^7||^8
- **决策**：锁 plugin-react **5.2.0**（vite 7.3.6 配套）

### D4 · 2026-08-09 · utilityProcess 调试与固定端口
- **问题**：dev 模式下 utilityProcess 内 server console 输出默认不可见，初判"启动即退出"（实为日志缺失误判）
- **决策**：
  1. `utilityProcess.fork` 加 `stdio: 'inherit'` 使 server 日志可见（便于排障）
  2. dev 模式（有 ELECTRON_RENDERER_URL）用 `AI_NOVEL_PORT=3000` 固定端口，浏览器直连调试；打包态用随机端口（port 0）+ IPC 上报，符合约束 19

### D5 · 2026-08-09 · API 字段命名统一为 camelCase
- **问题**：server 返回 snake_case（has_key/provider_id），客户端类型为 camelCase（hasKey/providerId），UI 显示"未配置 Key"误报
- **决策**：API 层统一映射为 camelCase 再返回，客户端零适配；新增/修改路由返回格式必须与 shared/types 对齐（写入 AGENTS.md 检查清单）

### D6 · 2026-08-09 · DeepSeek 参数校准实测结论（v1）
- **实验**：fixed 前缀（书级合约+世界观+角色账本）+ 都市异能第一章任务单；6 组合 × 2 次取均值；评分=字数达标 40% + 反AI 20% + 标题合规 20% + 耗时 20%
- **结果**（docs/calibration-report.md）：
  - off@0.7 0.959 / off@0.9 0.948 / thinking-max 0.924 / thinking-high 0.921 / off@1.1 0.910 / thinking-low 0.706（标题不合规）
  - 成功率 100%；成本各组合无显著差异（~$0.0011/次）
- **应用**：prose = thinking off + 温度 0.7（已写库 + seed 同步）；thinking 组合对正文无增益（反AI词 ≥1）→ 保持「正文 thinking off」路由策略
- **关键发现**：章节名约束对 thinking-low 失败（标题不合规）→ P1 提示词资产需加「章节名多样性 + 格式强制」约束（修正 #6 依据）

### D7 · 2026-08-09 · API Key 来源核实与 OpenCode Go 网关（修订）
- **结论（实测）**：
  - opencode-go 是 DeepSeek 官方模型的网关代理，端点 `https://opencode.ai/zen/go/v1`（OpenAI 兼容），**实测连通 OK**
  - 用户手打 key（sk-juSg8... / sk-HOqy9...）对官方端点 401（不是 DeepSeek 直连 key）；**sk-HOqy9... 对网关端点 200 有效**（用户确认用这个）
  - 本机 `~/.local/share/opencode/auth.json` 存有有效 key：`deepseek`（官方直连）+ `opencode-go`（网关）
- **应用**：设置页新增"导入 OpenCode Go 网关"按钮（读 auth.json → 存为供应商，baseURL 指向网关）；官方直连与网关可共存
- **经验**：key 属于哪个供应商必须连通性验证后再用；opencode auth.json 是 key 来源之一

### D8 · 2026-08-09 · 网关校准对比（官方直连 vs opencode-go）
- **结果**（docs/calibration-report-gateway.md vs docs/calibration-report.md）：
  - 官方直连最佳 **off@0.7 评分 0.959**（2313 字，反 AI 0）；网关最佳 **off@1.1 评分 0.931**（2285 字，反 AI 1）
  - 两路成功率均 100%；成本相当（~$0.001/次）
- **决策**：正文默认走**官方直连**（质量更优）；网关作多模型扩展（glm/gpt/grok/kimi 一个 key 全通），路由可在设置页手动切换
- **遗留**：网关对 thinking 参数透传已验证（thinking-low/high/max 均可用）；网关非 DeepSeek 模型（glm 等）参数行为需按需再校准

### D9 · 2026-08-09 · 结构化输出任务统一走 extraction 路由（thinking off）
- **问题**：规划类 JSON 任务（方向/世界观/角色/卷/章节）最初走 planning 路由（thinking on high），实测出现：模型输出空 content（thinking 全在 reasoning_content）、大 JSON 截断（characters 3085 字符处损坏）
- **根因**：thinking 模式下 `response_format: json_object` 不生效（DeepSeek 官方约束），模型输出不稳定
- **决策**：所有结构化 JSON 输出任务（directions/framing/macro/world/characters/volumes/beats/chapters/refine/review/fix/backfill）统一用 **extraction 路由**（thinking off + 温度 0.2 + jsonMode 生效）；thinking 保留给审核 review 深度推理（但 review 也走 JSON → 已改 extraction？NO——review 保留 thinking on，经测试成功）
- **进一步**：角色生成分两批（核心 4-6 + 扩展 3-5），世界观分 3 步（手册/势力/地图），章节清单 max_tokens 8192——全部防大 JSON 截断
- **验证**：端到端 15 步全部通过

### D10 · 2026-08-09 · PowerShell 写文件编码陷阱
- **问题**：`Set-Content -Encoding UTF8`（PowerShell 5.1）会把 UTF-8 无 BOM 文件按系统 ANSI 读取后重写，破坏中文（`${` → `�?{`）
- **教训**：禁止用 PowerShell 重写含中文的源码文件；一律用 Write/Edit 工具（UTF-8 精确）；需要批量替换时用 Edit 或 node 脚本（UTF-8 读写）

### D11 · 2026-08-09 · P1 端到端验收记录（novelId=6）
- 章节名实测：记忆的涟漪 | 家族秘辛 | 血色现场 | 追踪溯源 | 警探疑云 | 紫砂壶的秘密 | 夜幕追杀 | 师父的遗书（多样 ✓）
- 正文 1120 字，审核 82 分，回灌 2 角色状态 + 4 事实 + 4 伏笔
- 待确认区：4 事实 + 10 角色（AI 生成角色全部进 pending，确认后才入册 ✓）

### D12 · 2026-08-09 · DeepSeek V4 thinking 默认开启——off 必须显式 disabled（重大）
- **发现**：官方文档"Thinking mode is enabled by default"；实测：不传 thinking 字段 + 温度 0.7 → 返回空 content + reasoning_content（thinking 模式，温度被忽略）；SSE 出现 1409 个 thinking 事件
- **修复**：`thinking: {type:'disabled'}` 显式关闭 → 无 reasoning_content、content 正常、温度生效
- **影响**：P0 校准的"off"组合实际是 thinking 模式（温度无效，结果靠随机性）→ 需重校准
- **结论**：所有非 thinking 路由（prose/extraction）必须显式 disabled；审核/修复/回灌/规划等 JSON 任务统一 extraction（thinking off + jsonMode 生效）

### D13 · 2026-08-09 · 校准 v2（真正 off 模式）
- **结果**（docs/calibration-report-v2.md）：thinking-max 0.966 / off@0.9 0.955 / off@0.7 0.959 / off@1.1 0.936 / thinking-high 0.942 / thinking-low 0.925
- **决策**：prose 路由保持 thinking off + 温度 0.9（与 max 差距小，成本/延迟更低）；thinking 保留给导演/深度推理任务
- **备注**：与 D6 的差异源于"假 off"（D12）——之前 off@0.7 的 0.959 是 thinking 模式的随机结果

### D14 · 2026-08-09 · 审核/修复路由任务类型修正
- review 路由最初 thinking on（D9 遗留）→ E2E 出现空 content（thinking + jsonMode 不生效）→ 改 extraction（thinking off + jsonMode 生效），E2E 审核 85 分通过
- fix 路由同样改 extraction + maxTokens 8192（输出完整正文 JSON）

### D15 · 2026-08-09 · Creative Hub 工具调用链路修复
- **问题 1**：chat 路由 thinking on → 工具调用场景 content 空（D12 同根因）→ chat 路由改 thinking off（seed+DB+前端预设同步）
- **问题 2**：agent_session.agent_id NOT NULL + FK 约束 → 迁移 v3 改为可空（RENAME 重建表，保留数据）
- **问题 3**：buildBody 未回传 tool_calls 字段 → "role 'tool' must be a response to preceding message with 'tool_calls'" 400 → LlmMessage 加 toolCalls + buildBody 序列化（含 reasoning_content 回传，D1 硬约束）
- **验证**：hub 对话"问进度"→ 自动调用 novel_status+director_status 工具 → 结构化中文回复 ✓

### D16 · 2026-08-09 · 重启幂等验证（修正 #3 落地）
- **发现**：kill 后重启，遗留 running job 卡死无法 resume（409）
- **修复**：scheduler.startScheduler 启动时 `UPDATE job SET status='queued' WHERE status='running'`
- **验证**：novelId=11 在 framing 阶段 kill → 重启 → 自动续跑 → done；章节 18 个（3 卷×6 章）重复标题 0；方向 2 套未重复生成 ✓

### D17 · 2026-08-09 · 导演状态机关键决策
- 阶段产物落库判定（isStageDone）而非 checkpoint 状态字段——重启后以数据库真实产物为准，天然幂等
- 可重试错误（JSON 解析失败/429/503/超时/配额）自动重试（限 3 次）；不可重试 → failed + blockingReason + resumeAction
- supervised 模式每阶段完成后 paused，resume 从下一阶段继续（非重跑）

### D18 · 2026-08-09 · P2.1 优化包（🔴4 项正确性 + 🟡6 项质量 + 🟢2 项体验）
见 P2.1 里程碑清单（每项带实测证据）。关键实现细节：
- **ready 阶段陷阱**：isStageDone 检查会在 runStage 前拦截，自动确认逻辑放 runStage 不生效 → 移到主循环 done 前直接执行
- **局部补丁降级链**：patch（target 逐字唯一匹配）→ 失败降级整章重写 → 修复失败记质量债务
- **hub 工具走 job 表**：enqueueDirectorJob 带防并发（同书 queued/running 拒绝）

### D19 · 2026-08-09 · 单测补充
- tests/patch.test.ts：applyPatches 5 用例（唯一匹配/不存在/非唯一/空/多 patch）全过
- vitest 命令：`pnpm vitest run`（P0 §9 质量要求落地）

### D20 · 2026-08-09 · P2.2 安全边界（CORS 白名单 + Origin 校验）
- **问题**：`app.use(cors())` 全开 + 无鉴权 → 任意网页可 fetch 本地 API（读小说/烧额度/覆盖 key）
- **修复**：services/security.ts originGuard——允许 `null`(file://) + `http://localhost:*`/`127.0.0.1:*` + dev 5173；其他 Origin 403；移除 cors 依赖
- **权衡**：浏览器直连调试保留（dev 5173 白名单）；Electron 打包态 file:// origin=null 放行

### D21 · 2026-08-09 · job 匹配 json_extract + 章节并发守卫
- `payload_json LIKE '%"novelId":N%'` 前缀误匹配（12 vs 123）→ `json_extract(payload_json,'$.novelId')=?`（5 处）
- generateChapter 原子抢占 `status NOT IN ('generating')`，防同章并发双写/双倍费用

### D22 · 2026-08-09 · 抽公共 planner service（防漂移）
- director.ts 9 阶段与 routes 500+ 行重复（同 prompt/同解析）→ services/planner.ts 统一 prompt+解析函数
- director.ts 全部改调 planner；routes 后续可迁移（当前已工作，渐进式）
- 附带：keyCrypto 明文回退告警+超时、ZodError→400、resume 保留 chaptersPerVolume、usage 记账统一

### D23 · 2026-08-09 · 测试 Key 纪律（用户指定）
- **决策**：以后所有 E2E/校准/连通性测试**优先使用 OpenCode Go 网关 key**（auth.json 的 opencode-go 条目 + `https://opencode.ai/zen/go/v1` 端点），已实测连通 OK
- **理由**：用户要求；网关 key 免去直连官方 key 的管理，且可测试 GLM/GPT/Grok/Kimi 等多模型路由
- **写入**：AGENTS.md「每次任务前必读」；校准脚本环境变量模板已提供
- **备注**：DeepSeek 官方 key 保留备用（D8 结论：官方直连正文质量略优，网关作扩展与测试主力）
- director.ts 9 阶段与 routes 500+ 行重复（同 prompt/同解析）→ services/planner.ts 统一 prompt+解析函数
- director.ts 全部改调 planner；routes 后续可迁移（当前已工作，渐进式）
- 附带：keyCrypto 明文回退告警+超时、ZodError→400、resume 保留 chaptersPerVolume、usage 记账统一

### D24 · 2026-08-10 · 章节正文独立详情端点（方案 B，P9 A1）
- **问题**：章节列表接口不含 content，客户端切章编辑器永远空白，失焦/Ctrl+S 把空内容写回并置 written（数据丢失）
- **方案对比**：A 列表带 content（一个请求免竞态，但列表膨胀——几十章×几千字每开执行页拉全书）vs B 独立 GET 详情（按需加载，与"服务端查库取正文"一致，可扩展）
- **决策**：方案 B——`GET /:novelId/chapters/:chapterId`；saveContent 空内容保护（服务端有正文时禁止空覆盖/置 written）；切章竞态用序号丢弃过期响应
- **写入**：AGENTS.md 纪律 32/33

### D25 · 2026-08-10 · SSE 取消保留内容（方案 B2，P9 A2）
- **问题**：abort 后客户端停止读取，服务端带内容的 aborted 事件永远收不到，本地兜底回调写死 `content:''` → 取消即清空已生成文本（与按钮文案矛盾）
- **决策**：api.ts 流内累积 accumulated，abort 两处兜底携带累积内容（wordCount=字符数）；服务端 aborted 事件正常收到时仍为权威
- **验证**：tests/sse-abort.test.ts（mock fetch 流 + abort）2 项通过
- **写入**：AGENTS.md 纪律 33

### D26 · 2026-08-10 · 发布闭环纪律（P10 反思 1）
- **问题**：设置页返回按钮修复后未立即重新打包，用户安装包仍为旧版 → "修了但用户拿不到"
- **决策**：任何 UI/导航/交互修复，交付时必须以**重新打包的安装包**为准；`pnpm dist` 产物作为交付物验证（PLAN.md P10 起执行）
- **写入**：AGENTS.md 纪律 35

### D27 · 2026-08-10 · UI 美观 = 表面 + 信息架构（P10 反思 2，kimi 五图评审）
- **问题**：P8 令牌解决"表面"后仍觉不美——根因是**信息架构**：无流程状态、无推荐动作层级、空状态无引导
- **决策**：三步走（P10 落地）——① 7 步流程导航显性化 + 完成度徽章（detail 端点加 7 项计数）；② 每屏一个"当前推荐"主行动，次级分区折叠；③ 空状态引导 + 状态色语义化
- **参考**：AI-Novel-Writing-Assistant（984 commits）的流程组织法：步骤导航带状态、全局任务条、元信息卡片、批量操作入口

### D28 · 2026-08-10 · 启动竞态修复（P11-1.2，IPC 消息丢失）
- **问题**：utilityProcess 的 `server-ready` 消息在 renderer 注册 `onServerReady` 前发出 → 消息丢失 → baseUrl 永远 null → 用户卡"正在启动本地服务…"（实测 ≥1 分钟）
- **决策**：三重兜底——① main 缓存 `lastServerUrl` + `did-finish-load` 补发；② preload 暴露 `getServerUrl()`（ipcMain.handle）；③ renderer 侧 health 轮询（127.0.0.1:3000，30 次 × 2s）
- **写入**：AGENTS.md 纪律 37（IPC 消息必须防竞态：主动拉取或缓存补发）

### D29 · 2026-08-10 · 全局侧栏架构（P11-2，学参考项目 Sidebar）
- **决策**：引入 lucide-react（纯 JS 图标库，零原生依赖 ✓）+ AppLayout（数据驱动 navGroups 三组：创作/资产/系统；激活指示条；折叠持久化 localStorage）；书级项从 URL 解析 novelId，无书时禁用；书级页面保留工作台步骤 rail（双导航模式）
- **理由**：主界面"左边什么都没有"——参考项目分组侧栏让用户始终知道去哪/在哪

### D30 · 2026-08-10 · 流派自定义 API（P11-3）
- **决策**：`GET/POST /api/genres`（genre_asset 表；novel_id IS NULL=全局预设，非空=书级自定义；name 去重 409）；SetupPanel select 动态加载 + 内联创建并自动选中
- **理由**：用户"流派不能自己加入"；现有表已有但无 API、前端硬编码 6 个

### D31 · 2026-08-10 · 无边框标题栏（P12 B3，调研确认）
- **证据**：Electron 43 官方 Custom Title Bar 教程——`titleBarStyle:'hidden'` + `titleBarOverlay:{color,symbolColor,height}`（Windows/Linux 保留原生窗口按钮）+ `app-region:drag` 拖拽区 + `env(titlebar-area-x/width/height)` 安全区 + `user-select:none` 防误选 + 拖拽区禁用自定义右键菜单
- **决策**：按官方推荐实现（非 frame:false 自绘按钮，保留原生最小化/最大化/关闭）

### D32 · 2026-08-10 · tokenizer 选型 gpt-tokenizer（P12 C2/D1，调研确认）
- **证据**：gpt-tokenizer（niieani）纯 TypeScript、浏览器同步可用、cl100k_base/o200k_base、countTokens/estimateCost、微软 Teams/Kibana 使用——符合零原生依赖纪律
- **决策**：客户端用 cl100k_base 近似估算；单价用 usage_log 历史均价校准（setPriceCache），无历史时保守默认

### D33 · 2026-08-10 · 批量细化防重与续跑（P12 A4）
- **决策**：refine-range 幂等判定 = goal_json 已含完整任务单（purpose 非空）则跳过；中断后重跑从缺失章续接（延续纪律 9/23 产物落库判定）
- **写入**：AGENTS.md 纪律 40

### D34 · 2026-08-10 · 质量降级链补全（P12 C1，防重复烧 token）
- **决策**：fix 超过 2 轮上限 → 登记 quality_debt（severity high，含问题签名）不再自动重写；fixHistory 存 signature（前 3 问题摘要），同签名上一轮无效 → 直接登记债务拒绝重试
- **理由**：参考项目 qualityLoopLedger 理念（同类问题不反复烧 LLM）

### D35 · 2026-08-10 · 共享类型收敛（P12 C4）
- **决策**：client/types.ts 小说域类型全部迁入 shared/src/types.ts，client 端 re-export（`export * from '@shared/types'`）；新增路由返回格式继续与 shared 对齐（纪律 20）

### D36 · 2026-08-10 · P13 F0 多主题
- feat: v0.2.0 完整生产链 + 多主题 + 任务中心 + 资产体系 + CI
- 6 套主题（墨蓝默认 / FeelFish 绿 #101010+#00a060 / 紫夜 / 深海青 / 琥珀 / 纸张）CSS 变量 + data-theme + localStorage 持久化
- Electron nativeTheme.themeSource + prefers-color-scheme 联动；IPC theme-set；titleBarOverlay；CodeMirror 变量化；initTheme() 启动即应用；AGENTS 纪律 41
- 代码锚点: client/src/utils/theme.ts:36 initTheme；electron/main.ts theme-set + nativeTheme.themeSource

### D37 · 2026-08-10 · P13 G1 换模型重试
- feat: v0.2.0 完整生产链 + 多主题 + 任务中心 + 资产体系 + CI
- retry 端点写 payload.modelOverride；llm.ts setActiveModelOverride 活动覆盖（buildCandidates 纯函数，override 优先、原模型降级）；scheduler 单例注入
- 任务中心重试下拉选模型；degraded/fallback 链路；单测 model-override
- 代码锚点: server/src/routes/automation.ts:74 "P13 G1：支持 model 换模型重试"；server/src/services/llm.ts:176 setActiveModelOverride

### D38 · 2026-08-10 · P13 G2 精准角色筛选
- feat: v0.2.0 完整生产链 + 多主题 + 任务中心 + 资产体系 + CI
- getCharactersForChapter：任务单人名匹配名册 + 主角保底 + 回退全量 → 可变区「本章角色特写」
- 冻结区不动，缓存纪律保持（按 hash 版本）；引用 D6 缓存判定
- 代码锚点: server/src/services/context.ts:233 getCharactersForChapter；:589 "P13 G2：本章角色特写"

### D39 · 2026-08-10 · P13 文档重组
- feat: v0.2.0 完整生产链 + 多主题 + 任务中心 + 资产体系 + CI
- 决策日志外移 docs/decision-log.md（D1-D35，PLAN §12 留链接）；P9/P11/P12 明细合并 docs/optimization-log.md
- AGENTS.md 纪律更新；PLAN §12 收敛
- 代码锚点: docs/optimization-log.md（P9/P11/P12 明细）；PLAN.md P13 章节

### D40b · 2026-08-11 · P19 设置持久化（app_settings + jsonSafe + token hash）
- feat: P19+P20 引导系统/写作偏好/全面审查修复（v0.2.2）
- 新增 app_settings 表（key/value），设置项/写作偏好/token 持久化于此
- token 经 jsonSafe 处理 + hash（不明文落盘）
- 代码锚点: server/src/routes/settings.ts:398 SELECT key,value FROM app_settings；:416 INSERT…ON CONFLICT；server/src/services/jsonSafe.ts

### D41b · 2026-08-11 · P19 写作偏好 / 4 级定位段
- feat: P19+P20 引导系统/写作偏好/全面审查修复（v0.2.2）
- 两级引导注入（书级 novel.guidance 持久化 + 单次引导不持久化）；4 级定位段（约 600 字）
- 写作偏好应用级 app_settings，随生成注入冻结区（未偏离默认返回空串省 token）
- 代码锚点: server/src/services/guidance.ts:19 "P19：写作偏好（应用级 app_settings）"；:46 渲染规则块

### D42b · 2026-08-11 · P19 已完成任务清理（DELETE /jobs/done）
- feat: P19+P20 引导系统/写作偏好/全面审查修复（v0.2.2）
- DELETE /jobs/done：清理已完成任务；running 任务保护
- 前端 confirm 二次确认
- 代码锚点: server/src/routes/automation.ts:41 router.delete('/jobs/done')

### D43b · 2026-08-11 · P20 S2 备份原子性（wal_checkpoint TRUNCATE）
- feat: P19+P20 引导系统/写作偏好/全面审查修复（v0.2.2）
- 备份前 server 执行 PRAGMA wal_checkpoint(TRUNCATE)（WAL 落主库）保证备份原子；utilityProcess 不直接碰 db（避 Windows 文件锁）
- data-restored 事件通知 renderer；getDataDir() 统一目录（AppData/portable/data）
- 代码锚点: server/src/index.ts:116 wal_checkpoint(TRUNCATE)；electron/main.ts:235 "P20：请求 server 执行 wal_checkpoint"；:346 data-restored

### D44b · 2026-08-11 · P20 M1/C10 scheduler 看门狗
- feat: P19+P20 引导系统/写作偏好/全面审查修复（v0.2.2）
- job 记 started_at；tick 1.5s 巡检；running 无进展超 30min 标 failed（abort 在途 LLM）
- 章节边界 isJobAborted 自检后停止写库；cancelled/failed 归 done
- 代码锚点: server/src/services/scheduler.ts:89 "watchdog: job stuck without progress for 30min"；:91 started_at < -30 minutes

### D45b · 2026-08-11 · P20 C5/C6 上下文裁剪保序
- feat: P19+P20 引导系统/写作偏好/全面审查修复（v0.2.2）
- trimFromEnd：按 markers 优先级从尾部裁剪至 budget，保序不破坏冻结区
- 可变区/冻结区分裁剪（head/tail）；超长不报错只截断
- 代码锚点: server/src/services/context.ts:135 trimFromEnd；:632/:647 variableText/frozenText 裁剪

### D46b · 2026-08-11 · P20 D2/D7 知识库检索
- feat: P19+P20 引导系统/写作偏好/全面审查修复（v0.2.2）
- TfidfRetriever（bigram + TF-IDF 余弦，零依赖）默认；status='direct' 文档注入冻结前缀区
- kbCache 按书 + 内容版本缓存；无相关不注入省 token
- 代码锚点: server/src/services/context.ts:298 kbCache；:294 "P17-5B：知识库检索（TF-IDF）"；:6 import TfidfRetriever

### D47b · 2026-08-11 · P20 M3 循环熔断 + 唯一约束
- feat: P19+P20 引导系统/写作偏好/全面审查修复（v0.2.2）
- director 循环熔断：replanCount 上限 + 决策路径去重；超限停；decisions 去重
- characters/volumes/beats/chapters 名称唯一约束（novel, name/title）
- 代码锚点: server/src/services/director.ts:77 replanCount；:820 checkpoint.replanCount += 1；server/src/db/migrate.ts:20 UNIQUE

### D48b · 2026-08-11 · P20 C2/C8 成本归一
- feat: P19+P20 引导系统/写作偏好/全面审查修复（v0.2.2）
- 精确匹配失败落 DEFAULT_PRICING（虚高 3.5~35 倍）→ 归一为精确 + 前缀匹配
- estimateCost/estimateTokens 统一入口；abort/失败补账 usage
- 代码锚点: server/src/services/usage.ts:24 DEFAULT_PRICING；:27 "虚高 3.5~35 倍"；client/src/utils/costEstimate.ts:42 estimateCost

### D49b · 2026-08-11 · P20 S1 CORS null Origin 防护
- feat: P19+P20 引导系统/写作偏好/全面审查修复（v0.2.2）
- file:// iframe Origin 为 "null" 被拒 → null Origin 亦需 X-App-Token
- main 生成 SERVER_TOKEN（randomBytes 32 hex）；preload sendSync 同步取；renderer 不含 token；dev/localhost 放行
- 代码锚点: electron/main.ts:14 SERVER_TOKEN；:33 get-server-token returnValue；electron/preload.ts:5 sendSync

### D50b · 2026-08-11 · P20 M4 审校三岗并行落库
- feat: P19+P20 引导系统/写作偏好/全面审查修复（v0.2.2）
- 审校三岗并行：Promise.allSettled + 60s 整体超时，部分失败降级不毁端
- 角色顾问 OOC 检测 45s 超时；结果落 chapter.review_json（INSERT OR IGNORE 防重）
- 代码锚点: server/src/routes/agents.ts:282 Promise.allSettled；:276 "60s 整体超时"；:346 "45s 超时"；:417 review_json

### D51b · 2026-08-11 · P20 M5 hub 会话锁 + 工具超时
- feat: P19+P20 引导系统/写作偏好/全面审查修复（v0.2.2）
- hub 整体 180s（HUB_TIMEOUT_MS）；工具调用 150s（TOOL_TIMEOUT_MS）
- pendingMutation 改队列（多写工具提案互不覆盖）；in-flight abort
- 代码锚点: server/src/services/hub.ts:348 TOOL_TIMEOUT_MS=150_000；:346 HUB_TIMEOUT_MS=180_000；:480 pendingMutation 队列

### D56b · 2026-08-11 · P21-1 智能体/方案/技能资产化
- feat: P21 创造工坊（方案/技能/智能体资产化 + Feelfish 导入兼容）（v0.3.0）
- 迁移 v9：agent 增 description/body_md/skills_json/is_custom；solution 增 steps_json；solution_version 版本表
- 步骤 stage：post_generate/review/whole_book；agent_skill 挂载；primaryAgentId；include/maxTokens/if 条件；Feelfish solution.json 兼容
- 代码锚点: server/src/db/migrate.ts:350 skills_json / :351 body_md / :352 is_custom；:372 steps_json；:362 agent_skill

### D57 · 2026-08-11 · P21-3 方案执行器（whole_book 预留）
- feat: P21 创造工坊（方案/技能/智能体资产化 + Feelfish 导入兼容）（v0.3.0）
- solutionRunner 执行器 + 逐步产出；whole_book 步当时明确报错（P21 预留，未实现）
- hub 暴露 run_solution 工具（动态 import solutionRunner）；每步/整体超时
- 代码锚点: server/src/services/solutionRunner.ts:132 "whole_book：整本模式（P21 预留接口）"；server/src/services/hub.ts:265 run_solution

### D58 · 2026-08-11 · P21-5h AI 生成方案（POST /solutions/generate）
- feat: P21 创造工坊（方案/技能/智能体资产化 + Feelfish 导入兼容）（v0.3.0）
- POST /solutions/generate：AI 按需求生成方案（3-8 步）
- schema 约束 agentId/步骤/stage；生成后可编辑
- 代码锚点: server/src/routes/solutions.ts:149 router.post('/solutions/generate')

### D59 · 2026-08-11 · P21-4 方案市场 Provider
- feat: P21 创造工坊（方案/技能/智能体资产化 + Feelfish 导入兼容）（v0.3.0）
- MarketProvider 抽象 + LocalDirectoryMarket 默认 + registerMarket 注册
- 本地目录读 solution.json / agent md（YAML frontmatter）；Feelfish 兼容
- 代码锚点: server/src/services/solutionAssets.ts:219 MarketProvider；:229 LocalDirectoryMarket；:244 registerMarket

### D60 · 2026-08-11 · P23 资产库统一建设
- feat: P23 资产库统一建设 + 全缺口修复（v0.5.0）
- 统一资产创建器（九库：上传 TXT/MD/EPUB + 粘贴 + 手动 → AI 草稿 → 编辑 → 保存）
- POST /assets/extract 文本→AI 草稿；外部书容器 v10 novel.is_external + import/book
- vitest 45/45（+3 分章）
- 代码锚点: server/src/routes/assets.ts:67 /assets/extract；:250 is_external=1；server/src/db/migrate.ts:392 is_external

### D61 · 2026-08-11 · P22-C8 PowerShell/emoji GBK 乱码修复
- feat: P22 字体系统 + 排版 + 体验优化（v0.4.0）
- PowerShell/emoji 在 GBK 下成 "?"（6 处乱码）
- EmptyState icon 改 lucide（替代 emoji）；edit/write 强制 UTF-8
- 注：lucide 化/UTF-8 实际修复落 P23（commit 9a8a319「修复 P22 编码事故」）
- 代码锚点: client/src/components/EmptyState.tsx（lucide）；commit 9a8a319

### D62 · 2026-08-11 · P23 全缺口修复（N1-N10，含生成引导输入）
- feat: P23 资产库统一建设 + 全缺口修复（v0.5.0）
- 10 项缺口修复：章节手建/卷手建/guidance 生成引导输入/工坊技能与删除/提示词新建与出厂还原/AgentPanel 下拉/死按钮等
- generation guidance（生成引导输入）= N4：世界观/角色生成前可输入要求
- 代码锚点: client/src/workspace/WorldPanel.tsx:32 "P23（N4）：生成引导输入"；commit 9a8a319

### D63 · 2026-08-11 · P25 UI 打磨
- feat: P25 UI 打磨（工具类/内联收敛/状态动效/版本号单一来源）
- index.css 工具类（间距栅格/文本层级/圆角阴影/布局辅助）；内联样式收敛 849→585（33 文件）
- 状态反馈：button/list-item :active 按压、hover 过渡、panel hover 提亮；badge 语义变体
- 代码锚点: client/src/index.css（+76 行工具类）；commit 12f1608「内联样式收敛 849→585」

### D64 · 2026-08-11 · P25 版本号单一来源
- feat: P25 UI 打磨（工具类/内联收敛/状态动效/版本号单一来源）
- 侧栏硬编码 v0.2.0 与 package.json 0.5.0 不一致 → vite define __APP_VERSION__（npm_package_version）
- renderer 统一读 __APP_VERSION__；versioning §3.1
- 代码锚点: client/src/env.d.ts（__APP_VERSION__ 全局声明）；commit 12f1608

### D65 · 2026-08-11 · 0.5.1 CI 规范补强（pages 停用）
- chore: 0.5.1 规范补强（合入门禁/红叉清理/pages 停用）+ P25 文档
- 13 次 CI run 中 6 次失败（workflow YAML/版本校验）；版本校验改独立脚本
- Deploy Site（GitHub Pages）configure-pages 权限不足 3 连败 → pages.yml if: false 停用；versioning §3.2 + AGENTS 58
- 代码锚点: .github/workflows/pages.yml:27 if: false；:3 "P25：停用自动触发"

### D66 · 2026-08-11 · 0.5.2 安装包体积修复
- chore: 0.5.2 安装包体积修复（@fontsource 转 devDeps 343→136MB）
- v0.5.1 包 343MB（解压 114MB）；app.asar 335MB，node_modules @fontsource 占 207MB
- @fontsource 字体资源移入 client/assets 由 vite 打包；改 devDependencies
- 代码锚点: package.json devDependencies（@fontsource）；commit ae40d95

### D67 · 2026-08-11 · P26 规范机制补强
- chore: P26 规范机制补强（release-readiness CI/发布自动验证/回滚§8/--bump/audit+Dependabot/--e2e/PR模板）
- release-readiness CI（src 变更触发 bump 检查/发布文档/签名验证）；release.mjs [7/7] gh run watch + release view
- versioning §8 --bump；CI 跑 pnpm audit --prod --audit-level=high + Dependabot weekly；--e2e（round.mjs R1）；PR 模板
- 代码锚点: scripts/release.mjs；commit c3eb728；c435cf0 adm-zip 漏洞 override>=0.6.0

### D68 · 2026-08-11 · P27 UX 强化（快捷键/命令面板/专注模式）
- feat: P27 UX 强化（快捷键自定义/命令面板/专注模式/乱码清零/prompt 替换/界面字体/任务浮层）
- 快捷键自定义（localStorage 持久化）+ 全局 keydown 路由 onShortcut；Ctrl+K 命令面板（6 命令）
- 专注模式；界面字体；任务浮层；Help 页快捷键说明
- 代码锚点: commit 6166840（onShortcut/命令面板）

### D69 · 2026-08-11 · P27 0b window.prompt bug 修复
- feat: P27 UX 强化（快捷键自定义/命令面板/专注模式/乱码清零/prompt 替换/界面字体/任务浮层）
- Electron window.prompt 返回 null（不支持）→ 新建/删除/重命名等受阻
- PromptDialog（输入+确认+Esc/遮罩）替换；invalidate 复位；统一 ConfirmDialog
- 代码锚点: client/src/components/ConfirmDialog.tsx；commit 6166840

### D70 · 2026-08-11 · P28 图标重制（k3 羽笔星光）
- feat: P28 图标重制（k3 羽笔星光 + 透明背景修复）+ 模型成本纪律 AGENTS 59
- kimi-k3 多模态评审 8 稿选 k3-icon-05；sharp 处理 SVG→RGBA PNG
- 透明背景修复（alpha=0 像素）；electron-builder ico 转换；模型成本纪律 AGENTS 59；deepseek-v4-flash 验证
- 代码锚点: scripts/gen-icons.mjs:48 k3-icon-${index}；resources/ SVG 源

### D71 · 2026-08-11 · P29 Agent 体系补全
- feat: P29 Agent 体系补全（智能体库页/技能挂载/内置资产化）+ 测试 50/50
- 智能体库页（AgentPanel）：查看/编辑 body_md+description/挂载 agent_skill/内置/自定义；5 内置 agent 种子
- solutionRunner 合并 agent_skill + skills_json（body 拼入）；whole_book 步；测试 50/50
- 代码锚点: server/src/services/solutionRunner.ts:80 "技能挂载（agent_skill + skills_json）"；:84 SELECT join；client/src/workspace/AgentPanel.tsx

### D72 · 2026-08-11 · P30 章节生产流水线
- feat: P30 章节生产流水线（方案接力生成正文，v0.7.0）+ 测试 52/52
- 参考 Feelfish mc-good2.0；stage='whole_book' 方案接力产出正文（outline/draft/dialogue/scene/review/final）
- runProductionChapter 逐章执行；novel.current_solution_id（v13 迁移）绑定生产方案；production pipeline 过滤；测试 52/52
- 注：commit b4c2d73 作者日期 2026-08-12（标题日期 08-11 为受损文件原值）
- 代码锚点: server/src/services/production.ts:80 current_solution_id join；:82-85 whole_book 步解析；server/src/db/migrate.ts:415 current_solution_id

### D73 · 2026-08-11 · P30 真机修复（0.7.1）
- fix: P30 真机修复（正文类步骤纯文本输出 + Feelfish 导入 key）+ mc-good2.0 验收通过（0.7.1）
- mc-good2.0（Feelfish 方案）真机 9/10 通过；callLlmJson 改 JSON 输出后 3 步异常
- 正文类步骤（draft/scene/dialogue/final）改 callLlm 纯文本；第 10 步 final 27 字异常修复
- import-feelfish 导入 agent + key；Feelfish agent id mc-xxx 映射；11857 字/138s
- 代码锚点: server/src/routes/solutions.ts:285 /solutions/import-feelfish；:348 引用键冲突映射

### D74 · 2026-08-12 · 0.7.2 发布阻断修复
- fix: v0.7.2 发布阻断修复（SSE/导出 token + 生成收尾防重复 + 删书取消 job）+ 审查记录
- 4 批审查（P30 正确性/LLM 调用/前端/Electron）+ 8 项 P0 + 6 项（SSE/导出 403、production zod）
- SSE/导出 token 修复；生成收尾防重复（contentSettled + cancelled 兜底）；删书取消 job
- v0.7.2 修 3 项；4 轮测试 56/56
- 代码锚点: commit e2ac795；server/src/routes/chapters.ts（SSE）

### D75 · 2026-08-12 · Node24 SSE 回归（0.7.3）
- fix: Node24 SSE 回归（req close 语义）+ 打包态等价验收脚本（v0.7.3）
- 0.7.2 修复后 SSE 生成被自己 abort（context/delta/done 全吞、0 字产出）
- Node 24 IncomingMessage 'close' 在请求体读完即触发（行为变更）；req.on('close') 误判
- 改 res.on('close')+writableEnded 判定；aborted 事件；403 修复
- 代码锚点: server/src/routes/chapters.ts:139 "Node 24 的 IncomingMessage 'close'…req.on('close') 会让 SSE 生成被自己立即 abort"；:143 writableEnded

### D76 · 2026-08-12 · 审查批2 P30 正确性（0.8.0）
- feat: 审查批2 P30 正确性（production schema/任务单保序/原子抢占/JSON_FORMAT/watchdog/吞错日志）+ 测试 64/64（v0.8.0）
- #2 production schema（stepSchema + 字段校验）；whole_book 步解析改 parseSolutionSteps（正则误判修复）；#4 trimFromEnd 保序
- #5 runProductionChapter status 置 generating/failed + produce-chapter 409；#7 JSON_FORMAT prompt 含 json；#8 watchdog updated_at 30min + isJobAborted；console.warn 吞错
- vitest 64/64（+8）
- 代码锚点: server/src/services/scheduler.ts:91-92 watchdog 30min；:86 isJobAborted；server/src/routes/agents.ts:8 JSON_FORMAT

### D77 · 2026-08-12 · 审查批3+4（0.9.0）
- feat: 审查批3+4（错误收敛/Electron 加固/signal 超时/绑定校验/reviewRounds/smartContext 增量/客户端收敛）+ outline JSON 健壮性修复 + 测试 73/73（v0.9.0）
- A：错误收敛（ApiError）；Electron sandbox+will-navigate；safeStorage；framing 404/status 校验
- B：kbCache hash+LRU；callLlm signal+withTimeout abort；zombie 消除；current_solution_id 校验；429 读 Retry-After（上限 30s）；buildBody smartContext
- C/D：fetch 取消；HubChat abort；estimateTokens；PromptDialog TimeoutError；health getServerUrl；getWorld map/timeline；automation TOCTOU；outline JSON 超 4096；vitest 73/73
- 代码锚点: server/src/services/llm.ts:172 RETRYABLE_STATUS；:339 "429 优先读 Retry-After"；:226 maxRetries；server/src/services/context.ts:298 kbCache LRU

### D78 · 2026-08-12 · 开放仓库准备（0.9.1）
- chore: 开放仓库准备（敏感清理/License+健康文件/CHANGELOG 迁移/README 开源化/commitlint CI）（v0.9.1）
- 选 MIT；敏感清理；Feelfish 引用脱敏
- 社区文件 6 件：LICENSE(MIT)/CONTRIBUTING/CoC(2.1)/SECURITY/ISSUE_TEMPLATE(2)；package.json repository
- release-notes.md→CHANGELOG.md（git mv + Keep a Changelog + Unreleased）；commitlint CI；README badge/Why/FAQ + getting-started + Diátaxis
- 代码锚点: LICENSE/CONTRIBUTING.md/CODE_OF_CONDUCT.md/SECURITY.md；.github/workflows/commitlint.yml:12

### D79 · 2026-08-12 · 批A 路线图收尾（0.9.2 → 0.14.0）
- feat: 批A（O1 发布自动验收/O2 双 LLM 路径合并/O3 e2e 门禁/O4 每日自动备份）（v0.9.2）
- 第二轮审查 O1-O5 + I1-I5 路线图：A v0.9.2 / B v0.10.0 / C v0.11.0 / D v0.12.0(P31) / E v0.13.0 / F v0.14.0
- A v0.9.2：发布自动验收/双 LLM 路径合并/e2e 门禁/每日备份；pages.yml if:false 停用
- 代码锚点: commit ea3d9a9；注：CHANGELOG v0.9.3-v0.14.0 段亦损坏，非可靠来源

### D80 · 2026-08-12 · 查证收尾（补查 4 项 + D75 勘误）
- fix: 查证收尾（D80 补查 4 点/D75 勘误/AGENTS 查证纪律/SDK maxRetries 防重试叠加）（v0.9.3）
- Node IncomingMessage 'close' 行为变更自 v16.0.0（socket 空闲触发）；D75「Node24 专属」勘误为 v16+ 普遍；res.on('close')+writableEnded 判定；'aborted' 事件 v17+
- stream_options.include_usage（OpenAI 末块 usage chunk）；openai-node err.status/err.headers 经 RequestOptions 透传
- SDK 默认自动重试 2 次（429/408/409/>=500）与候选链 tryCount 3 叠加→显式 maxRetries:1；SQLite INSERT...SELECT WHERE NOT EXISTS 幂等；AGENTS §61 查证纪律
- 代码锚点: server/src/services/llm.ts:226 "v0.9.3（D80）：SDK 默认自动重试 2 次…叠加"；:228 maxRetries:1；:232 tryCount<=3

### D81 · 2026-08-12 · 批B（O5 成本预警月度预算 + I2 质量债自动修复闭环）
- feat: 批B（O5 成本预警月度预算 + I2 质量债自动修复闭环，开关默认开+显性 UI）（v0.10.0）
- 参考 Anthropic Building Effective Agents「evaluator-optimizer」；「higher costs, potential for compounding errors, appropriate guardrails」→ 设护栏
- O5：月度预算（cost_monthly_budget app_settings 默认 0）+ 预警 + 用量统计；承接 P12 C1 质量债 + D34 自动重试链
- I2：quality_debt 自动修复闭环；开关默认开 + 显性 UI
- 代码锚点: server/src/db/migrate.ts:172 quality_debt；:423 ('cost_monthly_budget','0')；server/src/routes/chapters.ts:66 INSERT OR IGNORE quality_debt

### D82 · 2026-08-12 · GitHub Pages 方案市场（A 面查证）
- feat: 批C（solution-pack 方案包 + GitHub 仓库方案市场 + 红叉清理）（v0.11.0）
- 2026-08-10 起 GitHub Pages 部署失败（#5833018423）；A 面查证 gh api DELETE deployments
- A/B 方案对比；GitHub 仓库方案市场（raw.githubusercontent.com，CORS）
- pages.yml 已 if:false 停用（承接 D65）
- 代码锚点: .github/workflows/pages.yml:27 if: false；commit 8f7494a

### D83 · 2026-08-12 · 批C npm manifest 校验（name+version 一致 / kebab id / description+tags）
- feat: 批C（solution-pack 方案包 + GitHub 仓库方案市场 + 红叉清理）（v0.11.0）
- npm package.json 规范（docs.npmjs.com）：name+version 唯一标识
- name 小写 kebab-case（URL 安全，≤214 字符）；description/keywords→description+tags；license/author 可选
- GitHub solutions/ 目录 + index.json + raw.githubusercontent.com（CORS）
- 代码锚点: scripts/publish-solution.mjs:38 "D83：name+version 唯一标识、小写 kebab-case id"；:44 kebab 校验

### D84 · 2026-08-12 · 批C solution-pack 方案包（kind/id/version/metrics/sampleBook）
- feat: 批C（solution-pack 方案包 + GitHub 仓库方案市场 + 红叉清理）（v0.11.0）
- solution-pack 格式：kind/id/version/metrics/sampleBook；solution 唯一 id + hash
- GitHub solutions/ + index.json + raw 发布；scripts/export-market-pack.mjs 生成；publish-solution.mjs 发布
- mc-good2.0 v1.0.0（10 步）样例
- 代码锚点: scripts/export-market-pack.mjs:1 "v0.11.0（批C）：生成市场方案包"；:123 solution-pack.json；server/src/services/solutionAssets.ts:282 kind:'solution-pack'

### D85 · 2026-08-12 · UI 体验修复（智能体删除 / 乱码清零 / 空状态引导卡片）v0.11.1
- fix: UI 体验修复（智能体删除/乱码清零/空状态引导卡片）（v0.11.1）
- 智能体删除：agents.ts DELETE /:id；内置不可删 409 + json_each 方案引用检查 409 + agent_skill 级联
- 乱码清零（3 处 EmptyState）
- 空状态引导卡片：StudioPage 6 option→10；Titles/BaseCharacters/BookAnalysis 3 页空态
- 代码锚点: server/src/routes/agents.ts:130 409 内置；:134-138 json_each 引用检查；:148-149 级联删除

### D86 · 2026-08-12 · 批D P31 方案感知卷章（卷章定位注入整本生产）
- feat: 批D P31 方案感知卷章（卷章定位注入整本生产流水线）（v0.12.0）
- P30 缺「卷章定位」；whole_book buildChapterWriteContext 注入 chapterPositionBlock
- services/chapterRole.ts：getChapterPosition（卷/章/序/总数/前后章）→ chapterPositionBlock
- runProductionChapter prompt 注入；卷章定位提示（避免「章节定位不明/角色无锚点」）
- 代码锚点: server/src/services/chapterRole.ts:17 getChapterPosition；:66 chapterPositionBlock

### D87 · 2026-08-12 · 批D 补查（文档断言 verify-docs + versioning 台账）
- feat: 批E 世界状态机（势力状态+时间线消费）+ 文档补救（verify-docs 机制/versioning 补齐）（v0.13.0）
- P31 补查：chapterRole + prompt 注入；mc-good2.0 验证 3 处；outline/vitest 92/92；Release v0.12.0
- 文档断言：versioning.md §7 标记 v0.5.0 误标 0.4.0；A-D 8 处 docs replace；release.mjs vitest 校验
- verify-docs.mjs 断言机制（批E 引入）
- 代码锚点: scripts/verify-docs.mjs（断言机制）；commit 1e2c504

### D88 · 2026-08-12 · 批E 世界状态机（势力状态 backfill + 时间线消费）I4
- feat: 批E 世界状态机（势力状态+时间线消费）+ 文档补救（verify-docs 机制/versioning 补齐）（v0.13.0）
- 参考 MemGPT/Letta；SQLite 累积状态（character.ledger/foreshadow/fact/timeline_event/world.factions）
- timeline_event 结构化（chapter_id 关联）；factionStates backfill → factions_json.currentState
- 5 轮验证；production 消费；release.mjs [3/7]；versioning §7（0.5.0→0.13.0）；承接 D87
- 代码锚点: server/src/db/migrate.ts:22 factions_json；:92 timeline_event；:341 idx_timeline_event_novel

### D89 · 2026-08-12 · 批F 风格指纹（Stylometry 文体计量学）I5
- feat: 批F 风格指纹（Stylometry 统计提取，零 LLM）+ release 发布后 versioning 自动标记（v0.14.0）
- 参考 Wikipedia Stylometry；writer invariant（平均句长）+ 句长方差/短句占比/对话占比
- computeStyleFingerprint 零 LLM 统计提取；fingerprintDescription 文本化；POST /style/fingerprint；style_asset 持久化
- Number 归一（如 16.6 字/短句 40%/长句 24%）；O1-O5 + I1-I5 收尾
- 代码锚点: server/src/services/styleFingerprint.ts:25 computeStyleFingerprint；:81 fingerprintDescription；server/src/routes/style.ts:42

### D90 · 2026-08-13 · 写书实战教训总汇（30 万字项目沉淀 · 回填自协作者会话）

> 来源：AI-Novel-Studio 30 万字真实写书项目（书 #25「帝路十章」）实战事故复盘；已同步 docs/AI-AGENT-ONBOARDING.md §11。

- **① 真实用户库禁令**：AppData\Roaming\ai-novel-studio\ai-novel-studio.db 被用户应用（utilityProcess）独占；独立 node server 以非 utility 模式写库 → safeStorage 无法解密 → **明文 API Key 落库** → 用户应用内全部 LLM 调用失败（"生成失败，详情见服务端日志"）。结论：真实库生产/导演一律应用内执行；独立操作只读（readOnly:true）或临时 UDATA；修正脚本先备份 + applyMigrations + AI_NOVEL_ALLOW_PLAINTEXT=1（仅调试）。
- **② PowerShell 中文编码**：Set-Content / node -e 内联中文 → UTF-8 破坏（乱码/?，字节 0x3f 证实）；中文输入必须经 Write 工具或 UTF-8 脚本文件。仓库曾出现 mojibake（shared/types.ts 注释，v0.21.0 已重编码）。
- **③ Express 5 挂载坑**：app.use('/api', router) 且 router 内路由以 /:param 开头 → 404（path-to-regexp v8 行为）；真实应用挂具体前缀（/api/novels 等）；测试 makeApp 挂载必须对齐真实前缀。
- **④ 动态 import CJS interop**：import('electron-updater').then(({autoUpdater}) => ...) → autoUpdater undefined（cjs-module-lexer 命名导出检测失败）→ "Cannot read properties of undefined (reading 'checkForUpdates')"。结论：主进程静态导入 CJS 包。
- **⑤ Windows 信号**：Node 官方文档确认 'SIGTERM' is not supported on Windows（可监听不触发）；SIGINT（Ctrl+C）/SIGBREAK（Ctrl+Break）可用；优雅关闭走 shutdown 消息（server.close + stopScheduler）。
- **⑥ SSE 生成直接落库 → 记账必须在服务端**：generateChapter 流式直接 UPDATE content/word_count；客户端脏检查（text===saved）跳过 PATCH → 会话 delta 丢失 → 字数分离恒 0。结论：AI 产出计数在服务端落库点累加（v0.21.0 N1）。
- **⑦ fetch 必带超时**：raw fetch 网络异常挂起（汇率/市场面板/联网搜索都踩过）——统一 apiFetch（AbortSignal.timeout）/显式 AbortController。
- **⑧ CSP 对 file:// 无效**：webRequest.onHeadersReceived 不拦 file 协议 → 打包态 CSP 必须用 index.html <meta http-equiv="Content-Security-Policy">。
- **⑨ 产物名与 latest.yml 一致**：nsis 默认 artifactName 含空格 vs latest.yml 元数据横线名 → updater 404；固定 artifactName: "AI-Novel-Studio-Setup-."。
- **⑩ 零 key 端点实测**：汇率 open.er-api.com（rates.CNY）✓、联网 Wikipedia action API（zh 优先）✓；DuckDuckGo Instant Answer 空结果弃用；百度 403 / Bing HTML 被关键词淹没不可用。
- **⑪ 教训② 升级（D90 自身反例，2026-08-14）**：本条目最初用 PowerShell `Add-Content` + here-string 追加写入 → 产生 0x07 控制符损坏（`app.use`/`artifactName` 首字符被破坏）+ `node -e` 丢字（由协作者发现并修复）。**结论：PowerShell 任何文本写入 cmdlet（Set-Content/Add-Content/Out-File/here-string）写含中文内容一律禁止**——统一 Write/Edit 工具或 UTF-8 node 脚本；verify-docs 已加「核心文档无 ASCII 控制字符」检查（发布自动拦截同类损坏）。


### D91 · 2026-08-13 · 进场验证：db-smoke 过期期望 + 乱码不可恢复结论（AI 协作者）

- **db-smoke 2 项失败均为过期期望（非产品缺陷，已修复）**：① 迁移版本硬编码 5（实际已到 v20）→ migrate.ts 导出 SCHEMA_VERSION 动态断言；② 回滚检查期望 novel count=0，但 seed 含 `__global__` 占位行（novel_id=0 全局资产）→ 改为「回滚后与插入前一致」。复现验证：BEGIN/INSERT/ROLLBACK 实际生效，“回滚失败”为基线误判。
- **乱码不可恢复（字节级证实）**：PLAN.md P18-P30 / §12 早期记录、decision-log D36-D89 的中文被有损替换为字面 0x3F；git 历史中 P18 段（54103e6 首次引入）与 D36（更早）即已乱码——损坏早于提交（PowerShell 编码事故，见教训②）。处理：banner 标注 + 标题按提交信息重建，正文要点以 git 提交信息与已发布代码为准。
- **顺带修复**：README 测试数过时（101→148，单测 73→148、db-smoke 6→7 项）；tests/p29.test.ts 7 处乱码描述重建（依据测试体）；D90 两处 0x07 控制符损坏（app.use / artifactName）与 “node -e” 丢字。

### D92 · 2026-08-14 · v0.22.0：N1 字数覆盖语义 + ALOW 全统一 + 文档债重建

- **N1 字数记账语义修正（本地设计决策）**：v0.21.0 把 ai_words 改「累计」修了「恒 0」，但整章重生场景累加必膨胀（regenerate 3000→+3500=6500 而当前内容仅 3500）。本批改为**整章替换→覆盖语义**：generate/solutionRunner/debtFix/版本恢复/反AI重写/production 回写 6 处 `ai_words = wordCount, human_words = 0`（覆盖，非累加）；PATCH 增量编辑（volumes.ts delta）保留累加——区分「整章替换」与「增量编辑」。论证：整章替换后旧内容已被物理覆盖，旧字数不存在于 content，累加无意义。测试 v0220.test.ts +5（generate 重生/版本恢复/solutionRunner/debtFix/反AI重写）。
- **ALOW window.confirm → themed useConfirm 全统一**：13 处迁移（ChapterExecutionPage 5 处含 generate 两步确认拆 generateContinue + 方案接力/采纳建议/版本恢复；WorldPanel/CharacterPanel/VolumePanel/TasksPage/NovelWorkspacePage/StudioPage×2/SettingsPage×2）。busy 守卫保持：confirm 提到 withBusy 外，run 仍 in withBusy（防连点）。
- **文档债重建**：decision-log D36-D89（50 条）按 git 提交信息 + 已发布代码重建（不臆测，无法核实标「待核」）；D40-D56 ID 冲突加 b 后缀（D40b-D51b/D56b）。banner 纠正损坏范围：D80-D89→D36-D89、P18-P28→P18-P30+§12、补 5 个未标文件（CHANGELOG v0.9.3-v0.14.0/test-report/versioning/audit-report/calibration-report）、删「正文见 CHANGELOG」误导（该段亦损坏）。
- **结论**：① 字数语义「累计 vs 覆盖」须按路径区分（整章替换覆盖、增量累加），单一语义必有一侧出错；② 文档重建以 git+代码事实为准，不臆测 rationale；③ verify-docs 守护「核心文档无 ASCII 控制字符」（承接 D90 ⑪）。
- 代码锚点: server/src/services/generate.ts:127/177（覆盖）；solutionRunner.ts:512；debtFix.ts:84；chapters.ts:670（版本恢复）；production.ts:230；tests/v0220.test.ts；client/src/pages/ChapterExecutionPage.tsx generateContinue/doGenerate

### D93 · 2026-08-14 · 完成即推送纪律（全体协作者统一 · 用户要求）

- **背景**：用户要求所有 AI 协作者（等级相同，均直接服务用户）在完成修复/更新后像本会话一样直接 push；此前行为不一致——改动滞留本地（反例：曾攒 4 个提交未推，含协作者 2 个）。
- **纪律（本地设计决策，经用户确认）**：任务完成即提交（一个 commit = 一个逻辑单元）；**本地门禁通过（typecheck + lint + test 三绿，数据层改动加 db-smoke）后立即 `git push origin main`**；push 前检查 `git status`（不覆盖他人未提交工作）与 `git log origin/main..HEAD`（无密钥/临时/未授权内容）；push 被拒 → `git pull --rebase` 保留双方意图。**例外**：发布类（bump/tag/release 走 release.mjs 用户批准）、门禁未过的中间态（不建 WIP 分支）。**CI 红 → push 者本人优先修复**。
- **落点**：AGENTS #60b；docs/AI-AGENT-ONBOARDING.md §2 阶段 7 / §3 / §15。
- **首个实例（本批次）**：多 agent 并行工作区合并——协作者 v0.22.0 完整绿态批（148/148、台账齐、已 bump）+ 本会话纪律文档，按用户裁决一次提交并推送。

### D94 · 2026-08-14 · pro 正式版参数校准（官方 vs OpenCode Go 网关）

- **背景**：deepseek-v4-pro 正式版发布（官方定价查证：hit $0.003625 / miss $0.435 / out $0.87 per 1M）——AGENTS #59 要求新模型先校准对比再启用；此前 pro 仅 fallback 候选。
- **方法**：复用 calibrate.ts（每组合 2 次均值）× 2 供应商（官方 api.deepseek.com / OpenCode Go 网关 opencode.ai/zen/go/v1）+ flash 基线复测（D8 对照）；成本按 pro 官方价重算（脚本 PRICE 表为 flash 价，pro 成本低估 3.1x——汇总时修正）。
- **结果**：三方最佳组合一致为 **off@0.9**（thinking off + 温度 0.9）：flash 0.949 > 网关 pro 0.931 ≈ 官方 pro 0.923。pro 无质量优势；成本 3.1x、延迟 2.6x（~43-50s vs ~18s）。
- **兼容性**：网关 pro `thinking-high` 组合失败（ok=false，110s）；官方 pro thinking-high 标题不合规——thinking 深度场景 pro 不稳。
- **结论（本地设计决策）**：prose 路由维持 flash（off@0.9）；thinking 任务维持 flash，pro 保留 fallback 候选——与 D8 结论一致，pro 发布不改变现状路由。flash 基线未漂移。
- **成本**：本批 26 次 pro + 12 次 flash ≈ $0.09。
- 产出：docs/calibration-report-pro.md（对比）+ 三份分报告。

### D95 · 2026-08-14 · 书级「下一步」引导 + 方案 Agent 名称现代化（v0.22.2）

- **背景（用户反馈）**：① 书 #25 未写完但点进书本不知道该干什么——缺"当前状态 + 下一步动作"引导；② 方案「帝路十章」agent 名称文言（因果司等）看不懂是干什么的。
- **引导机制（本地设计决策）**：`/novels/:id/status` 扩展 nextSteps 规则引擎（四态优先级：生产进行中 → 继续生产正文（含剩余/失败章数）→ 收尾修复质量债 → 已完成），前端书工作区顶部常驻引导卡（15s 轮询）+ 章节执行页进度轻提示（前端由 chapters 列表推导）。规则放服务端为单一事实源。
- **Agent 改名（真实库，10 行）**：定策阁主→总策划 / 命途执笔→主线编剧 / 棋局推手→节奏策划 / 丹青妙笔→场景描摹 / 声韵师→对白编剧 / 鼓点手→爽点调度 / 青史主编→内容审校 / 红尘读者→读者视角 / 因果司→连续性检查 / 天命合卷→终审合稿；description 由 4-11 字补全为职责说明。安全性已验证：方案 steps 按 agentId 引用、prompt 走 body_md 不含 name——改名零影响产出。UI：方案详情步骤列表展示「名称（职责）」。
- **验收**：155/155（+4 nextSteps 四态）+ 已发布 v0.22.2。

### D96 · 2026-08-14 · 应用单实例修复（多开问题）

- **背景（用户反馈）**：应用已打开时再次点击快捷方式会再开一个窗口——main.ts 无 `requestSingleInstanceLock`（grep 确认零实现），Electron 默认允许多实例。
- **查证**：Electron 官方文档（app 模块）——`requestSingleInstanceLock()` 返回 false = 已有实例，进程应立即退出；`second-instance` 事件在第二实例调用锁时于主实例触发，官方建议用于"make primary window focused"。
- **修复（v0.22.3）**：main.ts 顶部（ready 前）`if (!app.requestSingleInstanceLock()) app.quit()`；`whenReady` 内 `app.on('second-instance')` → 最小化则 restore + show + focus。未获得锁的实例不建窗口/不起 server——顺带杜绝双 server 抢真实库隐患。
- **验收**：typecheck/build 通过 + 发布后用户真机验证（开应用 → 再点快捷方式 → 不新开、原窗口唤起）。

### D97 · 2026-08-14 · 发版纪律分层决议（消除 #57 与 CI 机制冲突）

- **背景（用户提问）**：本会话对 PATCH 修复直接 `pnpm release --push`，而其他 AI 协作者被 AGENTS #57（"仅正式发布/里程碑发版，改动即发版不可取"）拦住——行为不一致暴露纪律矛盾。
- **根因（机制冲突）**：#57 诞生于 CI release-readiness 之前；现有三层机制互相冲突：① #57 字面禁止小改发版；② AGENTS #35/#36 要求任何代码改动必须 dist（产物=正式交付）；③ CI release-readiness 对 `client/src|server/src|electron|shared/src` 改动强制 bump（"src changed but version not bumped" 拦截，已查证 workflow 判定范围）。PATCH 修复实际被硬约束逼着发版——#57 语义过时。
- **决议（本地设计决策）**：发布类型分层——**PATCH 修复**（src 改动 → CI 强制 bump 发布，合规路径）；**MINOR 功能批**（批次完成即发布）；**MAJOR**（1.0 判据）；**免发版**（仅 docs/scripts/tests 改动，CI 不拦，按 #60b 即时推送不 bump）。#57 的"禁止改动即发版"限定为：无 CI 依据的 bump / 重复发版 / 仅文档 bump。**优先级：CI 硬约束 > 字面纪律**。
- **落点**：AGENTS #57 改写；onboarding §13 发布类型分层表；本条目。
- **效果**：其他 agent 不再被 #57 拦住——修复类改动按 PATCH 正常发版，语义清晰。


### D98 · 2026-08-16 · 第三轮全面审查（v0.23.0 基线）与分层修复决议

- **背景（用户指令）**：对项目做全面审查。三路并行深查（服务端 49 文件 13,464 行 / 客户端 56 文件 / 主进程+构建+CI+测试+文档），关键发现均经源码二次核验。
- **总体结论**：健康度良好偏上，无数据丢失级缺陷；安全基本面/执行面隔离/竞态防护/测试防线（155 单测 + T1-T4 e2e）扎实。债务集中在：稳定性边界、prompt 双份维护漂移、死特性伪装（约束统计恒 0）、文档台账局部腐化。
- **关键发现（已核验）**：① scheduler.ts `JSON.parse` 在 try 外 + tick 无 `.catch`——损坏 payload 可 crash server 进程；② main 发 `server-lost` 但 preload 未暴露、client 无监听（M16 修复半途）；③ generate.ts 反 AI 重写 prompt 缺 "json" 字样却走 jsonMode（DeepSeek 硬要求，违者 400——降级保留原文）；④ llm.ts 不检查 `finish_reason==='length'`（截断静默通过）；⑤ solutions/produce-chapter 与 volumes/refine-range 在 HTTP 请求内直跑多步 LLM（违反 #8/#23）；⑥ planner.ts prompt 在 novels/volumes/worlds 三处内联且已漂移（genreTemplate 注入仅导演链有）；⑦ zustand 纯死依赖（0 import）；⑧ CHANGELOG v0.22.x 缺标题/versioning §8 乱码/台账滞留等文档债。
- **决议（用户批准，全量执行）**：五批修复——C 文档台账（免发版，先行——release 流程依赖 verify-docs，台账不修则发版被阻断）→ A 稳定性 + B 规范收敛（PATCH v0.23.1）→ D 执行面迁 job 队列（MINOR v0.24.0）→ E 客户端重构（v0.24.x）。约束违反统计选择**接通**（validateConstraints + recordConstraintViolation 已存在，只差调用方）。
- **不修项（显式记录）**：v0.23.0 tag 历史不 force（#51 禁则）；kb_chunk 空壳表/embedding 桩保留（v1.0 embedding 路线预留）；debug/ 一次性脚本暂留待单独决策。

### D99 · 2026-08-16 · 发版内容不得混入免发版提交（v0.23.0 tag 教训）

- **事故**：tag v0.23.0 落在提交 3fe4191 上，该提交信息写「docs: 发版纪律分层决议……（v0.22.3，免发版）」，但 diff 实际包含 v0.23.0 全部发布内容（bump/CHANGELOG/sepia 主题/main.ts 改动）——提交信息与内容严重不符，且缺约定的 `chore: release v0.23.0` 提交。
- **根因**：免发版文档提交与发版内容（bump+CHANGELOG+src）混在同一提交，提交时未意识到其中含发版物料。
- **决议（流程纪律）**：发版物料（版本 bump / CHANGELOG 新版段 / tag）必须与免发版改动分开提交——release 流程的提交（`chore: release vX.Y.Z` 或 release.mjs [6/7] 产物）独立成提交；免发版提交内**禁止**夹带 package.json version 变更。历史 tag 不追溯（#51 禁 force）。

### D100 · 2026-08-16 · 第三轮审查修复批 A+B 落地（v0.23.1）

- **批次 A 稳定性（全部经源码二次核验后修复）**：scheduler 损坏 payload 防御（JSON.parse 移入 try + tick 补 .catch——此前未处理 rejection 可 crash server）；server-lost IPC 补全（M16 只做一半：main 发送但 preload 未暴露，renderer 永远收不到——现 App 显示重启引导面板）；反 AI 重写 prompt 补 "json" 字样（jsonMode 硬要求，此前静默 400 降级）；max_tokens 截断检测（LlmResult.truncated 标志：章节截断显式失败拒落库、callLlmJson 注入精简反馈重试——落实 #10"截断即重试"）；SSE 错误复位补 status='generating' 守卫；before-quit preventDefault+优雅等待；updater/theme IPC 加 assertTrustedSender。
- **批次 B 规范收敛**：planner prompt 九处内联收敛（#31 兑现——novels/volumes/worlds 手动路由与导演链双向漂移消除：手动路由补齐流派模板/卷间钩子注入、导演链补齐卷骨架；getGenreTemplate/getPrevVolumeHook 迁 planner 共享）；quality-debts camelCase（#20，其余两处经查服务端本已 camelCase，是客户端类型注解过期）；zustand 死依赖移除；e2e 报告路径仓库相对化；约束违反统计接通 + 修复 validateConstraints 反向条件 bug（注释"出现即违反"与实现 count===0 相反——死代码掩盖的真 bug）；死代码清理一批。
- **e2e 抓真 bug（R4→R5）**：debtFix 销账 UPDATE 引用 quality_debt 表不存在的 updated_at 列（v0.10.0/e78e26f 引入；修复达标即 500——历史轮 rescore 未达标而绕过未暴露）。修复后 R5 全绿（T1 10/10 T2 30/30 T3 6/6 T4 7/7）。
- **验收**：162/162（+7：scheduler×2/截断×2/约束统计×3）+ db-smoke 7/7 + e2e R5 + dist 双产物。
- **待续批次**：D（produce-chapter/refine-range 迁 job 队列，v0.24.0 MINOR）+ E（客户端重构：两大页面拆分/useBusy 共享 hook/硬编码颜色/轮询收编）。
