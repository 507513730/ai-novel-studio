# CI

> 工作流位于 .github/workflows/。

- **build.yml**：Release 构建产物 + latest.yml（tag 触发）；release-readiness 强制 PATCH 发版校验。
- **commitlint.yml**：PR 提交信息检查（Conventional Commits；标题中文、类型英文，AGENTS #60）。
- **pages.yml**：GitHub Pages 方案市场页。

## 本地等效

- 提交前：typecheck + lint + vitest 三绿（pre-push 钩子强制，`git config core.hooksPath scripts/git-hooks` 一次性安装）。
- 数据层：加 db:smoke；发版前：pack-verify + e2e 一轮。

## 纪律

- CI 红 → push 者本人优先修复（AGENTS #58）；禁止 if:false 跳过或静默吞错。
- push 被拒（远程有新提交）→ `git pull --rebase` 保留双方意图再推。
