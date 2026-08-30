# AI-Novel-Studio 发布说明

## [Unreleased]

### A 档竞品差距（1.0 后补强，D123）

**A5 导出预览（复用 .prose 排印）**
- 章节工具栏导出按钮不再直接下载，改为先打开「导出预览」弹层：整本书（已写章节）按 `.prose` 渲染，可先确认版面再下载
- 弹层内可切换 TXT/MD/EPUB/DOCX（各带格式提示），底部「下载」才真正拉取导出文件
- 新增 `GET /:novelId/export-preview`（camelCase 结构化数据，与 `/export` 共用同一份已写章节查询，保证预览与导出一致）

**A1 多候选分支生成（串行生成 → 存版本对比）**
- 章节执行面板新增「多候选分支生成」：串行生成 2 份差异化构想（各注入不同走向引导），各存为 `chapter_version` 快照（note=「候选 N」）
- 候选并排对比面板逐份预览，选定一份「采用为正文」——复用现有版本恢复流程落稿，其余候选保留在版本历史便于回退
- 新增 `server/src/services/chapterGeneration/candidates.ts`（`generateChapterCandidates`）+ `POST /:novelId/chapters/:chapterId/candidates`；版本快照经 `persistence.persistCandidateVersion` 唯一入口写入，满足架构守护约定（chapter_version 仅 persistence.ts 与 versions 路由可写）

**A6 演示书与引导（现状核实，无需新增）**
- 演示书「载入演示书」按钮（书架空态）+ nextSteps 引导卡均已在 v0.24.4 就绪，A6 演示书部分无需新增

## v1.0.0（2026-08-29）

### 安装方式
- **安装版**：`AI-Novel-Studio-Setup-1.0.0.exe`（NSIS 向导版）
- **便携版**：`AI-Novel-Studio-1.0.0-portable-x64.exe`

### 1.0 收官批：UI 全面升级·观感升级（D122，问题清单见 docs/ui-review.md）

> 1.0 判据（versioning §1.1，2026-08-29 用户裁定二次修订）：UI 全面升级完成 + 全链路真实写书验证通过 + 核心链稳定 + 数据格式冻结。

**章节执行页（写作主战场）**
- 页面按 AGENTS #38 完成拆分：1150 行/28 useState → 装配层 398 行/4 useState，逻辑抽入 8 个 hooks（动作编排/产物面板/续写建议/反馈原语/快捷键/文件操作/列表数据 + 既有三 hook），右栏拆为 ExecutionPanel 组件
- 右栏执行面板重排（D27「每屏一个主行动」）：「当前推荐」主行动卡 accent 强调；质量与连续性（审核/校对/修复/回灌）、方案流水线、查看与记录（待确认/记忆/版本/快照/上下文）三组卡片 + 双列网格，次级动作不再与主行动等权平铺

**首页书架**
- 书卡升级：封面色块加大并加内描边、书名 16px、进度条与百分比同行、新增「最近打开」相对时间（书架扫读上下文）

**创作中枢（HubChat）**
- 消息三态：用户/助手气泡 + 系统错误条（错误不再以「⚠️」拼进助手正文伪装成回复）
- 助手消息受限 markdown 渲染：粗体/行内码/代码块/列表/标题（纯 React 元素构造，无 HTML 注入，零新依赖）
- 空状态升级 EmptyState；发送按钮图标化

**工作台**
- 三层引导收敛：横排流程卡（GuideStrip）默认收起为一行进度（左侧步骤导航为常驻层级，避免三层同屏冗余），点击可展开

## v0.26.0（2026-08-29）

### 安装方式
- **安装版**：`AI-Novel-Studio-Setup-0.26.0.exe`（NSIS 向导版）
- **便携版**：`AI-Novel-Studio-0.26.0-portable-x64.exe`

### UI 一致性与 P0 硬伤修复批（D120/D121，问题清单见 docs/ui-review.md）

**P0 可用性修复**
- 修复章节执行页顶部工具栏与导演页控制区被挤压成竖排文字（1440px 宽即可复现的标题一字一行/按钮一字一行）：按钮与 label 全局补 white-space 约束，工具栏加收缩保护与换行容错
- 侧栏导航 active 判定重写：移除「小说列表」常亮强调；修复无书时「工作台」项与「小说列表」双高亮；章节执行/自动导演/创作中枢/写作统计在有书时直连书内路由并正确高亮
- 样式地基清理：fade-in-up 重复定义去重；新增 `.page` 页面容器体系（narrow 960 / 默认 1080 / wide 1400）；弹层遮罩 `--overlay` 与层级 `--z-dropdown/modal/toast` token 化（亮色主题遮罩调淡）；CodeMirror 编辑器 dark 标记跟随主题（原硬编码 light）

### 一致性与舒适度（P1）
- 8px 栅格归位：按钮 8/16、输入框 8/12、行间距 8、状态栏/药丸 tab 对齐 token；标题 h2 层级强化（15px 灰 → 16px 正文字色）
- 加载态统一：新增骨架屏 Loading 组件替换「加载中…」纯文字（任务中心/写作统计/资源面板/基础角色库/写作设置/书架），路由级骨架收敛全局 .skeleton
- 空状态统一 EmptyState：首页书架、选书落地页；错误呈现统一 ErrorMsg（首页列表/工作台标题行）
- 首页书卡：JS hover 改 CSS 悬浮过渡、进度条统一组件、「⚠️ 需恢复」改图标库
- 按钮 emoji 清零（🔥✍️📖🛒📚⚠️ → 纯文案或 lucide 图标，与侧栏图标体系统一）；智能体库「AI 起草 body_md」术语泄漏改「AI 起草正文（Body）」、等宽字体走 token、编辑弹窗对齐共享遮罩规范并支持 Esc 关闭
- 任务中心长错误文案单行截断 + 悬浮看全文；10px/9px 超小字号全部归位 11px 下限；应用名三重重复收敛为标题栏单点承载

### 其他
- 应用图标换用「简约字母」设计（B 变体），候选素材入库（继承自 Unreleased）
- 1.0 判据二次修订（versioning §1.1，用户裁定）：UI 全面升级批次完成即达成 1.0，写书收官在 1.x 内完成、不阻塞发版
- 文档修正：浏览器直连 5173 调试需 `AI_NOVEL_TOKEN_OPTIONAL=1 pnpm dev`（v0.25.0 起 dev 亦强制 X-App-Token）

## v0.25.0（2026-08-29）

### 安装方式
- **安装版**：`AI-Novel-Studio Setup 0.25.0.exe`（NSIS 向导版）
- **便携版**：`AI-Novel-Studio-0.25.0-portable-x64.exe`

### 全仓库重构 R0-R9（D111-D119）

兼容重构十批全部落地：业务域单一事实源 + 兼容层删除 + 架构守护 + 文档按受众重组。外部 REST/数据/用户流程完全兼容。

### 重构：R0 基线 + R1 章节生成域重放（D111）

- 章节生成从 `generate.ts`（245 行单文件）拆为 `chapterGeneration/` 域：`state.ts`（抢占/失败恢复）、`persistence.ts`（正文/版本/字数/状态短事务）、`postProcess.ts`（主角名替换/约束登记/反 AI 重写）、`orchestrator.ts`（编排）；`generate.ts` 缩为兼容转发，公共签名与全部调用方零改动
- **修复**：反 AI 重写成功后正文与最新版本快照分叉（R0-F1）——最终内容单事务落库，`chapter.content` 恒等于最新 `chapter_version.content`
- **修复**：截断检测移至一切后处理副作用之前；章节 UPDATE 补 novel_id 守卫（R0-F2）；降级原因经 `GenerateResult.degradedReasons` 透出
- 测试：新增契约测试 10 例（抢占互斥/ConfigError 恢复/版本一致/中止注释/空正文/守卫失配回滚/约束登记归因等），全量 46 文件 267 用例
- 用户可见行为（REST/数据/操作流程）保持兼容；合并 main 与发版另行执行

### 重构：R8 Electron 主进程模块化（D118）

- 659 行 electron/main.ts 缩为 46 行纯装配，拆出 state/window/serverProcess/shutdown/ipc/theme/updater 七模块；export-backup 复制的 checkpoint 协议收拢 shutdown.requestCheckpoint
- 新增安全契约测试 9 例（mock electron）：trusted sender 矩阵、get-server-token 不外泄、wipe-data 不可信拒绝、外链/导航白名单、webPreferences 三件套、safeStorage fail-closed、随机端口
- 修复打包态验收脚本两个既有遗留：v072-pack-verify 就绪探测缺 X-App-Token（v0.25.0 起误报「server 未就绪」）、spawn 缺 AI_NOVEL_ALLOW_PLAINTEXT（v0.17.0 起 import-opencode 500）——修复后打包态等价验收通过（真实 SSE 生成+导出+鉴权）

### 重构：R6 Context/LLM 域拆分（D117）

- 771 行 `context.ts` 拆为 `context/{types,hash,budget,frozen,dynamic}`：冻结前缀顺序/hash 版本化/预算裁剪优先级/RAG 直塞语义由特征测试锁定（拆分前后行为一致）
- 388 行 `llm.ts` 拆为 `llm/{types,errors,routes,candidates,request,caller}`：DeepSeek 参数语义（thinking 显式 disabled/温度无效/jsonMode 限制/reasoning_content 回传）、候选链 override 优先、统一记账、Key 不泄露由契约测试锁定
- CJK 字数口径收拢 `shared/text.countCJKChars`；公共签名不变（context/llm 兼容转发）
- 测试 +20（全量 59 文件 341 用例）

### 重构：R5 统一错误模型 + 章节执行路由拆分（D116）

- 新增 `services/shared/errors.ts` 六类统一错误；`ConfigError` 改为继承 `ConfigurationError`（instanceof 兼容）
- 错误中间件语义化映射：配置错误→400 消息透传（不再伪装 500）、取消→499、暂时性供应商→503、输出校验→502；既有 ZodError→400 / 约束→409 / 其余→500 保持
- 924 行 `routes/chapters.ts` 拆为 `routes/chapters/` 七模块聚合（创建/生成/审核修复校对/回灌与记忆面/版本/检索与上下文预览/AI 编辑），路径与方法不变（契约测试锁定）
- debt-fix 入队 SQL 收拢 `jobs/repository.enqueueDebtFixJob`；其余路由审查后保持（单域内聚）
- 测试 +13（全量 57 文件 321 用例）

