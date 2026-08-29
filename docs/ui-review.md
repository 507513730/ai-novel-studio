# 前端 UI 审查报告（v0.25.0 · 2026-08-29）

> 走查环境：dev（renderer http://localhost:5173 直连 + API 127.0.0.1:3000，`AI_NOVEL_TOKEN_OPTIONAL=1`），视口 1440×900，真实书库数据（只读浏览）。
> 覆盖：17 个页面路由 + paper/sepia 亮色主题抽查；代码级样式体系审查（index.css / AppLayout / 组件层）。
> 关键截图：`docs/ui-review/assets/`。走查原始截图（未压缩）在 `release/ui-review/`（gitignored）。
> 结论流向：P0/P1 → **批次 A（v0.26.0）**；P2 观感升级 → **批次 B（v1.0.0 收官版）**。

## 1. 总体评价

**强项（保持不动）**：
- 7 套主题 CSS 变量体系完整统一（背景 4 级/文字 3 级/单主色+soft/语义色/圆角/间距/阴影/过渡全齐），主题切换链路（data-theme + localStorage + nativeTheme + titleBarOverlay）端到端闭环；
- 颜色纪律极好——TSX 内联颜色基本全走 `var(--…)`（445 处），硬编码 hex 仅主题预览色板 2 处；
- 可访问性基础到位：`:focus-visible` ring、`prefers-reduced-motion` 降级、按压 scale 反馈；
- CodeMirror 编辑器主题与 CSS 变量全量打通，排印参数设置页即时生效；
- Toast / ConfirmDialog / PromptDialog / EmptyState / ErrorBoundary（页面级 resetKey）基建齐全；paper/sepia 亮色主题观感舒适、一致性良好。

**短板（本次升级目标）**：布局/尺寸大量内联（857 处 `style={{…}}`）导致 8px 栅格名存实亡；字号绕过 token（~280 处内联 fontSize，10px 超小字多处）；加载/空/错误三态各页面三套写法；少数布局挤压 bug 直接损害可用性（见 P0）。

**审查方法说明**：走查初期多张截图出现「整页极暗」，经 computed-style 核查与稳定重截确认是**截图恰好拍到 `.panel` 入场动画中间帧的假象**（首访页面数据晚到 + 200ms fade-in-up），不列入问题。但它暴露了一个真实体验点：首屏数据慢时页面长时间空白无加载指示（见 P1-1）。

## 2. P0 —— 损害可用性的视觉 bug（批次 A 修复）

### P0-1 章节执行页顶部工具栏挤压成竖排文字
- 证据：`assets/03-chapters.png`——1440px 宽下章节标题「黑暗降临」被挤成一字一行竖排，字数统计「我的AI 0/0/0」同样竖排，与保存/阅读/导出/AI 插入行堆叠混乱。
- 根因：工具栏 flex 子项无 `min-width`/换行约束，按钮缺 `white-space: nowrap`；字数统计元素被压缩到 ~40px 宽。
- 修复：ChapterToolbar 重排（批次 B 随页面拆分做布局层），批次 A 先打地基——全局 `button { white-space: nowrap }` + 工具栏元素最小宽度/`flex-shrink` 约束。

### P0-2 自动导演页按钮与标签竖排
- 证据：`assets/04-director.png`——「启动导演/恢复/继续/取消」四字按钮一字一行，「每卷章数」label 竖排。
- 根因：同 P0-1（容器给宽不足 + nowrap 缺失）。

### P0-3 侧栏「工作台」项与「小说列表」冲突：双高亮 + 主入口强调错乱
- 证据：全部截图可见——任何页面下「小说列表」和「工作台（设定/世界/角…）」两行同时呈淡蓝高亮（如 `assets/09b-tasks-stable.png`）；书外页面「工作台」错误继承主入口强调。
- 根因：AppLayout.tsx 中「工作台」项 `to = bookPath(novelId,'/')`，无书时退化为 `'/'`，与「小说列表」的 `to:'/'` 撞车；且 `isPrimary`（主入口 accent 淡底 + 蓝字）按 `to==='/'` 判定，导致两行常亮，active 态无法分辨。
- 修复：工作台项仅在 `novelId` 存在时显示/启用（无书时点击给 toast 引导，与 requiresNovel 语义一致）；`isPrimary` 改按条目身份判定而非 URL。

### P0-4 代码层硬伤（静态审查证实）
| 问题 | 位置 |
|---|---|
| `@keyframes fade-in-up` 定义两次且位移不同（后者静默覆盖前者） | index.css:571(6px) / :754(4px) |
| `.page` 类被 ForgePage/StatsPage 使用但从未定义，页面容器宽度散乱（960/1080/1200/1400 各页自定） | ForgePage.tsx:61、StatsPage.tsx:52、StudioPage.tsx:319 等 |
| 弹窗遮罩 `rgba(0,0,0,0.5)` 硬编码 4 处，无 token（亮色主题下过重且不可调） | ConfirmDialog.tsx:35、PromptDialog.tsx:65、CommandPalette.tsx:79、AgentsLibraryPage.tsx:270 |
| 7 处 `window.confirm` 原生弹窗（违反 D69，与应用风格割裂） | DirectorPage / AgentsLibraryPage / KnowledgePage / BaseCharactersPage / StoryModesPage / WorldsLibraryPage |
| AgentsLibraryPage 自造 fixed 弹窗（zIndex 10000）不复用 ConfirmDialog | AgentsLibraryPage.tsx:270 |
| zIndex 散落（999/9998/9999/10000），层级关系靠运气 | Toast.tsx:66、CommandPalette.tsx:79、AgentsLibraryPage.tsx:270 等 |
| CodeMirror 主题 `{ dark: false }` 硬编码（深色主题下派生行为标记错误） | editor/theme.ts:46 |
| `fontFamily: 'monospace'` 绕过 `--font-mono` | AgentsLibraryPage.tsx:280,283 |
| 10px/9px 超小字号多处（低于最小 token --fs-11） | AppLayout.tsx:244,313、StudioPage.tsx:385,450、HubChat.tsx:84、ChapterListItem.tsx:50 |
| 8px 栅格被基础层自破：button 6/14、input 7/10、.row/.col gap 10、badge 圆角 20、pill-tabs 5/14 | index.css:293,378,457,464,471,618 |
| 全局 h2 仅 15px 且 dim 色，标题层级扁平（与正文几乎无差） | index.css:421-426 |

