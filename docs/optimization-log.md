# ?????????P9/P11/P12 ???P13 ????

> P13 ?????? P9/P11/P12 ?????


## P9 ???????2026-08-10?

# P9 体验缺陷修复明细（2026-08-10）

三路审查（导航/交互 + 反馈/一致性 + 输入/边界）→ 40+ 项 → A/B/C/D 四批。
审查证据来自 3 个 explore agent 报告；本文件为缺陷→修复→验证映射表（PLAN.md P9 章节为摘要）。

## A 批：数据安全（5 项，最高优先级）

| 缺陷 | 根因 | 修复 | 验证 |
|---|---|---|---|
| A1 切章/首开不加载正文，空保存覆盖 | 列表接口无 content；saveContent 无条件 PATCH+置 written | 新增 `GET /:novelId/chapters/:chapterId`（volumes.ts）；切章 effect 拉取（序号竞态）；saveContent 空内容保护 + 脏检查 + 失败上抛；加载完成前禁用保存 | 实测：章节1 加载 1323 字 ✓；切章后服务端 1413 字未破坏 ✓ |
| A2 取消生成清空已生成内容 | abort 后停止读取，服务端 aborted 事件收不到；本地兜底写死空串 | api.ts 流内 `accumulated` 累积，两处 abort 兜底携带累积内容 | tests/sse-abort.test.ts 2 项通过 |
| A3 生成无确认清空草稿 | generate 直接 setContent('') | 未保存内容 confirm；失败恢复 prevContent；generateBusyRef 双击防重 | 代码审查 |
| A4 保存失败仍切换清空 | selectChapter 忽略保存结果 | 保存失败中断切换 | 代码审查 |
| A5 Onboarding 空 key 覆盖已有 key | 空 key PATCH 覆盖凭证 | 空 key 不 PATCH；无 provider 时空 key 拒绝；step1 渲染错误 | 代码审查 |

## B 批：反馈与防重

| 项 | 修复 |
|---|---|
| B1 per-action busy | ChapterExecutionPage 7 操作 + confirmStates（withBusy 锁）；CharacterPanel 增删改（charBusy）；AnalysisPanel 发布（publishBusy）；StylePanel 开关（featureBusy）；NovelListPage 删除（deleting） |
| B2 Enter 建书防重 | submitCreate 统一入口（creating + isPending 双守卫） |
| B3 toast | 测试连接/保存供应商/导入网关/Key 更新 成功失败均有反馈 |
| B4 三态 | SettingsPage providers；资源树三 tab（loading/失败+重试/空） |
| B5 资源树 | loadResourceTab try/catch + 三态渲染 |
| B6 全局兜底 | unhandledrejection → toastGlobal（模块级广播，AbortError 除外） |
| B7 导出 | fetch 流下载 + 响应校验 + 真实成功/失败 toast（原点击即假成功） |
| B8 标题双 PATCH | titleSubmittedRef 跳过 Enter+blur 双发；Esc 取消 |
| B9 设置返回 | navigate('/')（直达场景不死路） |

## C 批：边界细节

C1 温度 NaN/越界（0-2）拒绝+回滚草稿；C4 流式期间编辑器只读（editable=false）；C5 生成中切章 toast 提示；C6 beforeunload 脏提示；C7 章节树/小说卡片 role/tabIndex/Enter 键盘可达；C8 导演轮询连续失败 3 次暂停+断开提示/恢复；C9 取消导演 confirm + busy；produce"无待生成"改中性提示。

## D 批：长尾（含 D7/D6 顺带完成）

D1 聊天气泡断词；D2 顶部行 flexWrap；D3 章数钳制 5-40（VolumePanel/DirectorPage）；D5 试写不足提示（StylePanel trial）；D6 拆书历史 invalidate（AnalysisPanel publish 后）；D7 风格开关乐观更新+失败回滚（queryClient.setQueryData）；D10 自定义 URL 校验；D12 apiFetch/j 60s 超时（AbortSignal.timeout）；D16 Ctrl+S 排除输入焦点 + Esc 关浮动面板；D19 书名失焦保存+可清空（initRef 首次同步）。

## 遗留（未做，低优先级）

- TopNav 抽组件、图标导航、空状态插画（P8 遗留）
- SetupPanel 方向卡片 genTitles 过期响应丢弃（请求序号）
- 工作台 tab 切换脏检查（面板卸载丢输入）——需产品决策（confirm vs 保留挂载）
- Agent 提示词截断展开
- 世界手册"取消"确认
- 供应商 baseUrl URL 格式校验（表单层）

## P11 ?????????2026-08-10?

# P11 学习报告：AI-Novel-Writing-Assistant 全流程研究（2026-08-10）