### 重构：R4.2 导演域 + R4.3 整本生产域拆分（D115）

- 导演 826 行拆为 `director/{stages,checkpoint,artifacts,pipeline}` + `executors/`（9 阶段执行器注册表）：阶段元数据与产物判定各归唯一事实源，checkpoint 不再是完成依据；恢复跳过已完成模型调用（故障注入测试锁定）
- 整本生产拆为 `production/{chapterPolicy,progress,pipeline}`：批次决策（产物驱动选章/范围校验/不达标重试/ConfigError 熔断）收拢 chapterPolicy；**solutionRunner 复制的抢占/落库/复位 SQL 收拢进章节生成域（R0-F5 关闭，token 身份贯通）**
- 公共签名不变（runDirectorPipeline/runProductionPipeline），调用方零改动；测试 +15（全量 55 文件 308 用例）

### 重构：R4.1 章节级 generation_token（D114）

- 迁移 22 新增 `chapter.generation_token`：`claimChapter` 抢占即颁发章节级生成身份，落库/失败恢复守卫升级为 `id+novel_id+generation_token+status='generating'`
- 旧生成协程迟到落库 → stale claim 错误 + 事务回滚零数据变更；迟到失败处理静默跳过（不触碰新 claim）；重启恢复清空 token
- 测试 +1 stale claim 故障注入（全量 51 文件 293 用例）；db-smoke schema version=22

### 重构：R3 scheduler token 作用域化（D113）

- 五类 job 业务循环迁入 `jobs/executors.ts` 显式注册表；trace/进度收拢 `jobs/progress.ts`；`jobs/scheduler.ts` 只负责轮询/claim/watchdog/分发/运行锁；旧 `services/scheduler.ts` 缩为兼容转发
- watchdog 置 failed 即失效当前 claim，迟到协程进度/收尾写入被守卫拒绝；stopScheduler 停止新 claim 且执行器在下一安全边界观察停止；启动恢复清 claim token
- 测试 +7（全量 51 文件 292 用例）；打包门禁受构建环境会话 ACL 问题阻塞（D113），交付待环境恢复后重跑 dist

### 重构：R2 job 域隔离（D112）

- job 抢占/收尾迁入 `services/jobs/` 域（repository/lifecycle/payload/types）：`claimNextJob()` 颁发唯一 claim token（迁移 21 新增 `job.claim_token`），所有运行态写入以 `id+token+status='running'` 守卫——迟到协程与取消/watchdog 终态覆盖被结构性拒绝
- payload 域边界一次 Zod 强类型解析（`parseJobPayload`）：损坏 JSON/未知类型/字段不合规 → 语义化失败只影响该 job，不影响 scheduler 进程；`modelOverride` 穿过解析保留（换模型重试语义不变）
- `jobQueue.ts` 缩为兼容转发（公共签名不变）；重试重排队/重启恢复清空 claim token；取消端点收拢 `cancelActiveJob`
- 测试：新增 job 域契约 18 例（全量 49 文件 285 用例）；db-smoke schema version=21；REST/数据兼容

### 依赖治理（2026-08-24，免发版，D110）

- `dependabot.yml` ignore 对齐版本锁定清单（AGENTS #2：electron/vite/react/typescript/openai/zod 等 23 项全类型忽略）——锁定包不再每周开升级 PR（CVE 例外走人工评估）
- devDeps 小升级（Dependabot PR #6/#7/#8/#10 手动落地 + 三绿）：@commitlint 21.2.2（cli+config 配套）、eslint-plugin-react-refresh 0.5.4、typescript-eslint 8.68
- electron 43.3.0→43.4.1 关闭（#9）：锁定基线，待重大升级评估

（暂无）


### 修复
- 生产管线状态推进补守卫（R0-F6 清零）：失败置状态不覆盖新一轮生成、审核写回仅从 written 推进
- v072-pack-verify 打包态验收脚本两处既有遗留（就绪探测缺 X-App-Token / spawn 缺明文调试开关）
- 生产回灌 await 缺失（unhandled rejection + ConfigError 熔断被吞）

### 其他
- 提交规范：标题与正文一律中文（AGENTS #60）
- 开发默认 Shell：pwsh 7.6.5

### 测试与验收
- vitest 62 文件 366 用例（重构前 257 → 净增 109 条行为契约）
- db-smoke 7 项（schema v22）；v072-pack-verify 打包态等价验收通过；E2E 两轮（网关波动项见 decision-log D119）

---

## v0.24.4（2026-08-24）

### 安装方式
- **安装版**：`AI-Novel-Studio Setup 0.24.4.exe`（NSIS 向导版）
- **便携版**：`AI-Novel-Studio-0.24.4-portable-x64.exe`

### 变更（非写书清单批 B，详见 D108/D109）

- **审核基线校准**（D108）：`reviewPolicy.ts` 分级修复触发（<60 必修 / 60-74 有 high 才修 / 仅 medium-low 登记软债）+ needsFix 服务端推导 + SYSTEM_REVIEW 评分锚点——中等档免修省 2-3 次 LLM/章
- **写作统计面板**：`/novels/:id/stats`（字数/AI 占比/卷分布/审核分分布/成本）+ 伏笔账本（`/foreshadows`，与章节页记忆面同源）——零新增表
- **快捷词宏**：编辑器 `;触发词` → 展开文本（CodeMirror autocompletion + 设置页词典管理，≤50 条）
- **轻量本地校对**：重复词/乱码确定性检查（零 token）+ 单次语义检查（错别字/称谓一致性），章节页「本地校对」入口
- **DOCX 导出**：零新依赖（jszip 组装 OOXML），投稿平台事实标准
- **细节打磨**：资产导入支持文件拖拽；主题新增「跟随系统」（深色=墨蓝/浅色=纸张）
- **网文要素工坊**：`/forge`——人名/地名/门派/功法/宝物/金手指/桥段批量生成，一键存知识库
- **演示书**：新用户一键载入（1 卷 3 章 + 角色 + 世界观 + 伏笔，零 LLM）
- **测试基线修正**：vitest 排除 `.worktrees/`（协作者重构副本双跑——此前 364 为双算值）；真实基线 198/41

### 审核基线校准（D108 补充）

- **SYSTEM_REVIEW 评分锚点**：85-100/70-84/55-69/0-54 语义标尺 + needsFix 判定说明（新库生效；既有库经提示词工作台同步）

## v0.24.3（2026-08-23）

### 安装方式
- **安装版**：`AI-Novel-Studio Setup 0.24.3.exe`（NSIS 向导版）
- **便携版**：`AI-Novel-Studio-0.24.3-portable-x64.exe`

### 变更（写书实战纠错批 A，详见 decision-log D106）

- **生产管线配置级错误熔断（ConfigError）**：API Key 解密失败 / 路由缺失 / key 未配置等确定性错误，此前生产管线逐章空转——书 #25 生产任务 28/29 曾 18/18、9/9 章全部失败于同一解密错误且章节被误标 failed、job 状态仍 done。现在：llm 层抛 `ConfigError`（解密失败带 cause 与「设置 → 供应商 重新保存 API Key」指引）→ generateChapter 恢复章节抢占前状态（不误标 failed）→ 生产管线首个即熔断上抛（job → failed），落实循环熔断纪律（AGENTS #11）
- **job 全失败不再虚报 done**：生产 job 结束时若 done=0 且 failed=total，状态改判 failed 并附错误摘要（任务中心可见），杜绝「全部失败却显示完成」
- 错误消息中文化 + 可操作指引；回灌阶段的 ConfigError 同样上抛（不多空转一章）
- 测试 182/182（+4：`tests/config-circuit.test.ts` —— ConfigError 分类 / cause 携带 / 章节状态恢复 / 整批熔断不误标）、typecheck/lint 0 error
- 文档（免发版内容随批）：2026-08-22 文档治理四项（乱码清零/README 修正/架构对齐/PLAN 归档，D104）+ 2026-08-23 竞品差距分析落档（docs/competitive-analysis.md，PLAN §2.1 backlog，D105）

## v0.24.2（2026-08-22）

### 安装方式
- **安装版**：`AI-Novel-Studio Setup 0.24.2.exe`（NSIS 向导版）
- **便携版**：`AI-Novel-Studio-0.24.2-portable-x64.exe`

### 变更（功能优化批 F：写书提效 + 复盘工具，详见 PLAN v0.24.2）

- **章节阅读/复盘视图**：章节执行页新增「阅读」模式——干净排版预览正文（复用 v0.23.0 的 .prose 排印类：CJK 悬垂标点 / 字号 13-24px 可调并持久化 / 上一章·下一章导航 / 字数·我的·AI 统计），直接服务"每卷完成抽读"验收流程；随时返回编辑
- **书内全文检索**：章节执行页左侧新增全书检索——正文/标题/角色/世界观设定/伏笔/事实/知识库文档按类型分组，命中窗口 snippet（±20/+40 字），300ms 防抖 + 过期响应丢弃；LIKE 通配符转义防全表命中、分组 LIMIT 护栏（50 万字量级单书扫描 <20ms）
- **版本 diff**：版本历史新增「对比当前」——行级 Myers diff（零依赖自研：前后缀修剪 + 中间段超限退化保护），恢复前可见 +N/-M 差异与逐行增删（着色走 CSS 变量）
- **方案整本生产入口**：方案页「试运行」面板新增「整本生产」——校验（启用/含 whole_book 步骤/有待生成章节）→ 绑定方案到书 → 入队 production job（与 /produce 共用原子查重）；单章试运行对整本步骤改为跳过留痕，消除"整本模式预留未实现"误导报错
- **回灌幂等核对**：确认 runProductionChapter 自带快照不含回灌，整本管道第 5 步是唯一回灌点（无重复写入）

- 测试 178/178（+12：diff 7 + 检索/方案整本 5）、typecheck/lint 0 error、db-smoke 7/7

## v0.24.1（2026-08-16）

### 安装方式
- **安装版**：`AI-Novel-Studio Setup 0.24.1.exe`（NSIS 向导版）
- **便携版**：`AI-Novel-Studio-0.24.1-portable-x64.exe`

