# 贡献指南（CONTRIBUTING）

感谢你考虑为 AI-Novel-Studio 贡献。这是一个个人维护的开源项目，目标是做好**中文 AI 小说创作工作台**。

## 我能贡献什么？

- **Bug 报告**：使用中遇到问题 → 新建 Issue（选 Bug 模板），附上：复现步骤、期望行为、实际行为、版本号（设置页/`package.json`）、系统信息
- **功能建议**：新建 Issue（选 Feature 模板），说明使用场景与期望效果
- **代码/文档**：Fork → 修改 → PR（流程见下）
- **智能体方案**：创作工坊支持导入 Feelfish 智能体方案——好的方案本身就是贡献

## 环境准备

```powershell
corepack enable pnpm
pnpm install
pnpm dev            # 开发（electron-vite 三端）
```

要求：Node ≥24（内置 node:sqlite）、pnpm ≥10、Windows/macOS/Linux 均可。

## 开发纪律（完整版见 AGENTS.md）

1. **零原生依赖**：数据层只用 `node:sqlite`（禁止 better-sqlite3/Prisma 等需 rebuild 的包）
2. **版本锁定**：electron 43.3.0 / react 19.2.8 / express 5.2.1 / zod 4.4.3 等，见 AGENTS.md 硬性约束 §2
3. **API Key 安全**：一律经 Electron safeStorage 加密存储；禁止明文、禁止打日志、禁止提交
4. **执行面隔离**：重型链路（导演/整本生产）只经 job 表 + scheduler，禁止在 API 路由内同步跑长链路
5. **模型纪律**：默认全部使用 deepseek-v4-flash；thinking 开关按路由配置显式传递

## 提交规范（Conventional Commits）

提交信息必须遵循 [Conventional Commits](https://www.conventionalcommits.org/)：

```
<type>(<scope>): <描述>

类型：feat（新功能）/ fix（修复）/ docs（文档）/ refactor（重构）/ test（测试）/ chore（构建与杂项）
scope 建议：p30（方案流水线）/ runner / context / sse / settings / client / electron ...
```

- `feat` → MINOR、`fix` → PATCH（语义化版本）
- 破坏性变更必须标注 `BREAKING CHANGE:` 页脚（对应 MAJOR）
- CI 会检查 PR 的 commit 格式（commitlint）

## PR 流程

1. Fork 仓库，从 `main` 开分支（`feat/xxx` 或 `fix/xxx`）
2. 本地验证必须全绿：
   ```powershell
   pnpm typecheck; pnpm lint; pnpm test; pnpm build; pnpm db:smoke
   ```
3. 涉及用户可见行为 → 同步更新 `docs/CHANGELOG.md`（Unreleased 段）
4. 提交 PR：填写模板（变更内容 / 版本意图 / 检查项）
5. 合并由维护者完成（PR squash），遵循 `docs/versioning.md` §3.1 合入门禁

## 发布流程（维护者）

- 唯一入口：`pnpm release --push`（文档检查 → 全量验证 → 本地构建 → tag → CI 发布）
- 版本规范见 `docs/versioning.md`（SemVer + tag==version CI 强制校验）

## 沟通

- 技术问题优先开 Issue（公开透明，他人受益）
- 紧急安全问题见 SECURITY.md（私密报告）

再次感谢你的贡献。