## 3. P1 —— 舒适度与一致性（批次 A 修复）

1. **加载态缺失/不一致**：写作统计页进入后约 4-5s 白屏无任何指示（`assets/05b-stats-wait.png` 为加载完成后状态，数据量大时首屏体验差）；全应用 23 处「加载中…」纯文字，骨架屏仅路由级一处。→ 新增通用 `.skeleton` shimmer + 列表骨架，收敛纯文字加载。
2. **空状态三轨并行**：EmptyState 组件（待办页，观感好）vs 手写 emoji 居中块（首页/NovelGate 📚）vs 一行灰字（HubChat 左上角三行小字 + 大片空白，`assets/07-hub-chat.png`；ResourcePanel/StudioPage 同）。→ 统一 EmptyState。
3. **章节执行右栏无层级**（`assets/03-chapters.png`）：「当前推荐」卡之后 10 个等宽默认按钮直排（AI 审核/本地校对/方案流水线/修复+重审/状态回灌/待确认区/记忆面/版本历史/存快照/写作上下文），主次不分；「以方案生产正文」文字截断；本卷进度 9 个 10px chip 挤一行。→ 批次 A 先统一行高与最小宽度止血，批次 B 重排分组。
4. **任务中心错误文案裸奔 + 状态语义混乱**（`assets/09b-tasks-stable.png`）：`Error: Error while decrypting the ciphertext provided to safeStorage.decryptStr` 原文直接拼进行内；失败任务行同时显示绿色状态点与「完成」badge。→ 错误文案截断+悬浮全文，状态色按语义映射。
5. **术语泄漏**：智能体库每张卡的「AI 起草 body_md」按钮把内部字段名 `body_md` 暴露给用户（`assets/16-agents-library.png`）。
6. **图标语言混用**：按钮文案 emoji（🔥 生成正文 / 📖 阅读 / 📚 / 🛒 / ⚠️）与侧栏 lucide 图标体系割裂；EditorArea 还为单枚图钉手写 SVG。→ 统一 lucide。
7. **品牌三重重复**：titlebar「AI 小说创作工作台」+ 侧栏品牌行同文案 + 页面 h1 再来一次（首页）。→ 收敛为 titlebar 一处 + 页面语境化标题。
8. **侧栏 active 指示条贴边**：`left:-8` 使 3px 色条贴在侧栏最左缘、与菜单项视觉分离。
9. **原生 checkbox 直出**（要素工坊六类要素勾选行），与整体控件风格不搭。

## 4. P2 —— 观感升级（批次 B，借鉴外部设计）

| 方向 | 参考 | 升级内容 |
|---|---|---|
| 首页书架 | Bear/Ulysses 书库卡 | 书卡排版升级：封面色块+书名层级、进度/字数/角色信息分组、hover 过渡 CSS 化、空态引导卡 |
| 章节执行页 | iA Writer 排版优先 + 每屏一个主行动（D27） | 先按 AGENTS #38 拆分（1150 行/28 useState → 自定义 hook + 子组件）；工具栏重排（标题/字数归位、导出收纳）；右栏执行面板分组卡（推荐/生成/审校/发布），次级动作折叠；专注模式两侧渐隐 |
| 工作台 | Ulysses 渐进披露 | 步骤导航/GuideStrip/NextStepCard 三套引导收敛为一套层级 |
| 创作中枢 | 现代聊天 UI | 气泡三态（用户/助手/系统）、错误以系统消息条呈现、受限 markdown 自渲染（粗体/列表/代码/标题，不新增依赖）、空状态引导卡 |
| 亮色主题 | 暗色/亮色 UI 通行原则（Toptal、UX Planet：浅色主题遮罩独立 token、阴影更淡） | `--overlay` 随主题；paper/sepia 下遮罩/阴影/边框对比度复查 |
| 控件细节 | Linear 式克制 | 按钮行高/间距归栅格、chip 行距、checkbox 自定义样式、11px 字号下限 |

## 5. 遗留的文档漂移（顺手修正，不占批次）

- `docs/development/local-development.md` 与 onboarding 宣称「浏览器直连 5173 调试」，但 v0.25.0 审查 M3 起 dev 也强制 `X-App-Token`（electron/serverProcess.ts:37 无条件注入 SERVER_TOKEN），浏览器无 preload 桥拿不到 token，直连会 403。现需 `AI_NOVEL_TOKEN_OPTIONAL=1 pnpm dev`（security.ts:37-39 预留的调试开关）。
- 侧栏「资产」组 14 项偏长（信息架构问题，本轮不动，仅记录）。

## 6. 走查覆盖清单

深色（deepblue）：首页、工作台（/novels/25）、章节执行、自动导演、写作统计、创作中枢选择页、书内中枢、创造工坊、任务中心、导演跟进、设置、写法引擎、知识库、世界样本库、标题工坊、智能体库、要素工坊；主题抽查：paper（首页）、sepia（首页）。未走查：help/book-analysis/story-modes/genres/anti-ai/base-characters/prompt-workbench/follow-ups 已覆盖或为同模板页（AssetCreator 系），风险低。