### 变更（第三轮全面审查修复批 E：客户端重构，详见 decision-log D98/D102）

- **操作防重共享 hook（useActionRun）**：抽取 ChapterExecutionPage withBusy 的 ref 守卫语义（v0.17.0 审查 A2 同款——state 更新前的同帧双击此前可双跑）；VolumePanel / SetupPanel / TasksPage 三页接入（含 genVolumes/手动建卷/清理已完成等手动 setBusy 双轨收编）；SetupPanel 添加流派补 Enter+按钮双发守卫
- **硬编码颜色清零**：约 20 处改 CSS 变量 / `color-mix(in srgb, var(--x) N%, transparent)` 派生——三种互不一致的绿与幽灵蓝统一，亮色主题（paper/sepia）下徽标/边框/滚动条不再失真（此前白色滚动条近乎不可见）
- **轮询收编 react-query**：/jobs 四处查询（AppLayout 手写 setInterval / 列表页 / 任务中心 / 跟进页）统一共享 `['jobs']` 缓存（单一网络流 + 条件轮询保留）；AiStatusBar 手写轮询收编 `['director-status']` 共享 query（运行 3s/空闲 30s 巡检降频保留）；DebtFixBadge 无待修复债时停止 30s 空转轮询
- **SettingsPage 拆分**：1250 行 → 46 行页壳 + `pages/settings/` 6 面板文件（供应商/模型路由/成本/更新/写作/外观，同 tab 互引组件同文件）
- **ChapterExecutionPage 瘦身**：1976 → 1842 行——记忆面输入/质量债徽标/章节列表项拆至 `pages/chapter/`（编辑器/流式/动作面板与页面状态强耦合，保留并注释后续拆分方向）
- **构建稳健性**：manualChunks 引用的 @codemirror/language/state/view 由传递依赖转显式声明（消除 pnpm shamefully-hoist 依赖）

- 测试 166/166、typecheck/lint 0 error、e2e R7 全绿（T1 10/10 T2 30/30 T3 6/6 T4 7/7）

## v0.24.0（2026-08-16）

### 安装方式
- **安装版**：`AI-Novel-Studio Setup 0.24.0.exe`（NSIS 向导版）
- **便携版**：`AI-Novel-Studio-0.24.0-portable-x64.exe`

### 变更（第三轮全面审查修复批 D：执行面迁移，详见 decision-log D98/D101）

- **批量细化迁 job 队列**：`POST /chapters/refine-range` 此前在 HTTP 请求内循环逐章调 LLM（40 章 × 2048 token 可挂数分钟——长连接挂死风险 + 无取消/无进度）；现原子入队（同书同类型活跃态查重）+ scheduler 串行执行——幂等续跑语义保留（已有任务单跳过）、章间取消感知、任务中心可见进度时间线与中文类型名
- **方案生产迁 job 队列**：`POST /solutions/:id/produce-chapter` 此前在请求内直跑多步 LLM 流水线（每步最高 8192 token）；现入队返回 jobId，runProductionChapter 在步骤边界感知取消/看门狗中止，结果（字数/降级/步骤输出）入 resultJson；章节级并发仍由原子抢占守卫兜底
- **共享执行件**：refineOne 自 volumes.ts 迁 planner.ts（单章端点与批量 job 共用）；jobQueue 新增 enqueueTypedJob 通用入队；客户端新增 waitForJob 轮询助手（2s 间隔、15 分钟兜底），卷面板与章节执行页适配（完成后回显服务端落库正文 + 结果摘要）
- **e2e 适配**：round.mjs 批量细化两断言改 job 轮询口径

- 测试 166/166（+4：入队查重/refine 幂等跳过/章间取消/方案生产结果）、typecheck/lint 0 error、e2e R6 全绿（T1 10/10 T2 30/30 T3 6/6 T4 7/7）

## v0.23.1（2026-08-16）

### 安装方式
- **安装版**：`AI-Novel-Studio Setup 0.23.1.exe`（NSIS 向导版）
- **便携版**：`AI-Novel-Studio-0.23.1-portable-x64.exe`

### 变更（第三轮全面审查修复批 A+B，详见 decision-log D98/D100）

#### 稳定性（批次 A）
- **scheduler 崩溃防御**：损坏 payload_json 的 job 此前在 try 块外抛错 + tick 无 `.catch` → 未处理 rejection 可 crash 整个 server 进程；现在解析失败置 job failed，tick 链兜底捕获（+2 单测）
- **server-lost IPC 补全**：server 异常退出时 renderer 此前永远收不到通知（preload 未暴露）——现在 App 显示明确的重启引导面板，不再静默指向死服务
- **反 AI 自动重写修复**：重写 prompt 缺 "json" 字样却走 jsonMode（DeepSeek 硬要求，违者 400）——此前重写静默失效恒保留原文
- **max_tokens 截断检测**：流式/非流式读取 `finish_reason`——截断的半章不再静默落库为 written（显式失败+提示调大 max_tokens）；callLlmJson 截断即注入"精简输出"反馈重试（+2 单测）
- **SSE 错误复位守卫**：复位 failed 仅限自己抢占的 generating（对齐 generate.ts，防误标他方 written 章节）
- **退出与 IPC 加固**：before-quit preventDefault + 等待 server 优雅关闭（最长 3s）后再退出；updater 三操作与 theme-set 加主窗口顶层 frame 校验

#### 规范收敛（批次 B）
- **prompt 九处内联收敛 planner.ts**（#31）：novels（direction 定向重做上下文/framing notes/macro）、volumes（卷/节拍/章节清单——手动路由补齐流派模板与卷间钩子注入，消除与导演链的双向漂移）、worlds（世界三步 + 角色两批，webCtx 参数化）；getGenreTemplate/getPrevVolumeHook 迁入 planner 共享
- **修复链路 500 修复**：debtFix 销账 UPDATE 引用 quality_debt 表不存在的 updated_at 列（v0.10.0 引入，历史 e2e 轮 rescore 未达标而未暴露——R4 复测抓到，R5 全绿）
- **约束违反统计接通**：生成链路校验命中登记质量债（UI 遵守率统计此前恒 0）；同时修复 validateConstraints 反向条件 bug（注释"出现即违反"与实现相反）；去重写入防重生叠加（+3 单测）
- **quality-debts 契约 camelCase**（#20）：novel_id/high_count 等改 novelId/highCount（客户端同步）；versionDetail/pending 的过期类型注解一并修正
- **zustand 死依赖移除**（全仓库 0 import，D98 审查发现）
- **e2e 报告路径参数化**：硬编码本机绝对路径改仓库相对（他机/CI 可跑）
- **死代码清理**：runPlannerStage/JOB_TIMEOUT_MS/_attempt/客户端 hub.chat 双定义/主角名提取双实现合一（utils/protagonist）/约束 id 防撞后缀/3 文件 BOM/挤行

- 测试 162/162（+7）、typecheck/lint 0 error、db-smoke 7/7、e2e R5：T1 10/10 + T2 30/30 + T3 6/6 + T4 7/7

## v0.23.0（2026-08-14）

### 安装方式
- **安装版**：`AI-Novel-Studio Setup 0.23.0.exe`（NSIS 向导版）
- **便携版**：`AI-Novel-Studio-0.23.0-portable-x64.exe`

### 变更

#### UI 美化（修订版计划，对齐当前代码）
- **新增 sepia 主题**（暖色文学 Bear 风：#f4ecd8 底 / #a06a2c accent）——第 7 套主题；utils/theme.ts THEMES + main.ts nativeTheme（dark 判断）+ THEME_OVERLAY 联动。
- **修复 --bg-input 潜伏 bug**：被 9 处使用但从未在 `:root` 定义 → 补 `--bg-input: var(--bg-elevated)`（CSS 惰性求值，各主题自动跟随，无需 6 处重复）。
- **.prose 排印类就绪**：CJK 悬垂标点（hanging-punctuation: first last allow-end）+ font-feature-settings("palt" 1, "kern" 1)；用已有 --prose-*/--sp-*/--fs-* token。待章节阅读视图/导出预览应用（CodeMirror 编辑器已由 editor/theme.ts 全 var() 覆盖）。
- **未做（冗余/无场景）**：原计划任务 C/E（color-mix）——theme.ts 选中态已用 `var(--accent-soft-strong)`、活跃行 `var(--bg-elevated)`，全动态随主题变，color-mix 是冗余重构；任务 D（通用 Button 原语）——无新 UI 应用场景，建即死代码。
- 测试 155/155、typecheck/lint 0 error。

## v0.22.3（2026-08-14）

### 安装方式
- **安装版**：`AI-Novel-Studio Setup 0.22.3.exe`（NSIS 向导版）
- **便携版**：`AI-Novel-Studio-0.22.3-portable-x64.exe`

### 变更
- **修复**：应用单实例——再次点击快捷方式不再新开窗口，改为唤出已有实例（`requestSingleInstanceLock` + `second-instance` 聚焦；未获得锁的实例立即退出）；顺带杜绝多实例双 server 抢真实库的隐患

## v0.22.2（2026-08-14）

### 安装方式
- **安装版**：`AI-Novel-Studio Setup 0.22.2.exe`（NSIS 向导版）
- **便携版**：`AI-Novel-Studio-0.22.2-portable-x64.exe`

### 变更
- **书级「下一步」引导**：书工作区顶部常驻引导卡 + 章节执行页进度轻提示——`/status` 新增 nextSteps 规则引擎（生产进行中 / 继续生产正文 / 收尾修复质量债 / 已完成 四态），进书即知该干什么（如书 #25：卷 1 已完成 11/18 章、剩余 9 章 → 一键进章节执行）
- **方案 Agent 名称现代化**：「帝路十章」10 个 agent 改名（定策阁主→总策划、命途执笔→主线编剧、棋局推手→节奏策划、丹青妙笔→场景描摹、声韵师→对白编剧、鼓点手→爽点调度、青史主编→内容审校、红尘读者→读者视角、因果司→连续性检查、天命合卷→终审合稿）+ 职责说明补全；方案详情步骤列表展示「名称（职责）」
- 测试 155/155（+4 nextSteps 四态）

## v0.22.1（2026-08-14）

### 安装方式
- **安装版**：`AI-Novel-Studio Setup 0.22.1.exe`（NSIS 向导版）
- **便携版**：`AI-Novel-Studio-0.22.1-portable-x64.exe`

