# AI-Novel-Studio 当前计划（精简版）

> **2026-08-22 文档治理**：完整实施编年史（v3.1 审查修订版 + P0-P30+ 各阶段清单 + §12 历史版本记录）已归档至 [docs/archive/PLAN-history.md](docs/archive/PLAN-history.md)。
> 本文件只保留"当前"状态：项目定位、进度总览、最新版本记录、已知遗留、文档索引。
> 历史决策（D 系列）见 docs/decision-log.md；发布说明见 docs/CHANGELOG.md；协作者流程见 docs/AI-AGENT-ONBOARDING.md。

---

## 0. 项目定位

AI 导演式长篇小说生产系统的桌面版（Electron）。借鉴两个参考项目：

- **AI-Novel-Writing-Assistant**（开源 AGPLv3，2.3k stars）：整本生产链（灵感→方向→世界→角色→卷→章→执行→审核→修复→回灌）、写法引擎、拆书、RAG、模型路由、Creative Hub + Agent Runtime
- **FeelFish**（商业产品）：多智能体协作（自定义"部门"）、智能上下文管理、对话即创作

**差异化定位**：本地优先桌面应用 + DeepSeek 深度特化（前缀冻结缓存优化对抗涨价）+ 零原生依赖（Windows 打包零 ABI 坑）。

## 0.5 当前进度总览（2026-08-22 · v0.24.2）

| 里程碑 | 状态 | 说明 |
|---|---|---|
| P0 基建 → P2.2 修复包 | ✅ | 基建 / 核心写作闭环 / 自动导演 + Hub / 优化与修复全量完成 |
| P2.3 三方会审 → P5 多智能体 | ✅ | 三方会审 / 拆书三档 / 写法引擎 + 反 AI / 五 Agent + 写工具审批 |
| P6 发布 → P14 收尾（v0.2.0） | ✅ | 双产物打包 / 签名就绪 / 深度测试 R3 52/52 / 导航与体验修复 |
| P16-P30（v0.2.x-v0.7.x） | ✅ | 数据管理 / 资产全局化 / 创造工坊 / 方案生产流水线 / CI 规范 / 多主题 / 字体排版 / 图标 |
| O1-O5 + I1-I5（v0.9.2→v0.14.0） | ✅ | 查证改进全量：发布自动验收 / LLM 路径合并 / e2e 门禁 / 每日备份 / 成本预警 / 质量债闭环 / 世界状态机 / 风格指纹 |
| v0.15-v0.24 版本线 | ✅ | 创作约束 / 自更新 + CNY / 三轮审查修复批 / 联网查找 / 续写 + 字数分离 / 记忆面 / UI 美化 / 执行面迁 job / 客户端重构 / **功能批 F（v0.24.2）** |
| 测试 | ✅ | vitest 178/178、db-smoke 7/7、typecheck/lint 0 error、e2e R10 全绿（T1 10/10 T2 30/30 T3 6/6 T4 7/7） |
| **当前主线** | 📚 | 真实写书（书 #25「帝路十章」）：卷 72 完成（18 章 47,112 字）+ 卷 73 完成（25 章 66,852 字），全书累计 43 章 ≈11.4 万字；剩卷 74-75 共 49 章待产（应用内执行，绑定方案「帝路十章」） |

**版本记录**：最新 v0.24.4（非写书清单批 B：审核基线校准 + 写作统计/伏笔账本 + 快捷词 + 本地校对 + DOCX 导出 + 拖拽导入/跟随系统主题 + 网文要素工坊 + 演示书，D108/D109）；上一版 v0.24.3（写书实战纠错批 A：生产管线配置级错误熔断 ConfigError + job 全失败不再虚报 done，D106）——之前所有版本记录见 [docs/archive/PLAN-history.md](docs/archive/PLAN-history.md) §12 与 [docs/CHANGELOG.md](docs/CHANGELOG.md)。

## 1. 用户已锁定决策（不可再问）

| 决策点 | 锁定结果 |
|---|---|
| 产品形态 | **Electron 桌面应用** |
| 模型接入 | **多供应商 + 任务级模型路由** |
| 功能范围 | **尽量完整复刻**（自动导演 + RAG + 写法引擎 + 拆书 + 多智能体 + 衍生简化版） |
| 审核模型 | pro 正式版未上线 → **先全 flash**，路由预留 `deepseek-v4-pro` 位置，上线后一键切换 |
| 上下文策略 | **整书直塞优先**（1M 窗口内），超窗摘要压缩，RAG 仅兜底（可选） |
| thinking 参数 | 任务级可调：路由层 / 单次调用层 / 供应商默认层 三层覆盖，即存即生效 |

## 2. 已知遗留与 backlog（按优先级）

