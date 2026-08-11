# 文档索引

## 项目文档

| 文档 | 说明 | 更新频率 |
|---|---|---|
| [PLAN.md](../PLAN.md) | 总体规划编年史（P0-P21，append-only） | 每批完成 |
| [architecture.md](architecture.md) | 架构说明：数据流/调度/方案运行时/检索 | 架构变更时 |
| [decision-log.md](decision-log.md) | 决策日志（D1-D59+，按时间追加） | 每个决策 |
| [release-notes.md](release-notes.md) | 发布说明（v0.1.0 → v0.3.0） | 每次发布 |
| [versioning.md](versioning.md) | 版本管理规范（SemVer/发布流程/禁则/重建） | 规范变更时 |
| [audit-report.md](audit-report.md) | 全面审查与修复追踪表（P20 46 项 + P21 预留） | 审查/修复时 |

## 验证与报告

| 文档 | 说明 |
|---|---|
| [test-report.md](test-report.md) | 测试报告（e2e 全功能 + P17-4 flash 对比 + P20/P21 回归） |
| [calibration-report.md](calibration-report.md) | 提示词/参数校准报告 |

## 使用顺序建议

1. 新入项目 → `PLAN.md`（历史）+ `versioning.md`（流程）+ `AGENTS.md`（纪律）
2. 改架构 → 读 `architecture.md` 后同步更新
3. 发布 → 走 `versioning.md` §3，改 `release-notes.md`
4. 排查 → `audit-report.md`（已知问题追踪）+ `decision-log.md`（为什么这么做）