### 变更
- **修复**：知识库文档创建端点标题清洗（trim + 去除首部孤立 `?` 序列，全 `?` 标题拒 400）——防 kb_doc 标题 `?????` 前缀事故再犯（6 篇全局文档标题已由修正脚本修复，正文完好未受影响）
- 测试 151/151（+3 标题清洗：修剪/全?拒绝/正常不受影响）

## v0.22.0（2026-08-14）

### 安装方式
- **安装版**：`AI-Novel-Studio Setup 0.22.0.exe`（NSIS 向导版）
- **便携版**：`AI-Novel-Studio-0.22.0-portable-x64.exe`

### 变更

#### N1 字数记账语义修正（本地设计决策）
- **整章替换→覆盖语义**：generate/solutionRunner/debtFix/版本恢复/反AI重写/production 回写 6 处由 `ai_words += wordCount`（累加）改为 `ai_words = wordCount, human_words = 0`（覆盖）；防同章重生膨胀（累加下 3000+3500=6500 而当前内容仅 3500）。
- PATCH 增量编辑（volumes.ts delta）保留累加不动——区分「整章替换」与「增量编辑」两条路径。
- tooltip 文案「本书累计」→「当前内容 AI 字数 / 人工输入累计」，避免重生后数字虚高误导。
- 测试 +5（v0220.test.ts：generate 重生/版本恢复/solutionRunner/debtFix/反AI重写 覆盖语义）。

#### ALOW window.confirm → themed useConfirm 全统一
- 13 处 `window.confirm` 改 `useConfirm`：ChapterExecutionPage 5 处（generate 两步确认拆 generateContinue / 方案接力 / 采纳建议重写 / 版本恢复）、WorldPanel/CharacterPanel/VolumePanel/TasksPage/NovelWorkspacePage/StudioPage×2/SettingsPage×2（备份恢复+清除数据）。
- busy 守卫保持：confirm 提到 withBusy 外，run 仍 in withBusy（防连点双提交）。

#### 文档债重建
- **decision-log D36-D89 重建**：50 条乱码正文按 git 提交信息 + 已发布代码重建（不臆测，无法核实标「待核」）；D40-D56 ID 冲突加 b 后缀（D40b-D51b/D56b）。
- **banner 纠正**：§0.5 + decision-log + PLAN 各 banner 修正损坏范围（D80-D89→D36-D89、P18-P28→P18-P30+§12、补 5 个未标文件、删「正文见 CHANGELOG」误导——该段 CHANGELOG 亦损坏）。

- 测试 148/148、typecheck/lint 0 error。

## v0.21.0（2026-08-13）

### 安装方式
- **安装版**：`AI-Novel-Studio Setup 0.21.0.exe`（NSIS 向导版）
- **便携版**：`AI-Novel-Studio-0.21.0-portable-x64.exe`

### 变更

#### 第二轮全量审查修复批（v0.20.0 基线：新功能 2 HIGH/3 MEDIUM + 第一轮残留收敛 + P3 全量）

**P0 · 已发布功能核心正确性**
- **N1 字数分离语义修正（累计）**：AI 产出改**服务端记账**（生成/方案流水线/质量债修复落库时 `ai_words += wordCount`——此前 SSE 生成直接落库不经客户端 delta → 计数器恒 0）；客户端流式 onDelta 停止本地累计（消除双计）；顶部 tooltip 明确「本书累计」语义；版本恢复不重复计
- **N2 光标续写跨章 race**：suggestContinue 持 AbortController + seq 校验 + 切章 abort——旧章响应不再串入新章

**P1**
- N3 Tab 仅在编辑器聚焦且有建议时 preventDefault 插入（不再全局吞 Tab）
- N4 记忆面操作 busy 锁（ref + disabled）
- H1 删除 ApiError 死代码类；M11 主角名替换改**冲突保护前缀**（≥2 字 + 其他角色名以该名结尾时保护——「林惊蛰」内不误伤「惊蛰」）；M8 本地 JSON_FORMAT 改 import

**P2**
- N5 NovelMemory/RunTrace 契约类型入 shared；M10 reserved 回传 + 模型路由页「预留」徽标禁编辑；M17/M20 信号防御（SIGINT/SIGBREAK/SIGTERM，查证确认 Windows 上 SIGTERM 不触发）；A32 步骤列表键盘路径（Alt+↑/↓）+ ARIA；5 页 6 处 window.confirm → themed 确认统一

**P3 全量**
- shared 实体类型补全（Agent/Skill/Solution/Genre/StyleAsset/PromptAsset/ChapterDetail/Asset）；mojibake 重编码（shared/types.ts + AGENTS.md）；依赖精确锁定（epub-gen-memory/openai）；migrate 数组物理排序；analysis 死 fetch 清理；webSearch catch 细化（zh 失败不误降级 en）；记忆面势力读改写加事务；ledger states 上限 100；JobTrace 渲染切片；WebSearchToggle 加载失败态；CSP 补 object-src/base-uri

- 测试 143/143（+5：M11 边界/1 字保护/嵌套保护/ledger 上限/N1 记账语义）

- 419e510 feat: 第二轮审查修复批（N1 字数记账/N2 续写 race/N3-N5 + 残留收敛 + P3 全量：实体类型补全/confirm 统一/事务/上限/CSP）（v0.21.0）

## v0.20.0（2026-08-13）

### 安装方式
- **安装版**：`AI-Novel-Studio Setup 0.20.0.exe`（NSIS 向导版）
- **便携版**：`AI-Novel-Studio-0.20.0-portable-x64.exe`

### 变更

#### NovelClaw 学习组（可检视写作工作空间）
- **生产运行轨迹时间线**：生产/质量债修复任务的每阶段进度追加时间线（时间/章节/动作/完成比，去重+限 300 条）——任务中心展开可见（NovelClaw progress.log 事件化主张）
- **记忆面**：章节页「记忆面」面板——状态机显式视图（角色状态历史 / 势力当前状态 / 待确认事实），支持手动增删角色状态、修正势力状态（AI 回灌与手动修正共用同一账本）
- **故事板视图**：卷规划页全书章节切换为卡片网格（按卷分组：卷标题 + 章节卡片含状态/字数着色）
- **全局角色库**：已有 base-characters 全局模板（创建/从角色存库/应用到书）——复用，无需新建
- 测试 138/138（+4 记忆面：聚合/增删/势力/404）

- 911e4f5 feat: NovelClaw 学习组——生产运行轨迹时间线 + 记忆面（状态机查看/手动修正）+ 故事板视图（全局角色库已存在，复用）（v0.20.0）

## v0.19.0（2026-08-13）

### 安装方式
- **安装版**：`AI-Novel-Studio Setup 0.19.0.exe`（NSIS 向导版）
- **便携版**：`AI-Novel-Studio-0.19.0-portable-x64.exe`

### 变更

#### 编辑器光标续写（NovelCraft 学习组）
- **Cmd/Ctrl+J 光标处续写**：编辑器任意位置触发 → AI 按光标前文（带书级约束/写法规则）生成续写建议浮层
- **建议浮层**：预览文本 + 字数 + Tab 插入 / Esc 关闭 / ↻ 再生成；插入带 AI 来源标记
- 复用既有 continue 动作链路（选区工具「续写」同步受益）

#### 人类/AI 字数分离
- **来源追踪**：编辑器变更按来源统计（AI 写入带 Annotation 标记；流式生成/续写/选区 AI 操作计入 AI；人工输入/粘贴计入我的）
- **服务端累计**：v20 迁移 chapter.ai_words/human_words；保存时增量上报（delta 累加不覆盖）
- **顶部展示**：「我的 X · AI Y」（NovelCraft 风格——你的字 vs AI 贡献）
- 测试 134/134（+3：迁移列/delta 累加/零增量）

- 7ca9479 feat: 编辑器光标续写（Cmd/Ctrl+J 建议浮层 → Tab 插入）+ 人类/AI 字数分离（来源追踪 · 服务端累计 · 顶部展示）（v0.19.0）

## v0.18.0（2026-08-13）

### 安装方式
- **安装版**：`AI-Novel-Studio Setup 0.18.0.exe`（NSIS 向导版）
- **便携版**：`AI-Novel-Studio-0.18.0-portable-x64.exe`

### 变更

#### 联网查找（可开关 · 零 key）
- **开关**：设置 → 写作 → 「联网查找」（默认关闭；全局 app_settings，v19 迁移）
- **零 key 端点**：Wikipedia action API（中文优先、英文兜底；DDG Instant Answer 查证后弃用——无结果）
- **知识库「联网搜索」**：搜索设定资料（标题/摘要/来源 URL）→ 一键导入为知识库文档（含引言摘要正文，可被检索注入生成上下文）
- **世界观生成可选注入**：开启后 world/generate 自动用书灵感搜索 Wikipedia，注入「联网资料」参考块
- **降级纪律**：5s 超时、失败静默返回空、1h 模块缓存——离线/无结果零影响
- 测试 131/131（+6：开关/中文命中/英文兜底/网络失败/注入空串）

- 322e77e feat: 联网查找可开关（零 key Wikipedia · 知识库一键导入 · 世界观生成可选注入 · 失败静默降级）（v0.18.0）
- 6da7966 fix: 打包态验收 env 加 AI_NOVEL_ALLOW_PLAINTEXT（独立 server 调试模式，M2 fail-closed 配套）

## v0.17.0（2026-08-13）

### 安装方式
- **安装版**：`AI-Novel-Studio Setup 0.17.0.exe`（NSIS 向导版）
- **便携版**：`AI-Novel-Studio-0.17.0-portable-x64.exe`

### 变更

#### 全量源码审查修复批（0 CRITICAL / 11 HIGH / 45 MEDIUM / 25 LOW 全量收敛）

**章节状态机自愈**（H2/H3/H4）
- 生成链路抢占后 try/catch 复位（空内容/异常 → `failed`，不再永久卡 `generating`）；重启重置遗留 generating 章节
- 创作中枢生成工具超时改 AbortSignal 真实中断（不再僵尸请求烧 token）

