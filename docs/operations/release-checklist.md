# 发布检查单

完整流程只维护在 [发布工作流](../development/release-workflow.md)；版本历史见 [versioning](../versioning.md)。

- [ ] 候选版本、实际代码和 CHANGELOG 对齐，不把已实现内容遗留在 Unreleased。
- [ ] typecheck、lint、test、db-smoke、依赖审计与文档检查通过。
- [ ] 新安装包构建成功；备份、SSE/导出与 T1-T5 证据均绑定同一提交及 app.asar 哈希。
- [ ] 本地合格源码已推送；检查对应 SHA 的 CI 与高危 CodeQL 告警，未通过不打 tag。
- [ ] 已获发布授权，执行 `pnpm release --push`；禁止 --skip-dist 组合和重复 tag。
- [ ] 所有平台构建成功、正式 Release 和全部资产齐全，再更新“已发布”台账。

`pnpm release` 默认仅本地验证，不会 bump、推送或创建 Release；`--bump=patch` 只准备版本。纯 docs/scripts/tests 改动无需额外 bump，按本地门禁、推送、CI 闭环。
