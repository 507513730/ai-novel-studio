# 发布检查单

> 版本规则与发布命令见 [versioning](../versioning.md)（发版 = `pnpm release`，禁止手动 bump/tag）。

## 发版前（CI release-readiness 会强制校验）

1. `pnpm typecheck` / `pnpm lint` / `pnpm vitest run` 三绿。
2. 数据层改动：`pnpm db:smoke`。
3. `pnpm dist` 双产物生成 + `node scripts/v072-pack-verify.mjs` PASS。
4. `node scripts/e2e/round.mjs 1`（T1-T5，OpenCode Go 网关 key 从 auth.json 读取不落盘）。
5. 文档：`node scripts/check-docs.mjs` + `node scripts/verify-docs.mjs`。

## 发布

1. `pnpm release`（bump + tag + GitHub Release；CI 校验 tag == version）。
2. CHANGELOG 同批更新；PLAN 进度推进；decision-log 记录决策。
3. release/ 产物 = 正式交付物（安装版 + 便携版时间戳一致）。

## 发布类型

- PATCH：修复（CI 强制 bump）。
- MINOR：功能批（批次完成即发）。
- MAJOR：1.0 判据达成（versioning §1.1）。
- 仅 docs/scripts/tests 改动：免发版，推送即可。