**安全加固**（H6/H7/M1/M2/M19）
- wipe-data 先优雅关闭 server（释放 db 句柄）再删除，杜绝 EBUSY/孤儿进程
- safeStorage 不可用时**拒绝明文落库**（fail-closed，不再降级回明文）；keyCrypto 非 utility 模式同样 fail-closed（显式调试开关）
- null Origin 无 token 一律 403（不再裸奔）；破坏性 IPC 校验 sender frame
- 打包态 CSP（script-src 'self'）

**正确性 HIGH**（H1/H5/H8/H9/H10/H11）
- 汇率修复：`/api` 双拼路径改 apiFetch（汇率不再恒 7.2）
- 用户创建智能体 `is_custom=1` 落库（可删除）；技能挂载状态从服务端真实回显（不再恒"未附加"）
- mergeBusy/select 结构/ApiError 状态码路由等

**契约与约束合规**
- REST 统一 camelCase（usage stats / pending / version / skills——前端全链同步）
- planner prompt/解析统一（routes 不再本地重复漂移）；预留路由 reserved 落库（v18 迁移）；if.field 条件分支真正消费

**主进程健壮性**
- 自动备份 await checkpoint（不再复制陈旧主库）；restore await 进程退出（替代固定延时）；优雅关闭链路（shutdown 消息 → server.close + stopScheduler）；server 失联清理并通知渲染端；.npmrc 机器相关配置移至 .npmrc.local

**前端并发纪律与质量（40+ 处）**
- 约 15 个面板统一 ref 守卫/disabled/try-catch（双击/重叠提交/吞错收敛）；a11y（资源树键盘、命令面板 dialog、Toast aria-live）；性能（快捷键 effect、localStorage 解析缓存、轮询条件化）；死代码/双转型/非空断言清理

**测试**：125/125（+状态机重置/is_custom/reserved/camelCase 契约/fail-closed 5 例）

- df96f00 feat: 全量审查修复批（0 CRITICAL/11 HIGH/45 MEDIUM/25 LOW 收敛——状态机自愈/安全加固/snake_case 契约/并发纪律/代码质量）（v0.17.0）

## v0.16.3（2026-08-13）

### 安装方式
- **安装版**：`AI-Novel-Studio Setup 0.16.3.exe`（NSIS 向导版）
- **便携版**：`AI-Novel-Studio-0.16.3-portable-x64.exe`

### 变更
- **修复**：更新页「当前版本」不显示（v—）——updater 状态广播与 IPC 返回统一携带版本号，renderer 增加编译期版本兜底（`__APP_VERSION__`）

- 8eb21c9 fix: 更新页版本号显示——broadcast 统一带 currentVersion + renderer 用 __APP_VERSION__ 兜底（v0.16.3）

## v0.16.2（2026-08-13）

### 安装方式
- **安装版**：`AI-Novel-Studio Setup 0.16.2.exe`（NSIS 向导版）
- **便携版**：`AI-Novel-Studio-0.16.2-portable-x64.exe`

### 变更
- **修复**：检查更新改为静态导入 `electron-updater`——此前动态 `import()` 对 CJS 包的命名导出检测失败（`autoUpdater` 解构为 undefined），点击「检查更新」报 `Cannot read properties of undefined (reading 'checkForUpdates')`（与网络无关）
- **加固**：updater 各 IPC 增加模块可用性防御（不可用时返回明确错误文案，不再裸抛）；启动静默检查同路径修复

## v0.16.1（2026-08-13）

### 安装方式
- **安装版**：`AI-Novel-Studio Setup 0.16.1.exe`（NSIS 向导版）
- **便携版**：`AI-Novel-Studio-0.16.1-portable-x64.exe`

### 变更
- **修复**：nsis artifactName 固定横线命名——产物文件名与 latest.yml 一致（此前产物含空格而 updater 元数据用横线名，自更新下载会 404）

## v0.16.0（2026-08-13）

### 安装方式
- **安装版**：`AI-Novel-Studio Setup 0.16.0.exe`（NSIS 向导版）
- **便携版**：`AI-Novel-Studio-0.16.0-portable-x64.exe`

### 变更

#### 检查更新（应用自更新）
- **electron-updater 接入**：`build.publish` = GitHub provider；CI 上传 `latest.yml`（自更新元数据）
- **主进程**：打包态启用（开发模式自动跳过）；启动 5s 静默检查（不打扰）；IPC 检查/下载/重启安装 + 下载进度转发
- **设置页「更新」tab**：当前版本 / 手动检查按钮 / 状态流转（检查中→发现新版→下载进度条→重启安装）；已是最新/失败提示
- **便携版提示**：不支持自动更新（electron-updater 限制），引导去 GitHub Releases 手动下载

#### 成本人民币显示
- **定价基准查证**：DeepSeek 官方定价页（2026-08-13）确认为 **USD 计价**（deepseek-v4-flash $0.0028/$0.14/$0.28 每百万，与现表一致）——内部统一 USD（官方与 OpenCode Go 网关同基准），显示层人民币
- **汇率机制**：启动自动联网获取实时汇率（免 key 端点 `open.er-api.com`，失败静默降级保留现值）+ 设置页可手动覆盖（手动后不再被自动覆盖，可一键恢复自动）
- **统一人民币显示**：成本仪表盘（预估成本 CNY）、月度预算「本月已用/超预算」比较修正（此前 USD 数值直接贴 ¥ 的错配）、章节页成本预估/流式统计（fmtCost × 汇率）
- **服务端换算**：`/settings/app`、`/settings/usage/stats` 直接返回 CNY

- 67e02fd feat: 检查更新（electron-updater 自更新 · 设置页更新区）+ 成本人民币显示（汇率自动获取/手动覆盖 · 定价 USD 基准查证）（v0.16.0）

## v0.15.0（2026-08-13）

### 安装方式
- **安装版**：`AI-Novel-Studio Setup 0.15.0.exe`（NSIS 向导版）
- **便携版**：`AI-Novel-Studio-0.15.0-portable-x64.exe`

### 变更

#### 用户创作约束机制（v0.15.0 核心）
- **约束分级**：硬约束（MUST，不可违反——主角名/叙事红线/禁写内容）与软偏好（SHOULD，倾向性）分级维护；存储于 `novel.constraints_json`（v16 迁移），独立于 framing 永不被导演覆盖
- **全链强制注入**：统一「创作指导」块（硬约束 + 设定简报 + 书级引导）接入导演全部阶段、方案全部步骤、章节生成、自动修复/回灌链——修复过程不违背约束
- **确定性校验**：章节产出后主角名自动对齐（角色表主角名 ≠ 规范名时自动替换 + 告警）；导演角色阶段产出主角名不符自动重试一次；字数异常区间告警
- **UI 三级入口**：建书表单「硬性要求」、书工作区「创作约束」tab、章节页「固定为约束」按钮（一句反馈直接沉淀为书级硬约束）
- **方案包携带建议约束**：solution-pack 支持 `suggestedConstraints`，导入时提示可应用
- **约束遵守率**：违反记录入质量债，统计端点按书输出 `constraintAdherence`

#### 写书流程修复（30 万字项目实战沉淀）
- 设定简报机制：导演阶段注入书级设定简报（此前只注入章节生成，导致导演产出世界观完全跑偏）
- 全局知识库修复：v15 迁移全局占位书（novel_id=0），/knowledge 检索 `IN (0, ?)`，novels 列表过滤占位书
- 导演 framing 覆盖修复（spread 保留既有字段）+ world 行缺失时 INSERT OR IGNORE
- 真机修正：书 #25 主角名对齐 Jing（角色表/正文/简报全量替换）

#### 规范
- **versioning 1.0 判据修订**：稳定承诺语义——真实写书完成 + 核心链 1-2 版无 P0/P1 + 数据格式冻结（不再绑定跨端）

- 3209b79 feat: 用户创作约束机制（硬/软分级 · 全链注入 · 确定性校验 · 主角名自动对齐）+ 写书修复（设定简报/全局知识库/versioning 1.0 判据）（v0.15.0）
- de70c20 chore: 仓库整理（CodeQL workflow + README badge + Release body 自动化 + 安全功能开启）（免发版）
- fd76abb fix: release versioning 自动标记补 writeFileSync import + 0.14.0 ✅（scripts，免发版）

## v0.14.0（2026-08-12）
> 注：v0.9.2–v0.14.0 段原正文因 PowerShell 中文编码事故损坏（D90②，字节级有损不可恢复，git 各历史提交亦已损坏）；本段按 git 提交信息 + decision-log D79–D89 + 已发布代码重建（v0.23.1 批次 C 文档债偿还，不臆测）。

### Added
- **批F 风格指纹（I5）**：Stylometry 文体计量学零 LLM 统计提取（句长分布/高频词/句式/标点/段落节奏）→ 指纹入库 + style_asset 自动归档；端点 `POST /style/fingerprint` 生成章节指纹并抽样展示；UI 展示（长度分布/词频/句式偏好/重复度/标点）
- **release 发布后台账自动翻转**：发布成功后 versioning.md §7 状态自动标记 ✅
- 测试 101/101（+5 指纹用例）；**O1-O5 + I1-I5 第二轮路线图全量完成**（v0.9.2 → v0.14.0）

## v0.13.0（2026-08-12）

### Added
- **批E 世界状态机（I4）**：势力状态 backfill（writeFactionStates → factions_json.currentState）+ 时间线消费（getTimelineEvents 取最近 5 章 chapter_id 关联事件注入生产上下文，含类型 marker）
- **文档断言机制**：verify-docs.mjs（脚本化 replace 后 grep 命中目标串，失败即报错；覆盖 CHANGELOG/versioning/PLAN）并入 release.mjs [3/7]；AGENTS #61b 文档断言纪律

### Fixed
- release 流程 vitest 防假 PASS（失败重试一次 + 输出校验）
- versioning.md §7 台账补齐（v0.5.0 误标 0.4.0 等 8 处，0.5.0–0.13.0 全量对齐）

- 测试 96/96（+4 状态机/文档断言用例）

## v0.12.0（2026-08-12）

### Added
- **批D P31 方案感知卷章**：整本生产流水线注入卷章定位——chapterRole.getChapterPosition（卷/章/序/总数/前后章）→ chapterPositionBlock 注入 runProductionChapter prompt，消除「章节定位不明/角色无锚点」；mc-good2.0 真机验证 3 章（2514/1903/2045 字，outline/场景/对话定位正确）
- 测试 92/92（+3 卷章定位用例）

