# 版本管理规范（versioning.md）

> 生效于 v0.3.0 重建事件（2026-08-11）。目的：杜绝"版本号与 tag 脱节"导致的错误发布。

## 1. 版本号语义（SemVer 2.0）

| 段位 | 含义 | 历史实例 |
|---|---|---|
| **MAJOR** | 稳定承诺（1.0 判据见下）或产品能力跃迁（整本模式 / 跨端 / 在线市场） | 1.0 候选 |
| **MINOR** | 新功能 | 0.2.0（P14 系列）、0.3.0（P21 创造工坊） |
| **PATCH** | 修复与审查加固 | 0.2.1（P19）、0.2.2（P20 全面审查） |

### 1.1 1.0 判定（v0.15.0 修订——稳定承诺语义，不再绑定跨端）

> 修订背景：原定义（跨端/生态开放）把 1.0 绑定在"新能力"上，偏离 SemVer 的"稳定承诺"本意；
> 跨端等能力升级可作 1.x 的 MAJOR/MINOR，不阻塞 1.0。

**三个条件全部达成即 1.0.0：**
1. **真实写书完成**——用本产品完整写完一本书（30 万字项目收官，全链路真实验证）；
2. **核心链稳定**——连续 1-2 个版本无 P0/P1 修复（生成/审核/修复/回灌/方案流水线）；
3. **数据格式冻结**——DB schema 与方案格式进入兼容承诺期（无破坏性迁移）。

## 2. 单一事实来源

- **package.json `version`** 是唯一权威（electron-builder 用它命名安装包）。
- tag 名 = `v` + version，**必须一致**，由 CI 强制校验（见 §5）。
- 发布前检查：`node -p "require('./package.json').version"`。

## 3. 发布流程（发布清单，推荐用 `pnpm release` 自动执行）

> **唯一入口**：`pnpm release`（scripts/release.mjs）——文档检查 → 全量验证 → 本地构建 → 提交/tag 指引，任一步失败即终止。`--push` 半自动提交推送。

**手动执行时按以下清单逐项打勾（缺一项即不完整）：**

