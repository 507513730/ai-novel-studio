# 文档索引

> 按 Diátaxis 四象限组织：**教程**（学）→ **操作**（做）→ **参考**（查）→ **解释**（懂）。

## 📖 教程（Tutorials）——第一次使用跟着做

| 文档 | 说明 |
|---|---|
| [getting-started.md](getting-started.md) | 快速上手：配置模型 → 建书 → 生成 → 方案生产（4 步） |
| [AI-AGENT-ONBOARDING.md](AI-AGENT-ONBOARDING.md) | AI 协作者手册：工作流 / 验证门禁 / 实战教训 / 协作边界（新 agent 进场必读，v0.21.0 起） |

### 用户文档（R9.1，面向创作者）

| 文档 | 说明 |
|---|---|
| [user/getting-started.md](user/getting-started.md) | 首启：安装 → 供应商 → 零决策开写 |
| [user/writing-workflow.md](user/writing-workflow.md) | 单章生产循环 / 编辑器能力 / 整本生产 |
| [user/model-setup.md](user/model-setup.md) | 供应商 / 任务路由 / thinking / fallback |
| [user/backup-restore.md](user/backup-restore.md) | 自动备份 / 导出 / 恢复 / 清除数据 |
| [user/troubleshooting.md](user/troubleshooting.md) | 生成失败 / 卡生成中 / 服务失联排障 |
| [user/export-and-update.md](user/export-and-update.md) | 导出格式 / 应用更新（安装版与便携版） |

### 开发与运维（R9.1，面向协作者）

| 文档 | 说明 |
|---|---|
| [development/repository-map.md](development/repository-map.md) | 业务域结构总览 |
| [development/local-development.md](development/local-development.md) | 环境 / 命令 / 独立调试 |
| [development/testing.md](development/testing.md) | 测试分层 / 约定 / 故障注入场景 |
| [development/data-model.md](development/data-model.md) | 核心表 / 状态枚举 / 迁移纪律 |
| [development/api-contracts.md](development/api-contracts.md) | 端点总览 / 鉴权 |
| [development/error-model.md](development/error-model.md) | 统一错误 → HTTP 映射矩阵 |
| [operations/packaging.md](operations/packaging.md) | 打包 / 打包态验收 / 平台矩阵 |
| [operations/release-checklist.md](operations/release-checklist.md) | 发版检查单 |
| [operations/ci.md](operations/ci.md) | CI 工作流 / 本地等效 |
| [reference/calibration/README.md](reference/calibration/README.md) | 校准报告索引 |
| [reference/decisions/README.md](reference/decisions/README.md) | 决策归档索引 |

## 🛠 操作（How-to）——具体任务怎么做

| 文档 | 说明 |
|---|---|
| [versioning.md](versioning.md) | 发布操作手册：SemVer / 发布流程 / 合入门禁 / 回滚 |
| 根目录 [CONTRIBUTING.md](../CONTRIBUTING.md) | 贡献流程：环境 / 提交规范 / PR |
| [constraints.md](constraints.md) | **约束速查**（v0.25.0）：把仍生效的约束按 9 个主题归拢，每条标注 A/D 出处。**先读这个**，再按需深入 |
| 根目录 [AGENTS.md](../AGENTS.md) | 开发纪律全文（39 条硬约束 / 决策锁定 / 踩坑教训） |

## 📚 参考（Reference）——事实与数据

| 文档 | 说明 |
|---|---|
| [CHANGELOG.md](CHANGELOG.md) | 版本变更记录（Keep a Changelog 格式） |
| [audit-report.md](audit-report.md) | 全面审查与修复追踪表 |
| [test-report.md](test-report.md) | 测试报告（单测 / e2e / 发布验证） |
| [calibration-report.md](calibration-report.md) | 提示词/参数校准报告 |
| [calibration-report-pro.md](calibration-report-pro.md) | pro 正式版参数校准对比（官方 vs 网关，v0.22.1） |
| [calibration-report-pro-gateway.md](calibration-report-pro-gateway.md) | pro 网关直连校准（v0.22.1） |
| [calibration-report-pro-official.md](calibration-report-pro-official.md) | pro 官方直连校准（v0.22.1） |
| [calibration-report-flash-recheck.md](calibration-report-flash-recheck.md) | flash 基线复测（v0.22.1） |
| 根目录 [README.md](../README.md) | 项目总览 / 能力清单 / FAQ |

## 🧠 解释（Explanation）——为什么这样做

| 文档 | 说明 |
|---|---|
| [architecture.md](architecture.md) | 架构说明：进程模型 / 数据流 / 调度 / 方案运行时 |
| [superpowers/plans/2026-08-29-full-repository-refactor-remaining-work.md](superpowers/plans/2026-08-29-full-repository-refactor-remaining-work.md) | 全仓兼容重构剩余工作总计划：当前基线、R0-R9 批次、验证与回退条件 |
| [competitive-analysis.md](competitive-analysis.md) | 竞品差距分析（2026-08-23：商业 8 款 + 开源 5 项；长板确认 / A·B·C 三档差距 / 不做边界 / 反向教训） |
| [decision-log.md](decision-log.md) | 决策日志（D1-D105+，含背景/证据/影响） |
| [archive/PLAN-history.md](archive/PLAN-history.md) | 完整实施编年史（P0-P30+ 阶段清单与版本记录，append-only；2026-08-22 自 PLAN.md 归档） |
| 根目录 [PLAN.md](../PLAN.md) | 当前计划精简版（定位/进度/版本记录/遗留 backlog） |

## 使用顺序建议

1. 新用户 → `getting-started.md`（教程）
2. 新入项目开发 → `constraints.md`（约束速查，一页对齐）+ `PLAN.md`（当前计划）+ `versioning.md`（流程）；需要证据与推导时再查 `AGENTS.md` / `decision-log.md`
3. 改架构 → 读 `architecture.md` 后同步更新
4. 发布 → 走 `versioning.md` §3，改 `CHANGELOG.md`
5. 排查 → `audit-report.md`（已知问题追踪）+ `decision-log.md`（为什么这么做）