## v0.11.1（2026-08-12）

### Fixed
- **智能体删除端点**（DELETE /:id，此前 404）：内置智能体不可删 409、被方案引用（json_each）409、agent_skill 级联清理
- **乱码清零**：3 处 EmptyState 文案 + 全库 `[?]{4,}` 扫描（8 个文件清查）

### Changed
- **空状态引导卡片**：标题工坊/基础角色库/拆书 3 页接入统一空态 + 创造工坊选项 6 → 10

- 测试 89/89（+4 删除端点用例）

## v0.11.0（2026-08-12）

### Added
- **solution-pack 方案包**：kind/id/version/metrics/sampleBook 自包含格式（内嵌 agent/skill 依赖，按 id + hash 防重复导入）
- **GitHub 仓库方案市场**：solutions/ 目录 + index.json 索引（raw.githubusercontent.com 分发，安装/更新/回退）；export-market-pack.mjs 生成 + publish-solution.mjs 发布（npm manifest 规范：name+version 唯一标识、kebab-case id、description+tags）；样例 mc-good2.0 v1.0.0（10 智能体）

### Fixed
- 弃用 GitHub Pages 市场分发（部署持续失败，pages.yml `if: false` 停用）

- 测试 85/85（+5 方案包用例）

## v0.10.0（2026-08-12）

### Added
- **O5 成本预警月度预算**：月度预算设置（app_settings cost_monthly_budget，默认 0 不限）+ 用量统计 + 超预算告警
- **I2 质量债自动修复闭环**：修复逻辑收敛 services/debtFix（fixChapterOnce：定位/修复/校验/销账），经 debt-fix job 由 scheduler 串行执行——护栏：每章自限轮次（最多 2 轮）+ 同签名防重复烧 LLM + 修复达标自动销账（参考 Anthropic evaluator-optimizer 模式设护栏）
- **显式 UI**：设置开关（默认开）+ 质量债计数 + 30s 轮询修复进度
- 测试 80/80（+7 预算/闭环用例）

### Changed
- AI 修复链路从「审核建议人工处理」升级为「自动闭环 + 显性可控」

## v0.9.3（2026-08-12）

### Fixed
- **SDK 重试叠加**：openai SDK 默认自动重试 2 次（429/408/409/≥500）与候选链 tryCount 3 叠加（429 时最多 9 次调用）→ 显式 `maxRetries: 1`，重试统一由候选链管理
- **Node close 语义勘误**（D75 → D80）：IncomingMessage 'close' 行为变更自 v16.0.0（socket 空闲即触发），非 Node24 专属——SSE 断连判定改 res.on('close') + writableEnded；不依赖 v17+ 的 'aborted' 事件

### Changed
- **查证纪律入规**：AGENTS #61——实现前必须上网查证官方文档，结论回写 decision-log；本地设计决策显式标注「本地设计」

## v0.9.2（2026-08-12）

### Added
- **O1 发布自动验收**：v072-pack-verify.mjs（独立 server 打包态等价验收：鉴权 403 拦截/SSE 真实生成/导出）并入 release.mjs [7/7]
- **O4 每日自动备份**：启动检查 + 备份前 WAL checkpoint + 保留最近 N 份轮转 + 设置页展示备份信息

### Changed
- **O2 双 LLM 路径合并**：callLlm 支持 stream/onDelta/onThinking，流式生成统一走 callLlm（generate.ts 弃用客户端专用流式路径，统一 buildBody/候选链）
- **O3 真机 e2e 门禁**：p30-mcgood2-e2e.mjs（FF_DIR 环境变量）接入 release --e2e 可选门禁


## v0.9.1（2026-08-12）

### Added
- 开源准备：LICENSE（MIT）、CONTRIBUTING、CODE_OF_CONDUCT、SECURITY、Issue 模板
- 入门教程（docs/getting-started.md）

### Changed
- release-notes.md 更名为 CHANGELOG.md（Keep a Changelog 格式）
- 敏感路径参数化（e2e 脚本 FF_DIR 环境变量、脚本 ROOT 自动推导）
- README 开源化（badge/Why/FAQ/测试数校准）

## v0.9.0（2026-08-12）

### 安装方式
- **安装版**：`AI-Novel-Studio Setup 0.9.0.exe`（NSIS 向导版：可选安装目录 + 卸载入口）
- **便携版**：`AI-Novel-Studio-0.9.0-portable-x64.exe`（数据跟随可执行文件 data/ 目录，可放 U 盘）

### 全项目审查批3+4（安全/正确性/客户端收敛）

**安全与错误收敛**
- 错误响应不再泄露内部细节（SQLite 约束文本/文件路径/TypeError 原文 → 固定文案，详情进服务端日志）
- Electron 加固：sandbox 开启、外链仅放行 http/https、阻止窗口导航到外部站点
- 系统密钥存储不可用时明确告警（此前静默明文降级）

**正确性**
- 知识库检索缓存改为全量内容校验（改第 200 字符之后的内容也会失效）+ 容量上限
- LLM 调用超时真正中止底层请求（此前超时后继续跑至 120s）；重试只重试当前失败的候选，429 尊重 Retry-After
- 生产方案绑定校验（不存在/已停用拒绝）并回传绑定状态；内置 provider 编辑不再被误标记为自定义
- 方案步骤条件分支（step.if）与多轮审校（reviewRounds）真正生效
- 智能上下文随书推进增量更新（新写 5 章或 1 小时自动刷新，不再永久冻结）

**客户端修复**
- 写作偏好设置/删除智能体/方案导出修复（此前裸请求导致功能失效或"假成功"）
- 跨书切换时创作中枢对话重置；轮询请求不再重叠堆积

**方案生产健壮性**
- 大纲步骤 JSON 输出预算提升 + 失败重试注入反馈（截断可自愈）+ 兼容顶层/包装两种输出形态——mc-good2.0 真机 10 步全成功、3756 字

## v0.8.0（2026-08-12）

### 安装方式
- **安装版**：`AI-Novel-Studio Setup 0.8.0.exe`（NSIS 向导版：可选安装目录 + 卸载入口）
- **便携版**：`AI-Novel-Studio-0.8.0-portable-x64.exe`（数据跟随可执行文件 data/ 目录，可放 U 盘）

### 全项目审查 · P30 正确性修复
- **方案生产配置不再丢失**：UI 创建/编辑 whole_book 方案时 `production` 字段此前被静默剥离（流水线退化为 draft 拼接），已纳入校验并随导入导出保留
- **上下文裁剪保任务单**：预算裁剪改为按段切分逐段移除——【本章任务单】不再被连带整段删除；极端超限改为硬截断（此前超预算文本原样送入模型）
- **章节生产原子抢占**：方案生产与整本生产/SSE 生成并发写同一章时，后者拒绝（409）而非双写覆盖；失败自动释放状态
- **正文类步骤提示词不再要求 JSON**：消除"只输出 JSON"与纯文本解析的矛盾指令（防 JSON 包装符作为正文落库）
- **任务看门狗修正**：以进度活跃度判定超时（活跃任务不再被 30 分钟阈值误杀）；真挂死任务在章节边界自检中止，不再"显示失败但继续写库"
- **整本生产不再静默吞错**：方案流水线回退、回灌失败均记录日志；whole_book 判定改为解析步骤（角色文本含"whole_book"字样不再误判）

## v0.7.3（2026-08-12）

### 安装方式
- **安装版**：`AI-Novel-Studio Setup 0.7.3.exe`（NSIS 向导版：可选安装目录 + 卸载入口）
- **便携版**：`AI-Novel-Studio-0.7.3-portable-x64.exe`（数据跟随可执行文件 data/ 目录，可放 U 盘）

### Node24 SSE 回归修复（核心功能）
- **SSE 章节生成不再被自己立即中止**：Node 24 的 `req.on('close')` 在请求体读完即触发（旧版语义为连接关闭）——此前「AI 生成正文」在发出 context 事件后直接断流、0 字产出。修复为监听响应流 + 正常结束守卫（仅客户端真正断连/取消才中止）
- **打包态等价验收**：模拟打包环境（Origin:null + X-App-Token）全链路实测——鉴权 403 拦截 / SSE 真实生成 1180 字 / 章节导出 1197B，全部通过

## v0.7.2（2026-08-12）

### 安装方式
- **安装版**：`AI-Novel-Studio Setup 0.7.2.exe`（NSIS 向导版：可选安装目录 + 卸载入口）
- **便携版**：`AI-Novel-Studio-0.7.2-portable-x64.exe`（数据跟随可执行文件 data/ 目录，可放 U 盘）

### 全项目严格审查 · 发布阻断修复
- **SSE 生成 + 章节导出补鉴权 token**：打包态（Origin=null）下「AI 生成正文」与「TXT/MD/EPUB 导出」此前缺 `X-App-Token` 必然 403——修复后核心功能在打包版可用
- **生成收尾防重复追加**：完成/取消/失败路径不再把尾部文本重复写进正文（此前可能静默污染章节并保存）
- **删除小说先取消任务**：运行中的导演/整本生产 job 置 cancelled 而非删除——流水线能感知取消，不再对已删书继续烧 LLM 额度

## v0.7.1（2026-08-11）

### 安装方式
- **安装版**：`AI-Novel-Studio Setup 0.7.1.exe`（NSIS 向导版：可选安装目录 + 卸载入口）
- **便携版**：`AI-Novel-Studio-0.7.1-portable-x64.exe`（数据跟随可执行文件 data/ 目录，可放 U 盘）

### P30 真机修复（回滚修复）
- **正文类步骤改纯文本输出**：draft/scene/dialogue/final 不再走 JSON 校验（此前 flash 纯文本被误杀，9/10 步降级、流水线退化为单次调用）
- **Feelfish 导入引用 key 修复**：agent 按文件名 id（mc-xxx）匹配（此前用中文名导致「引用未知智能体」）
- **验收结果**：mc-good2.0（10 位大师）真机跑通——10 步全成功、11857 字/138s、正文质量通过

## v0.7.0（2026-08-11）

### 安装方式
- **安装版**：`AI-Novel-Studio Setup 0.7.0.exe`（NSIS 向导版：可选安装目录 + 卸载入口）
- **便携版**：`AI-Novel-Studio-0.7.0-portable-x64.exe`（数据跟随可执行文件 data/ 目录，可放 U 盘）

