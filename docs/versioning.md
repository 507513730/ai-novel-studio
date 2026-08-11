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

## 3. 发布流程（发布清单，推荐用 `pnpm release` 自动执行）

> **唯一入口**：`pnpm release`（scripts/release.mjs）——文档检查 → 全量验证 → 本地构建 → 提交/tag 指引，任一步失败即终止。`--push` 半自动提交推送。

**手动执行时按以下清单逐项打勾（缺一项即不完整）：**

```powershell
# 0) 文档更新（先于一切——脚本会强制检查，手动时不得跳过）
#    □ release-notes.md 新版本段落（## vX.Y.Z：安装方式 + 功能 + 工程）
#    □ PLAN.md 对应段落勾选
#    □ decision-log.md 本次关键决策
#    □ test-report.md 验证记录
#    □ README.md（功能变化时）/ audit-report.md（预留项状态）/ versioning.md §7（规划表）

# 1) 全量验证（必须全绿）
pnpm typecheck; pnpm lint; pnpm test; pnpm build; pnpm db:smoke

# 2) 本地构建（release/ 与远程 Release 同步——每次发布都必须跑）
pnpm dist        # 或直接 pnpm release 一并完成

# 3) 按 §1 语义确认 package.json 版本号已 bump（提交信息含版本号）
# 4) 提交 + 打 tag + 推送
git add -A && git commit -m "chore: release vX.Y.Z"
git tag vX.Y.Z
git push origin main
git push origin vX.Y.Z        # 触发 CI（自动构建 + 发布 Release）

# 5) 发布后确认
#    □ CI 通过（gh run list）
#    □ Release 资产齐全（gh release view vX.Y.Z）
#    □ 本地 release/ 产物版本号 = vX.Y.Z
```

## 3.1 合入门禁（2026-08-11 增补，P25 违规教训）

> **任何功能/修复合入 main 即须 bump 版本（PATCH 起）并发版——禁止"合入未发版"状态。**

- 合入 main 的唯一动作：`pnpm release --push`（自动完成：文档检查 → 验证 → 本地构建 → 提交 → tag → push）
- 代码合入但版本未 bump = 违规（本地 release/ 与文档必然落后，P25 教训）
- 极小改动（纯注释/文档）可免发版，但必须在同批提交中同步 PLAN.md/decision-log 并明确说明

## 3.2 CI 红叉纪律（2026-08-11 增补）

- **红叉不隔夜**：CI 失败当天处理（修复或按 §7 删除记录），不留历史失败
- workflow 禁用采用 `jobs.*.if: false` + 注释说明启用条件（如 pages.yml）
- 删除历史失败 run：`gh run delete <id>`（GitHub 支持）

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


## 8. ??????????????P26?

### ???

????????
- ???**????**???/??/?????? D66?? ? ?6 ???? Release ? ?? tag ? ???
- ???**??**?**???**?????????? ? hotfix?PATCH+1??release-notes ????????xxx?
- ???**??**?**???**??? <1 ?????????? ???? Release + ???????6?

### ????

- ????`gh release view vX.Y.Z --json assets --jq '[.assets[].download_count] | add'`
- ????? < 1 ??
- ???issue / ?? / ?????D66 ???

### hotfix ????????

1. ???? + bump PATCH+1 + release-notes????????
2. `pnpm release --push`??????[7/7] ?????
3. ? Release ??????????hotfix Release ????

### ??

- ? ???????? > 0 ? Release ??????????????? hotfix?
- ? ??????????Release ??????? ?4?
