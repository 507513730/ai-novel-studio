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

### D36 ? 2026-08-10 ? ??????P13 F0??????
- **??**?Electron ?? dark-mode ???nativeTheme.themeSource ?????? + prefers-color-scheme ?????????????? = CSS ??? + data-theme ??
- **??**?6 ????deepblue ?? / feelfish-green??????? #101010+#00a060?/ purple-night / ocean / amber / paper ????localStorage ??? + ?? initTheme ????IPC theme-set ?? nativeTheme + titleBarOverlay ???CodeMirror ???????
- **??**?AGENTS.md ?? 41

### D37 ? 2026-08-10 ? ??????P13 G1?
- **??**?retry ??? model ? payload.modelOverride?llm.ts ????????setActiveModelOverride?scheduler ??????????buildCandidates ????override ?????? degraded?fallback ???
- **??**????? llmOverride ??????????????

### D38 ? 2026-08-10 ? ???????P13 G2????????
- **??**?????????????????/?????????????????????????????????????? + ???? + ??????
- **??**??????????????? hash ???????????D6 ?????

### D39 ? 2026-08-10 ? ?????P13?
- **??**?PLAN.md ?12 ?????? docs/decision-log.md?PLAN ? ?12 ????P9/P11/P12 ???? docs/optimization-log.md?AGENTS.md ?????
- **??**?PLAN ??"??+???"?849?650 ??????????????????


### D40 · 2026-08-10 · v0.2.0 发布（P14）
- **内容**：B 收尾（形象演变融合/Agent 展开/手册确认/生产范围）+ C 发布（新图标/Release Notes/签名就绪）+ D 深度测试
- **测试结论**：3 轮 × 52 项全绿（R3）；测试抓到 2 个潜伏真 bug（修复见 D41/D42）

### D41 · 2026-08-10 · fix 降级整章重写 400 修复（P14 D，e2e 抓到）
- **问题**：patch_first 降级 buildFixContext → callLlmJson（response_format json_object）→ 网关 400 “Prompt must contain the word json”
- **决策**：buildFixContext prompt 改为输出 JSON {content: ...}（含 json 字样 + 结构兼容 validator）
- **写入**：AGENTS.md 纪律 44（所有 callLlmJson 的 prompt 必须含 json 字样）

### D42 · 2026-08-10 · EPUB 导出互操作修复（P14 D，e2e 抓到）
- **问题**：utilityProcess 下 import CJS 包多包一层 default（default 是对象含 default 函数）→ .default 取到对象 → epub is not a function
- **决策**：递归展开 default（while 循环取函数）；导出结构异常时显式报错
- **教训**：动态 import CJS 包在 utilityProcess 环境的包装层级与普通 node 不同

### D43 · 2026-08-10 · 生产范围授权（P14 B4）
- **决策**：produce 端点支持 from/to（章节 id 区间）→ job payload → runProductionPipeline 过滤；语义延续纪律 9/23（产物落库判定）


### D44 · 2026-08-10 · 卸载与数据管理（P16 P0）
- **问题**：用户删除安装目录后数据仍在（userData 与安装目录分离；内部无卸载入口）
- **决策**：`nsis.deleteAppDataOnUninstall: true`（系统卸载时自动清数据）；设置页「数据与卸载」区（打开数据目录 / 清除全部数据 IPC / 卸载指引）

### D45 · 2026-08-10 · 图标 3 稿选择（P16 P3，kimi 多模态评审驱动）
- **评审**：我们 vs 参考项目 vs FeelFish 三图对比；差距 = 缺独存记忆符号/小尺寸可读性差/无负形巧思/AI 角标外挂感/同质化
- **决策**：用户选稿 A（笔尖负形）；SVG 源入库 resources/icon-sources/（同参考项目做法）
- **教训**：Playwright 中 `img` 加载 `file://` SVG 被 Chromium 拦截（naturalWidth=0→全白截图）——必须内联 <svg> 元素或 data URI

### D46 · 2026-08-10 · 导航可用性改造（P16 P1）
- **决策**：书级导航项去除 disabled（参考项目侧栏从不禁用）——无书时点击跳列表 + toast 提示；徽章条件轮询（仅活动任务时 4s）


### D47 · 2026-08-10 · 资产全局化与入口打通（P17-1）
- **问题**：书级导航无书时点不进去；写法、拆书、流派被做成书内 tab（与参考项目“资产全局页 + 书绑定”架构不同）
- **决策**：→ novel_id=0 表示全局资产（零迁移，同 genre_asset 模式）；写法引擎/拆书/流派为全局页（书内 tab 保留）；创作中枢全局化（可切换书），自动导演/章节执行无书时显示选书落地页
- **影响**：侧栏 16 项全部可点；写法资产可全局创建并导入任意书


### D48 · 2026-08-10 · 资源页与迁移 v4（P17-2）
- **决策**：新增 story_mode / world_template 表（迁移 v4）；推进模式库/世界样本库/知识库页；侧栏 19 项（接近参考项目 21）；药丸 tabs + select 上浮美化
- **备注**：db-smoke 断言 schema version 3→4 同步更新；世界样本应用会覆盖目标书世界观（确认提示）