### 章节生产流水线（P30）
- **方案驱动正文生成**：方案的「章节生产」步骤（情节规划 → 场景/对话 → 审校 → 最终合并）接力产出正文——对齐 Feelfish 的 10 智能体章节流程
- **产出类型**：每步可配置（大纲/正文片段/对话/场景/审校意见/最终合并），最终合并落库 + 版本快照 + 回灌
- **书级绑定**：书可绑定生产方案，整本批量生产逐章自动走流水线（未绑定走默认生成）
- **章节执行页**：「以方案生产正文」按钮（空章节专用）
- **创造工坊**：步骤编辑器支持「章节生产」阶段与产出类型配置

## v0.6.2（2026-08-11）

### 安装方式
- **安装版**：`AI-Novel-Studio Setup 0.6.2.exe`（NSIS 向导版：可选安装目录 + 卸载入口）
- **便携版**：`AI-Novel-Studio-0.6.2-portable-x64.exe`（数据跟随可执行文件 data/ 目录，可放 U 盘）

### Agent 体系补全（P29）
- **智能体库页**（侧栏「资产」组）：全局管理智能体——编辑职责描述 / body_md（职责/标准/原则）/ 系统提示词、启用停用、新建与删除（内置保护）
- **技能挂载**：智能体可挂载/卸载技能（agent_skill 接线），方案运行时自动注入挂载技能
- **内置 5 智能体资产化**：主编/审校/角色顾问/世界观顾问/文风顾问补充结构化定义（对齐 Feelfish 风格），方案运行效果更稳定
- **AI 团队面板**：书内 tab 增加「打开智能体库」入口

## v0.6.1（2026-08-11）

### 安装方式
- **安装版**：`AI-Novel-Studio Setup 0.6.1.exe`（NSIS 向导版：可选安装目录 + 卸载入口）
- **便携版**：`AI-Novel-Studio-0.6.1-portable-x64.exe`（数据跟随可执行文件 data/ 目录，可放 U 盘）

### 图标重制（P28）
- **新图标**：kimi-k3 生成「羽笔 + 星光」设计（透明背景 SVG → sharp 渲染 512/256 PNG）
- **透明修复**：旧图标 PNG 无 alpha 通道（白色外围）——新转换链保证 RGBA 透明（校验角落 alpha=0），窗口/任务栏不再有白边
- 全平台替换：应用图标（安装包/任务栏/窗口）+ 介绍站图标

## v0.6.0（2026-08-11）

### 安装方式
- **安装版**：`AI-Novel-Studio Setup 0.6.0.exe`（NSIS 向导版：可选安装目录 + 卸载入口）
- **便携版**：`AI-Novel-Studio-0.6.0-portable-x64.exe`（数据跟随可执行文件 data/ 目录，可放 U 盘）

### UX 强化（P27）
- **快捷键自定义系统**：6 个动作（命令面板/保存/生成/审核/回灌/专注模式）全部可自定义——设置 → 外观 → 快捷键「录制」按组合键，冲突检测 + 恢复默认；Help 页实时显示
- **Ctrl+K 命令面板**：搜索小说 + 跳转页面（键盘导航，Esc 关闭）
- **专注模式**：章节执行页全屏写作（隐藏左右栏，Ctrl+Shift+F 或 Esc 切换）
- **任务进度浮层**：侧栏「AI 运行中」点击展开实时进度条（自动导演/批量生产）+ 一键跳任务中心
- **小说列表最近使用排序**：按打开时间排序（v12 last_opened_at）
- **导演启动预览**：启动前显示预计调用次数/耗时/可取消提示

### Bug 修复
- **window.prompt 全面替换**（Electron 不弹窗的系统性 bug）：提示词新建/手动建卷/建技能/建章节改用应用内对话框；提示词新建后列表即时刷新
- **乱码清零**：流派管理/基础角色库残留问号修复 + 全库扫描
- **界面字体可调**：设置 → 外观 → 字体新增「界面字体」（雅黑/黑体/思源黑体/系统默认），全站生效
- **标题栏左距**：最小 padding（不再贴左边缘）
- **移除重复入口**：侧栏「模型路由」并入设置页 tab

## v0.5.2（2026-08-11）

### 安装方式
- **安装版**：`AI-Novel-Studio Setup 0.5.2.exe`（NSIS 向导版：可选安装目录 + 卸载入口）
- **便携版**：`AI-Novel-Studio-0.5.2-portable-x64.exe`（数据跟随可执行文件 data/ 目录，可放 U 盘）

### 体积修复
- **安装包 343MB → 约 136MB**：@fontsource 三包（207MB 构建期资源）从运行时依赖转 devDependencies（字体已由 vite 打包进渲染层，node_modules 源包无需进 asar）
- 功能无变化（v0.5.1 等价）

## v0.5.1（2026-08-11）

### 安装方式
- **安装版**：`AI-Novel-Studio Setup 0.5.1.exe`（NSIS 向导版：可选安装目录 + 卸载入口）
- **便携版**：`AI-Novel-Studio-0.5.1-portable-x64.exe`（数据跟随可执行文件 data/ 目录，可放 U 盘）

### UI 统一化（P25）
- **间距/字号/圆角标准**：CSS 工具类（mt/mb/gap/p 栅格、t1-t3 文本层级、icon-gap）——内联样式 849 → 585 处收敛，全站视觉一致
- **状态反馈**：按钮/列表项按压动效（:active scale）、hover 过渡统一、面板 hover 提亮
- **badge 语义变体**：ok/warn/danger/plain 类（收敛内联色）
- **版本号单一来源**：侧栏显示改为 vite define 注入（修复硬编码 v0.2.0 与实际版本脱节）

### 规范补强（清理红叉）
- **合入门禁**（versioning §3.1）：功能合入 main 即 bump 发版，禁止"合入未发版"（本地 release/ 与文档落后）
- **CI 红叉清零**：13 个失败/取消记录已删除；Deploy Site 停用（GitHub Pages 未启用，启用条件写入 site/README.md）
- **红叉不隔夜纪律**（versioning §3.2 + AGENTS 58）

## v0.5.0（2026-08-11）

### 安装方式
- **安装版**：`AI-Novel-Studio Setup 0.5.0.exe`（NSIS 向导版：可选安装目录 + 卸载入口）
- **便携版**：`AI-Novel-Studio-0.5.0-portable-x64.exe`（数据跟随可执行文件 data/ 目录，可放 U 盘）

### 资产库统一建设（P23）
- **统一资产创建器**（9 个库页接入）：三模式 = 上传文件（TXT/MD/EPUB 自动分章）+ 粘贴文本 + 手动填写 → AI 提取结构化草稿 → 人工修改 → 保存
- **知识库**：新增创建入口（此前只有删除）+ AI 生成文档
- **世界样本库**：上传/粘贴 → AI 生成世界手册+势力（此前只能从书提取）
- **推进模式库**：AI 生成 cadence/density/beats（修复硬编码占位字段）
- **写法引擎**：上传/粘贴 → AI 提炼写法特征 + 反 AI 词（此前仅粘贴样本提取）
- **流派管理**：AI 生成流派模板（推进/兑现/冲突/黄金三章）
- **反 AI 规则**：新建词库 + AI 从文本提炼 AI 腔词
- **标题工坊**：自由输入（题材/风格）→ AI 生成 10 个标题（不依赖已有书）
- **基础角色库**：AI 生成角色模板 + 手动创建（此前只能从书存模板）
- **拆书**：导入外部文件（TXT/MD/EPUB）→ 建外部书 → 直接拆书/角色分析/资产发布

### 缺口补齐（全面审查 N1-N10）
- **修复编码乱码事故**：章节执行页 + 5 页空状态（P22 引入）；EmptyState 图标全面改 lucide 组件
- **章节手动创建**：任意新建空章（此前全站无入口）
- **卷手动创建**：卷面板「+ 手动建卷」
- **生成引导输入**：世界观/角色生成前可输入要求（服务端早已支持 guidance）
- **创造工坊**：技能库可新建/删除；方案可删除
- **提示词工作台**：可新建自定义提示词；「还原出厂」真正恢复出厂模板
- **AI 团队**：章节下拉选择（替代手输 ID）
- **世界样本库死按钮修复**（复制样本 JSON）

### 工程
- vitest 45/45（+3 分章解析用例）、db-smoke 6/6、EPUB 解析（epub2，容错提示转 TXT/MD）

## v0.4.0（2026-08-11）

### 安装方式
- **安装版**：`AI-Novel-Studio Setup 0.4.0.exe`（NSIS 向导版：可选安装目录 + 卸载入口）
- **便携版**：`AI-Novel-Studio-0.4.0-portable-x64.exe`（数据跟随可执行文件 data/ 目录，可放 U 盘）

### 字体系统（P22-A）
- **正文字体 8 选**：霞鹜文楷（默认，网文手感）/ 思源宋体 / 思源黑体（3 款开源 OFL 打包，离线可用）+ 系统楷体 / 宋体 / 仿宋 / 雅黑 / 系统默认
- **编辑器字体**：跟随正文 / 等宽两档
- **核心修复**：正文编辑器从等宽字体（JetBrains Mono）改为正文字体——小说写作视觉回归正常
- 设置页「外观 → 字体」即时生效 + 预览段 + 恢复默认

### 正文排版（P22-B）
- 首行缩进 2 字符（开关）、行距滑块（1.5-2.2）、字号（14-18px）、阅读宽度 720px 居中
- 设置页「写作」tab，即时生效

### 体验优化（P22-C）
- 章节列表 memo 化（100+ 章流畅）、路由骨架屏（替代文字"加载中"）
- 快捷键：Ctrl+Enter 生成 / Ctrl+Shift+R 审核 / Ctrl+Shift+B 回灌
- 创造工坊步骤拖拽排序
- Toast 堆叠上限 3 条、键盘焦点可见性（:focus-visible）、空状态组件统一 6 页

### 安装包体积
- 打包字体 +9.4MB（约 140MB 总安装包）

## v0.3.0（2026-08-11）

### 安装方式
- **安装版**：`AI-Novel-Studio Setup 0.3.0.exe`（NSIS 向导版：可选安装目录 + 卸载入口）
- **便携版**：`AI-Novel-Studio-0.3.0-portable-x64.exe`（数据跟随可执行文件 data/ 目录，可放 U 盘）