```powershell
# 0) 文档更新（先于一切——脚本会强制检查，手动时不得跳过）
#    □ CHANGELOG.md 新版本段落（## vX.Y.Z：安装方式 + 功能 + 工程）
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
| 0.5.0 | 资产库统一建设（九大资产页 + 上传/粘贴/AI 提取） | ✅ 已发布 |
| 0.5.1 | P25 规范补强（合入门禁/红叉清理/pages 停用） | ✅ 已发布 |
| 0.5.2 | 打包瘦身（@fontsource 移 devDeps，343MB→123MB） | ✅ 已发布 |
| 0.6.0 | 整本生产 3 章验收 + e2e 门禁 | ✅ 已发布 |
| 0.6.1 | 体验修复批 | ✅ 已发布 |
| 0.6.2 | 体验修复批 | ✅ 已发布 |
| 0.7.0 | P30 章节生产流水线（方案接力生成正文） | ✅ 已发布 |
| 0.7.1 | P30 真机修复（正文类步骤纯文本 + Feelfish 导入 key） | ✅ 已发布 |
| 0.7.2 | 审查发布阻断修复（SSE/导出 token + 收尾防重复 + 删书取消 job） | ✅ 已发布 |
| 0.7.3 | Node24 SSE 回归修复（req close 语义） | ✅ 已发布 |
| 0.8.0 | 审查批2：P30 正确性（schema/任务单保序/原子抢占/JSON_FORMAT/watchdog/吞错） | ✅ 已发布 |
| 0.9.0 | 审查批3+4：错误收敛/安全加固/正确性/客户端收敛/服务端清理 | ✅ 已发布 |
| 0.9.1 | 开放仓库准备（敏感清理/License/健康文件/CHANGELOG/README/commitlint） | ✅ 已发布 |
| 0.9.2 | 批A：发布自动验收/双 LLM 路径合并/e2e 门禁/自动备份 | ✅ 已发布 |
| 0.9.3 | 查证收尾（补查 4 关键点/D75 勘误/查证纪律/SDK maxRetries） | ✅ 已发布 |
| 0.10.0 | 批B：成本预警（月度预算）+ 质量债自动修复闭环 | ✅ 已发布 |
| 0.11.0 | 批C：方案包（solution-pack）+ 方案市场（GitHub 仓库）+ 红叉清理 | ✅ 已发布 |
| 0.11.1 | UI 体验修复：智能体删除/乱码清理/空状态统一 | ✅ 已发布 |
| 0.12.0 | 批D：P31 方案感知卷章（整本生产注入卷章角色） | ✅ 已发布 |
| 0.13.0 | 批E：世界状态机（I4）+ 文档补救（versioning 补齐/verify-docs 机制） | ✅ 已发布 |
| 0.14.0 | 批F：风格指纹（I5，文体计量学统计提取）——O1-O5+I1-I5 全量完成 | ✅ 已发布 |
| 0.15.0 | 用户创作约束机制（硬/软分级 · 全链注入 · 确定性校验 · 主角名自动对齐） | ✅ 已发布 |
| 0.16.0 | 检查更新（electron-updater 自更新）+ 成本人民币显示（汇率自动获取/手动覆盖） | ✅ 已发布 |
| 0.16.1 | 修复：nsis 产物横线命名（updater 元数据一致，防下载 404） | ✅ 已发布 |
| 0.16.2 | 修复：检查更新静态导入（动态 import CJS interop bug）+ 防御兜底 | ✅ 已发布 |
| 0.16.3 | 修复：更新页版本号不显示（广播带 currentVersion + renderer 兜底） | ✅ 已发布 |
| 0.17.0 | 全量审查修复批（11 HIGH/45 MEDIUM/25 LOW：状态机自愈/安全加固/camelCase 契约/并发纪律） | ✅ 已发布 |
| 0.18.0 | 联网查找可开关（零 key Wikipedia · 知识库一键导入 · 世界观生成注入） | ✅ 已发布 |
| 0.19.0 | 编辑器光标续写（Cmd+J 建议/Tab 插入）+ 人类/AI 字数分离（NovelCraft 学习组） | ✅ 已发布 |
| 0.20.0 | 生产运行轨迹 + 记忆面可编辑 + 故事板视图（NovelClaw 学习组；角色库复用已有） | ✅ 已发布 |
| 0.21.0 | 第二轮审查修复批（N1 字数记账/N2 race/N3-N5 + 残留收敛 + P3 全量） | ✅ 已发布 |
| 0.22.0 | N1 字数覆盖语义修正 + ALOW confirm 全统一 + 文档债重建（D36-D89） | ✅ 已发布 |
| 0.22.1 | 修复：kb_doc 标题清洗（? 前缀事故防再犯） | 规划中（待发布） |
| 1.0.0 | 稳定承诺（判据见 §1 修订）：真实写书完成 + 核心链 1-2 版无 P0/P1 + 数据格式冻结 | 写书收官后 |
| 1.0.0 | 稳定承诺（判据见 §1 修订）：真实写书完成 + 核心链 1-2 版无 P0/P1 + 数据格式冻结 | 写书收官后 |


## 8. ??????????????P26?

### ???

????????
- ???**????**???/??/?????? D66?? ? ?6 ???? Release ? ?? tag ? ???
- ???**??**?**???**?????????? ? hotfix?PATCH+1??CHANGELOG ????????xxx?
- ???**??**?**???**??? <1 ?????????? ???? Release + ???????6?

### ????

- ????`gh release view vX.Y.Z --json assets --jq '[.assets[].download_count] | add'`
- ????? < 1 ??
- ???issue / ?? / ?????D66 ???

### hotfix ????????

1. ???? + bump PATCH+1 + CHANGELOG????????
2. `pnpm release --push`??????[7/7] ?????
3. ? Release ??????????hotfix Release ????

### ??

- ? ???????? > 0 ? Release ??????????????? hotfix?
- ? ??????????Release ??????? ?4?
