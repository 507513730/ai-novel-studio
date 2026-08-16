# 文档索引

> 按 Diátaxis 四象限组织：**教程**（学）→ **操作**（做）→ **参考**（查）→ **解释**（懂）。

## 📖 教程（Tutorials）——第一次使用跟着做

| 文档 | 说明 |
|---|---|
| [getting-started.md](getting-started.md) | 快速上手：配置模型 → 建书 → 生成 → 方案生产（4 步） |
| [AI-AGENT-ONBOARDING.md](AI-AGENT-ONBOARDING.md) | AI 协作者手册：工作流 / 验证门禁 / 实战教训 / 协作边界（新 agent 进场必读，v0.21.0 起） |

## 🛠 操作（How-to）——具体任务怎么做

| 文档 | 说明 |
|---|---|
| [versioning.md](versioning.md) | 发布操作手册：SemVer / 发布流程 / 合入门禁 / 回滚 |
| 根目录 [CONTRIBUTING.md](../CONTRIBUTING.md) | 贡献流程：环境 / 提交规范 / PR |
| 根目录 [AGENTS.md](../AGENTS.md) | 开发纪律（约束 / 决策锁定 / 踩坑教训） |

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
| [decision-log.md](decision-log.md) | 决策日志（D1-D97+，含背景/证据/影响） |
| 根目录 [PLAN.md](../PLAN.md) | 总体规划编年史（P0-P30+，append-only） |

## 使用顺序建议

1. 新用户 → `getting-started.md`（教程）
2. 新入项目开发 → `PLAN.md`（历史）+ `versioning.md`（流程）+ `AGENTS.md`（纪律）
3. 改架构 → 读 `architecture.md` 后同步更新
4. 发布 → 走 `versioning.md` §3，改 `CHANGELOG.md`
5. 排查 → `audit-report.md`（已知问题追踪）+ `decision-log.md`（为什么这么做）