3 个子代理研究报告存档（前端布局 / 流程设计 / 服务端架构），P11 已落地项见 PLAN.md P11 章节。

## 一、前端布局与导航（Sidebar.tsx / NovelWorkspaceRail.tsx）

- **lucide-react 图标** + 自建 shadcn 风格 ui/（radix + cva + tailwind-merge），零 shadcn CLI
- **数据驱动导航**：`navGroups: NavGroup[]` 数组声明（to/label/icon/action/disabled），统一渲染 NavLink + 左侧激活指示条（absolute left-1 h-5 w-1 rounded-full bg-primary）+ accent 底
- **徽章分发**：按路由分发状态徽章（失败任务数/待跟进数/索引失败数），延迟 500ms 启用防首屏闪烁，有任务 4s 轮询
- **折叠**：宽 256 ↔ 72px，localStorage 持久化（key ai-novel.sidebar.collapsed）
- **双导航**：全局功能侧栏 + 工作台上下文二级 rail（NovelWorkspaceRail：编号圆点 + 状态标签「当前步骤/流程中/查看中/已完成/待推进」，色系 sky=流程中 / slate-950=选中 / emerald=已完成），顶部「创作导航/项目导航」切换
- 桌面端 HashRouter；路由全懒加载 + Suspense 骨架屏

## 二、流程与阶段组织（auto-director-runtime.md / chapter-production-chain.md）

- **12 步主链**：framing → macro → 角色 → 卷战略 → 卷战略评审 → 卷骨架 → 节拍板 → 章节列表 → 细化 bundle → 执行 → state sync → 审计/重规划
- **StepModule 契约**：inspect / buildInput / execute / validateOutput / commit / inspectProgress / recover / completeCriteria
- **完成判定以产物事实为准**：Chapter.content / AuditReport / StoryStateSnapshot 是完成度来源，task.status 只作投影
- **双投影体系**：轻量 Runtime Projection（<20KB，导航/任务中心轮询）+ 完整驾驶舱快照（详情弹窗）；不得共用 React Query key
- **"为什么停"三件套**：blockingReason / resumeAction / lastHealthyStage 在每一步一致呈现
- **检查点语义**：chapter_batch_ready（继续门）/ character_setup_required（可恢复暂停）/ replan_required（硬阻塞）
- **批量操作契约化**：autoExecutionPlan（chapter_range）写入任务 Seed，approveAutoExecutionScope 授权后才放行
- **质量降级链**：局部修补 → 整章重写 → 窗口重规划 → 硬恢复；qualityLoopLedger 按 issueSignature 归并，防同类问题反复烧 LLM

## 三、服务端架构（app.ts / tasks.ts / TaskDispatcher.ts）

- **六层**：装配（app.ts）→ 薄路由（Zod 校验）→ 领域模块 → 服务层（22 子域）→ AI 编排（chains/graphs/agents/events）→ 基础设施（workers/db/llm）
- **DB 是唯一真相**：TaskDispatcher 仅做唤醒信号（EventEmitter 零延迟 + 轮询兜底），所有可恢复状态持久化
- **启动即恢复**：5 个后台 worker + 2 个 watchdog + initializePendingRecoveries()
- **任务状态机**：queued → running → waiting_approval → succeeded/failed/cancelled；动作端点 retry/cancel/archive；retry 支持 llmOverride（换模型）
- **恢复体系**：/recovery-candidates → resume-all → resume（带 idempotencyKey 防重复）
- **诊断**：agent-runs diagnostics（failureCode/failureSummary/recoveryHint，逆向定位第一个 failed step）

## 四、产品设计原则（README 提炼）

1. 完成度优先而非精巧度优先（服务"小白把整本书写完"）
2. AI 是系统角色（规划/判断/调度/执行/追踪），不是文本补全器
3. 流程显性化、阶段可暂停可恢复（每阶段显式完成度）
4. 所有产出资产化（拆书→知识库/写法资产/角色库）
5. 安全兜底而非无限重试（主动停下 + 恢复点 + 确认点防误触额度）
6. 宽容失败、精准干预（换模型重试/范围续跑/部分重做）

## 五、已落地到本项目

- P11-2 全局侧栏（navGroups + 激活指示条 + 折叠持久化 + lucide 图标）✓
- P11-3 流派自定义 API（资产化理念）✓
- P11-5 AI 状态条（轻量投影：状态/阶段/阻塞原因）✓
- P10 步骤导航（完成度徽章以产物计数为准）✓

## 六、后续可借鉴（未做）

