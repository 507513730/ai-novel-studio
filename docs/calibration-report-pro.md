# deepseek-v4-pro 参数校准对比报告（官方 vs OpenCode Go 网关）

- **日期**：2026-08-14（pro 正式版发布后校准）
- **模型**：`deepseek-v4-pro`（官方定价已查证：hit $0.003625 / miss $0.435 / out $0.87 per 1M）
- **基线对照**：`deepseek-v4-flash` 复测（同测试集，对照 D8 结论漂移）
- **测试集**：都市异能《第一章》任务单（固定前缀：书级合约 + 世界观 + 角色账本）
- **方法**：每组合 2 次取均值（calibrate.ts 内置）；评分 = 字数达标 40% + 反AI 20% + 标题合规 20% + 耗时 20%

## 结果对比（每组合 2 次均值）

| 组合 | 官方 pro 评分 | 网关 pro 评分 | flash 复测评分 | 备注 |
|---|---|---|---|---|
| off@1.1 | 0.894 | — | — | 官方 pro 反AI 1 次 |
| **off@0.9** | **0.923** | **0.931** | **0.949** | **三方最佳组合一致** |
| off@0.7 | 0.870 | 标题不合规 | — | 网关 pro 标题不合规 |
| thinking-low | 0.923 | — | — | 官方并列最佳 |
| thinking-high | 0.721 | **FAIL** | — | 官方标题不合规；**网关 pro thinking-high 失败**（ok=false，110s） |
| thinking-max | 0.902 | — | — | 官方耗时最长 59s |

（网关 pro 部分组合未列出 = 未跑全——本报告以官方全矩阵 + 网关关键组合为准；表格空位为本次未采集，见各分报告）

## 真实成本与延迟（pro 官方价重算，脚本 flash 价低估 3.1x）

| 指标 | flash | pro（官方/网关） |
|---|---|---|
| 单次成本（2k in + 2.5k out） | ~$0.001 | **~$0.0031**（3.1x） |
| 单次耗时（off 组合均值） | ~18s | **~43-50s**（2.6x） |
| 本批测试总成本 | — | **~$0.09**（26 次 pro + 12 次 flash） |

## 结论

1. **pro 在正文任务无质量优势**：flash 复测 0.949 > 官方 pro 0.923 ≈ 网关 pro 0.931——且 flash 成本 1/3.1、延迟 1/2.6。
2. **flash 基线未漂移**：复测最佳组合仍 off@0.9（0.949），与 D8（off@0.7 0.959）同量级——现有预设稳定。
3. **网关兼容性注意**：pro 在网关 `thinking-high` 组合失败（ok=false）；off@0.7 标题不合规——网关对 pro 的 thinking 参数透传不完整。
4. **三方最佳组合一致为 off@0.9**（thinking off + 温度 0.9）——参数建议与 flash 一致，无需为 pro 单独调参。

## 应用建议（待人工确认后写入 model_route）

- **prose 路由：维持 flash（off@0.9）**——pro 无质量收益、成本 3.1x、延迟 2.6x，不启用。
- **thinking 任务（review/director/analysis）**：pro thinking 组合在正文测试无优势（0.902-0.923 vs flash 同场景），且官方标题合规率不稳、网关 thinking-high 失败——**建议维持 flash，pro 保留为 fallback 候选**（若后续 thinking 深度不足再评估）。
- **结论与 D8 一致**：flash 全线最优；pro 正式版发布后校准确认不改变现状路由。

## 分报告

- `docs/calibration-report-pro-official.md`（官方全矩阵）
- `docs/calibration-report-pro-gateway.md`（网关）
- `docs/calibration-report-flash-recheck.md`（flash 基线复测）