> 全仓内部兼容重构的剩余工作、依赖顺序、逐批文件和验收门禁，统一见 [全仓库兼容重构剩余工作实施计划](docs/superpowers/plans/2026-08-29-full-repository-refactor-remaining-work.md)。该计划与下方产品功能 backlog 分开管理。
> **进度（2026-08-29）**：R0 基线 + R1 章节生成域重放 + R2 job 域隔离已合并 main（决策 D111/D112）；R3 scheduler token 作用域化已完成于分支 `codex/refactor-r0-r1`（D113，全门禁绿、打包受环境 ACL 问题阻塞待重验）；基线文档见 `docs/superpowers/audits/2026-08-29-refactor-baseline.md`。

| 项 | 状态 | 说明 |
|---|---|---|
| RAG 条件启用 | backlog | >100 万字或外部资料 >100 万字时启用；替代方案=外部资料直塞（决策见 PLAN-history §9.2 / D51）；竞品调研升级为 B1（词条触发注入 + 检索召回，见 competitive-analysis） |
| pro 模型切换验证 | 等用户通知 | deepseek-v4-pro 正式版上线后一键切换审核路由 |
| 本地方案市场 | 预留 | `solutionAssets` 本地目录市场未实现（P21-4），仅 GitHub 市场；竞品对应 C4 |
| 方案步骤 maxTokens 智能分配 | 预留 | audit-report P21 待办 |
| 写作统计面板 / 灵感箱 / 角色关系图 | ✅ 部分完成 | 2026-08-24 D109：统计面板 + 伏笔看板已落地（/novels/:id/stats + foreshadows）；灵感箱未做（建书已含灵感输入，优先级低）；角色关系图依赖关系数据（B5 已并账本视图，关系图待回灌关系提取） |
| e2e 测试报告写入位置 | ✅ 已完成 | 已迁 release/（gitignored）；CI artifact 化待 e2e 入 CI 时启用 |
| 审核评分基线校准 | ✅ 已完成 | 2026-08-24 D108：实测基线（高质量 85 / 中等 45-55 / 低 30）→ reviewPolicy isFixWarranted（<60 必修；60-74 有 high 才修；仅 medium/low 登记软债）+ needsFix 服务端推导 + SYSTEM_REVIEW 评分锚点——中等档免修省 2-3 次 LLM/章 |
| 文档治理（乱码/数字漂移/架构对齐） | ✅ 已完成 | 2026-08-22 四大项：乱码清零、README 修正、architecture 对齐、PLAN 归档 |

### 2.1 竞品差距 backlog（2026-08-23 调研，详情见 [docs/competitive-analysis.md](docs/competitive-analysis.md)）

| 档 | 条目 |
|---|---|
| A 体验快赢（优先） | A1 多候选分支生成 · A2 快捷词/文本扩展 · A3 写作目标与统计面板 · A4 轻量本地校对 · A5 DOCX 导出+导出预览 · A6 演示书+交互引导 · A7 拖拽导入+主题跟随系统 |
| B 结构性 | B1 RAG/词条触发注入接入上下文 · B2 写法示例动态检索 · B3 存量书稿接续创作 · B4 网文要素生成器集 · B5 伏笔看板+角色关系图 · B6 故事板 AI 诊断 · B7 系列书共享圣经 |
| C 远期 | C1 AI 配图 · C2 TTS 朗读 · C3 移动端只读审阅 · C4 本地方案市场 · C5 Hub 上下文多选 · C6 受控并行生成 |
| 不做 | 云协作 / 一键发布平台 / 视频生成·转剧本 / 自训模型（定位边界，理由见报告 §4） |

## 3. 1.0 判据（docs/versioning.md §1.1）

真实写书完成 + 核心链 1-2 版无 P0/P1 + 数据格式冻结。

## 4. 文档索引

| 文档 | 用途 |
|---|---|
| [docs/AI-AGENT-ONBOARDING.md](docs/AI-AGENT-ONBOARDING.md) | AI 协作者手册（工作流/验证门禁/教训/协作边界）——**每次任务前必读** |
| [AGENTS.md](AGENTS.md) | 开发硬纪律（61+ 条） |
| [docs/archive/PLAN-history.md](docs/archive/PLAN-history.md) | 完整实施编年史（历史阶段清单/版本记录，含损坏标注段） |
| [docs/decision-log.md](docs/decision-log.md) | 技术决策日志（D 系列，调研-更新闭环落点） |
| [docs/CHANGELOG.md](docs/CHANGELOG.md) | 版本发布说明（Keep a Changelog） |
| [docs/versioning.md](docs/versioning.md) | 发版手册（SemVer/流程/回滚） |
| [docs/architecture.md](docs/architecture.md) | 架构说明（进程模型/数据流/目录导览） |
| [docs/README.md](docs/README.md) | 全部文档索引（Diátaxis 四象限） |