- 任务中心页（jobs 统一状态枚举 + 重试/取消/换模型）
- 恢复候选入口（recovery-candidates：失败任务"一键继续"）
- 章节执行进度矩阵（10 子阶段可重算）
- 质量降级链（patch_first → 整章重写 → 窗口重规划，现有 fix 已部分实现）
- 标题工坊（批量生成/筛选/微调）
- Navbar 版本徽章 + 更新状态

## P12 ???????2026-08-10?

# P12 优化明细（2026-08-10）

A 流程完整 + B 体验 + C 架构 + D 成本。技术不确定点均经上网调研确认（纪律 17），结论见 PLAN.md §12 D31/D32。

## A 批：流程完整性

| 项 | 改动 | 验证 |
|---|---|---|
| A1 任务中心 | server/automation.ts：POST /jobs/:id/retry（failed/cancelled→queued，幂等 409）、/cancel（queued/running→cancelled）；client TasksPage.tsx + 路由 + 侧栏「任务中心」F{n} 徽章（800ms 延迟 + 4s 轮询） | 页面空态/卡片渲染实测 ✓ |
| A2 恢复入口 | DirectorPage 失败/阻塞显示「▶ 从断点继续」；NovelListPage 卡片「⚠️ 需恢复」（failed job 的 novelId 集合，6s 轮询） | 代码审查 |
| A3 章节进度矩阵 | ChapterExecutionPage 右栏 9 段横条（任务单/上下文/草稿/保存/审核/修复/回灌/快照/可审）；fixDoneRef/backfillDoneRef/confirmDoneRef/snapshotDoneRef 记录 | 实测：本章进度显示 ✓ |
| A4 批量细化 | volumes.ts：refineOne 抽出 + POST /chapters/refine-range（幂等：goal 有 purpose 跳过）；VolumePanel 范围输入 + 按钮 | typecheck |
| A5 标题工坊 | TitlesPage.tsx（detail→titles→patch 复用现有 API）+ 路由 + 侧栏 | 实测 1 卡渲染 ✓ |

## B 批：体验

B1 章节「下一步」提示（状态映射文案）；B2 小说列表空态插画卡；B3 无边框标题栏（main.ts titleBarStyle+Overlay、index.css .titlebar、AppLayout 顶部，实测 40px/drag ✓）；B4 tab 脏检查（SetupPanel notes/title + WorldPanel 手册编辑 onDirtyChange → confirm）；B5 ErrorMsg onRetry。

## C 批：架构

C1 质量降级链（fix 2 轮上限登记 quality_debt + fixHistory signature 同签名拒绝重试防重复烧 LLM）；C2 生成中成本显示（gpt-tokenizer cl100k_base 流式累计）；C3 TopNav 收敛（Director/CreativeHub 顶部按钮删）；C4 共享类型（client/types.ts → shared/src/types.ts + re-export）。

## D 批：成本

D1 生成前成本确认（estimateCost(content,4096) confirm）；D2 近 7 日缓存命中率卡片（usage/stats?from=7d）。

## 新增依赖（版本锁定表已更新）
- lucide-react ^1.31.0（P11）
- gpt-tokenizer ^3.4.0（P12，纯 TS，零原生依赖 ✓）

## 单测（23/23）
- world-render 6 项（P11-1.1）
- sse-abort 2 项（P9 A2）
- cost-estimate 4 项（新增：空文本/中文估算/成本正数/fmtCost 三档）

## 遗留
- 任务中心 running 任务取消 → 直接标 cancelled（导演主循环感知）；若需中断执行中的 LLM 调用需加 AbortController（成本高，暂缓）
- 窗口控制按钮高度 40px 与标题栏一致（titleBarOverlay height 可调）

## P14 收尾与测试（2026-08-10，v0.2.0）

- B：形象演变融合入档 / Agent 提示词展开 / 手册取消确认 / 生产范围授权 / 版本 0.2.0
- C：新图标（Playwright 渲染设计稿 512px）/ Release Notes / 签名就绪（WIN_CSC_LINK 约定）
- D：深度测试 3 轮 × T1-T4 全功能 52 项，R3 全绿；修复 2 真 bug（fix 降级 400 / EPUB 导出）——详见 docs/test-report.md 与 decision-log D40-D43

## P16 差距补足与图标（2026-08-10）

- P0 卸载与数据管理（deleteAppDataOnUninstall + 设置页数据区）
- P1 导航可用性（去 disabled + 徽章条件轮询）+ 5 新页面（侧栏 9→17）
- P2 美化（步骤五状态/特权高亮/16px 图标/EmptyState）
- P3 图标选稿 A （kimi 三图评审→笔尖负形）；修复 SVG file:// 载入拦截问题
- 详见 decision-log D44-D46 与 PLAN P16
