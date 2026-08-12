## 变更内容

（一句话说明）

## 版本意图（必填，二选一）

- [ ] 本次含 `src/**` 功能变更 → 已 bump package.json 版本 + 更新 CHANGELOG.md（versioning.md §3.1 合入门禁，CI 会校验）
- [ ] 纯文档/配置变更（docs/site/.github/scripts）→ 无需发版

## 检查

- [ ] typecheck / lint / test 通过（CI 自动跑，也可本地 `pnpm typecheck; pnpm lint; pnpm test`）
- [ ] 涉及用户可见行为 → CHANGELOG.md 已写
- [ ] 新增依赖 → 确认生产依赖必要性；**构建期资源（字体/图标）必须 -D 安装**（D66 教训：@fontsource 误入 asar 导致安装包 343MB）
- [ ] 涉及发布 → 用 `pnpm release --push` 而非手动 push

## 备注

（可选）