### 创造工坊（P21）
- **创造工坊页面**（侧边栏「创作」区）：描述一句话 → AI 生成方案骨架（3-8 步 agent 流水线），可视化编辑（选智能体/职责/阶段/顺序），保存即用
- **创作方案**：有序智能体流水线（post_generate 正文后增强 / review 审核增强 / whole_book 整本预留），步骤间传递前序输出，每步独立超时与降级
- **章节执行页「跑方案」**：对当前章跑任意方案，输出聚合展示
- **创作中枢新增 run_solution 工具**：对话可直接触发方案
- **技能体系**：skill 资产 + agent 挂载（方案步骤自动带技能上下文）
- **导入导出**：方案自包含 JSON（含依赖 agent/skill）；**支持导入 Feelfish 的 agent md（YAML frontmatter）与 solution.json**——Feelfish 流程可直接搬过来
- **内置 3 套模板**：标准章节复核 / 世界观一致性审校 / 短篇冲刺
- 预留：整本模式执行器（whole_book）、在线方案市场（MarketProvider 接口）

### 工程与规范
- **版本管理规范化**（docs/versioning.md）：SemVer 语义、发布流程、CI 强制 tag 与 package.json 版本一致（杜绝 2026-08-10 的 v0.3.0 错位事件再发生）

## v0.2.2（2026-08-11）

### 安全与数据（P20 批1）
- **本地 API 深度防护**：file:// 请求强制应用令牌（沙箱 iframe 无法再绕过 CORS 读数据/烧额度）
- **备份恢复重写**：导出前 WAL 落盘保证原子；恢复自动停止/重启服务（Windows 不再失败）；便携版备份/恢复/清数据目录统一
- **参数校验补齐**：SSE 生成与各路由参数 zod 校验（NaN/越界一律 400）
- **迁移幂等**：旧备份恢复到新应用不再因缺列崩溃

### 稳定性与成本（P20 批2）
- **任务看门狗**：运行超 30 分钟的任务自动回收（不再永久卡死调度器）
- **取消真实生效**：导演/整本生产逐阶段感知取消，进度含失败章节
- **成本修正**：模型名归一（虚高 3.5~35 倍→精确）、中止调用补记账、客户端长任务超时 120s（不再幻象失败）

### 一致性（P20 批3）
- **SSE 容错**：单个坏事件不再毁掉整个生成流；生成页显示上下文预算
- **上下文裁剪保序**：超限时优先保写作要求/引导/任务单（不再误删高价值段）
- **幂等去重**：导演阶段重跑不再产生重名角色/重复卷章
- **知识库即时更新**：编辑文档后检索立即生效；直塞资料不再双份注入
- **质量债闭环**：审核问题自动登记（去重）、修复达标自动销账、成本页可查看

### 多智能体协同（P20 批4）
- **团队会审落库**：主编约束注入三岗、60s 超时降级、结果写入章节（修复链路可消费）
- **创作中枢加固**：同书会话串行、工具 150s 超时、多写提案队列

### 体验与工程（P20 批5）
- **版本历史可用**：查看全文 + 一键恢复（恢复前自动快照）
- **AI 操作前自动快照** + **30 秒自动保存**（崩溃最多丢 30 秒）
- **反 AI 词自动重写**：生成后检测重度命中自动重写一次
- **性能**：首屏 JS 4.4MB → 1MB（分包 + 路由懒加载），流式渲染 rAF 合并
- **CI 质量门禁**：PR 触发 typecheck/lint/test
- **导出安全**：EPUB XML 转义、TXT 加 BOM（旧记事本不乱码）、文件名消毒补全

## v0.2.1（2026-08-11）

### 引导与写作偏好（P19）
- **两级创作引导**：书级引导（每本书一句话，注入所有生成）+ 单次引导（输入框临时要求，如「本章引入新反派伏笔」），正文页 AI 生成输入框直接输入即可
- **写作偏好设置**：设置 → 写作（语言：简体/繁体；格式：自然分段/长句连续；写作模式：聚焦/标准/自由），自动注入每次生成的写作要求
- **正文页引导输入框**：生成按钮旁输入对本次生成的额外要求（Enter 即生成）

### 审核与体验（P19）
- **优先优化建议**：审核结果按严重度排序展示 Top 3，一键「采纳建议并重写」（建议自动带入生成引导）
- **场景数下限校验**：章节目标场景数 < 3 时审核标记 high 级问题并记入质量债（节奏拖沓预警）
- **任务中心清理**：「清理已完成」按钮（保留运行中任务）
- **侧栏长名防溢出**：展开态中文长书名省略号截断

### 生成上下文（P19）
- **当前定位段**：正文生成注入「卷战略 → 节拍 → 本章目标」四级聚焦信息（限量 600 字，控制 token）

## v0.2.0（2026-08-10）

### 安装方式
- **安装版**：`AI-Novel-Studio Setup 0.2.0.exe`（NSIS 向导版：可选安装目录 + 卸载入口）
- **便携版**：`AI-Novel-Studio-0.2.0-portable-x64.exe`（数据跟随可执行文件 data/ 目录，可放 U 盘）

### 视觉与体验
- **多主题系统（6 套）**：墨蓝（默认）/ FeelFish 绿（#101010 + #00a060）/ 紫夜 / 深海青 / 琥珀 / 纸张·亮；设置页「外观」一键切换，持久化 + 原生窗口按钮联动
- **无边框标题栏**：自定义深色标题栏 + 原生最小化/最大化/关闭 + 全局「AI 运行中」悬浮状态
- **全局侧栏导航**：创作/资产/系统分组 + 图标 + 激活指示 + 失败任务徽章 + 折叠
- **小说列表卡片化**：封面渐变块 / 灵感 / 进度条 / hover 上浮
- **工作台 7 步流程导航**：编号/完成态徽章 + 元信息（角色数/卷章数）
- **章节执行页**：本章进度矩阵（9 段）+ 推荐动作卡 + 分区操作 + 空状态引导 + 状态色点
- **主题化确认框**（ConfirmDialog）替换原生 window.confirm

### 流程与生产
- **任务中心**：统一任务列表 + 重试（支持**换模型重试**）/ 取消 / 「从断点继续」
- **多主题联动 CodeMirror**、生成前**成本确认弹窗**、生成中实时 token/成本估算
- **章节正文按需加载**（修复空保存覆盖数据丢失）、**取消生成保留已生成内容**
- **批量细化**（章节范围 + 幂等续跑）、**卷战略评审**、**节拍板门禁**、**定向重做单套方向**、**字段级 AI 重写**
- **精准角色筛选**（本章角色特写注入，省 token）、**质量降级链**（同签名防重复烧 LLM）
- **流派自定义**、**标题工坊**、**拆书角色形象演变融合入档**
- **生成范围授权**（整本生产可按章节区间）

### 已知限制
- 无代码签名证书：SmartScreen 首次运行提示「未知发布者」（本地自用可接受）
- 形象演变为文字档案版（图像生成链路后续可接入）

### 数据与卸载（v0.2.0 更新）
- 数据存于 `%APPDATA%\ai-novel-studio`（与安装目录分离）
- 卸载：Windows 设置 > 应用 > AI-Novel-Studio > 卸载（会同时清除数据）
- 设置页「外观 > 数据与卸载」：打开数据目录 / 清除全部数据

### 新增功能（v0.2.0 更新）
- 新应用图标（笔尖负形设计，kimi 多模态评审 + 三稿用户选定）
- 侧栏 17 项：新增创作向导 / 反 AI 规则管理 / 基础角色库 / 导演跟进 / 模型路由独立页
- 书级导航不再禁用（无书时点击引导创建）
- 步骤导航五状态（已完成/当前步骤/待推进）+ 完成态浅绿底
- 小说列表特权高亮 + 全站 16px 图标统一

## v0.1.0（2026-08-09）

### 安装方式
- **安装版**：`AI-Novel-Studio Setup 0.1.0.exe`（NSIS 安装，数据存 %APPDATA%\ai-novel-studio）
- **便携版**：`AI-Novel-Studio-0.1.0-portable-x64.exe`（免安装，**数据跟随可执行文件旁 data/ 目录**，可放 U 盘）

### 核心功能
- **整本创作闭环**：灵感 → AI 自动导演（11 阶段：方向/世界观/角色/卷/节奏/章节全自动）→ 章节流式生成 → 审核修复 → 状态回灌 → 导出 TXT/MD/EPUB
- **自动导演**：全自动（无人值守）/ 半自动（每阶段确认）双模式；重启幂等（中断后恢复不重复生成）
- **创作中枢（Creative Hub）**：对话即创作，AI 可查状态/跑导演/生成章节/建角色（写操作需用户确认）
- **AI 团队**：主编 + 审校三岗（剧情/逻辑/文风）+ 角色顾问 + 世界观顾问 + 文风顾问；可自定义 Agent
- **写法引擎**：从示例文风提取特征（可启停）→ 绑定注入正文；反 AI 词库检测
- **拆书工作台**：三档五维报告 / 角色档案四档 / 形象演变扫描；产物可转写法资产
- **外部资料直塞**：参考资料/设定文档直接注入生成上下文（替代 RAG 的低成本方案）
- **DeepSeek 特化**：前缀冻结缓存优化（跨章生成成本降至 1/50）、任务级模型路由、成本仪表盘
- **多供应商**：DeepSeek 官方直连 + OpenCode Go 网关（聚合 GLM/GPT/Grok/Kimi 等）

### 已知限制
- 需自备 LLM API Key（DeepSeek 官方 或 OpenCode Go 网关，均可在设置页配置）
- 首次使用建议走"首启向导"（3 步配置）
- 未签名应用：Windows SmartScreen 可能提示"未知发布者"，点击"更多信息 → 仍要运行"

### SmartScreen 绕过指引
1. 双击安装包 → 若出现蓝色拦截页，点击"更多信息"
2. 点击"仍要运行"
3. 若被杀软拦截，请选择"允许"

### 变更与后续
- 完整功能规划见项目 `PLAN.md`（P0-P6 全部完成；形象图/漫画衍生在 backlog）
- 版本号在应用内"设置"页可查（AI_NOVEL_APP_VERSION）
