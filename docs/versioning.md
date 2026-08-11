# 版本管理规范（versioning.md）

> 生效于 v0.3.0 重建事件（2026-08-11）。目的：杜绝"版本号与 tag 脱节"导致的错误发布。

## 1. 版本号语义（SemVer 2.0）

| 段位 | 含义 | 历史实例 |
|---|---|---|
| **MAJOR** | 产品能力跃迁（整本模式 / 跨端 / 在线市场） | 1.0 候选 |
| **MINOR** | 新功能 | 0.2.0（P14 系列）、0.3.0（P21 创造工坊） |
| **PATCH** | 修复与审查加固 | 0.2.1（P19）、0.2.2（P20 全面审查） |

## 2. 单一事实来源

- **package.json `version`** 是唯一权威（electron-builder 用它命名安装包）。
- tag 名 = `v` + version，**必须一致**，由 CI 强制校验（见 §5）。
- 发布前检查：`node -p "require('./package.json').version"`。

## 3. 发布流程（每次发布按序执行）

```powershell
# 1) 全量验证（必须全绿）
pnpm typecheck; pnpm lint; pnpm test; pnpm build; pnpm db:smoke

# 2) 按 §1 语义 bump package.json（提交信息含版本号，如 "chore: v0.3.1"）
# 3) 打 tag（指向该提交）并推送
git tag vX.Y.Z
git push origin main
git push origin vX.Y.Z        # 触发 CI（自动构建 + 发布 Release）
```

## 4. 禁则

- ❌ 禁止 force 已有 tag（`git push --force origin vX.Y.Z`）
- ❌ 禁止跨版本打 tag（0.2.x 时代打 v0.3.0 —— 2026-08-10 事故）
- ❌ 禁止修改已发布 Release 的版本号（要改就发下一版）
- ❌ 禁止手工在 GitHub 页面编辑 Release（重建请走 §6）

## 5. CI 强制校验

`.github/workflows/build.yml` 在打包前执行：
`tag vX.Y.Z == package.json version X.Y.Z`，不一致直接失败 → 不产出安装包、不创建 Release。

## 6. 重建 Release（时间戳/资产异常时）

```powershell
gh release delete vX.Y.Z --yes      # 1) 删 Release（保留 tag）
git tag -d vX.Y.Z                    # 2) 删本地 tag
git push origin :refs/tags/vX.Y.Z   # 3) 删远程 tag
git tag vX.Y.Z                       # 4) 在同提交上重打
git push origin vX.Y.Z              # 5) 重推触发 CI → 全新 Release（干净 published_at）
```

## 7. 版本规划（当前路线）

| 版本 | 内容 | 状态 |
|---|---|---|
| 0.3.0 | P21 创造工坊（方案/技能/智能体资产化 + Feelfish 导入） | ✅ 已发布 |
| 0.3.1+ | 后续修复（PATCH 节奏） | 待定 |
| 0.4.0 | whole_book 整本执行器 / 方案级预算 / AGENTS.md 导出 / 在线市场（择一或多个） | 规划中 |
| 1.0.0 | MAJOR：跨端（Web/macOS）或生态开放 | 远期 |
