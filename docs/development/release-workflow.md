# 发布工作流与证据

## 状态口径（2026-09-05 核实）

| 状态 | 当前事实 | 依据 |
|---|---|---|
| 工作树候选 | v1.1.1 | package.json |
| 最新已发布 | v1.0.0 | GitHub 非 draft Release；已核对 48 个 Release |
| v1.1.0 | tag 存在，Release 不存在 | Build Release run 33290490484：lockfile overrides 不匹配 |
| v1.1.1 | 已正式发布 | tag 59b5671、完整 E2E、Build Release 33958310816、资产已核对 |

以上为核实快照，不是持续监控；后续以实际 GitHub Release 和验收证据更新。版本历史表只发现 v1.1.0 的“已发布”声明不符合远端现状，已纠正。

## 分层流程

1. **准备与冻结批次**：明确本批文件、验收与风险；不要在失败门禁未定位时继续扩大业务改动。仅当当前版本已有 tag 才通过 `pnpm release --bump=patch` 准备下一候选；未发布候选继续修正，不重复 bump。
2. **文档同步**：将本批已实现变更写入候选版本段，Unreleased 留给真正后续工作。区分源码版本、候选包、已发布版本。历史事故记录不等于当前操作授权。
3. **本地确定性门禁**：typecheck、lint、test；数据层改动加 db-smoke；依赖审计、文档检查、打包。非零退出码必须失败。
4. **源码推送与 CI**：本地合格提交推 main，记录 SHA，查看该 SHA 的检查。不能借用别的提交或 workflow 的绿勾；修复后再次推送，保留失败记录。
5. **候选包验证**：独立 Electron/utilityProcess、随机端口、加密凭证；先无模型备份冒烟，再 SSE/导出，再完整 T1-T5。付费失败先定向诊断，不跳过断言。
6. **正式发布**：用户授权后执行发布脚本；所有证据与提交/包匹配，对应 SHA 的 CI 通过，才创建新 tag。跨平台矩阵全部成功后统一发布。
7. **交付记录**：检查正式 Release 与全部资产，记录 publishedAt、tag SHA、CI run、包哈希。之后同步版本表；不靠“脚本走到最后”推断成功。

## 常用命令

`pnpm release --bump=patch` 仅准备，不会同时发布。

`pnpm release` 做本地门禁和备份冒烟；`pnpm release --e2e` 才包含完整付费测试。

`pnpm release --push` 强制完整门禁，不需要额外记得加 --e2e。

`pnpm release --push --reuse-evidence` 只允许复用同 SHA、版本、供应商和 app.asar 哈希的成功证据；构建内容变化或脏工作区证据会被拒绝。不能以此跳过缺失的测试。

`node scripts/e2e/desktop-run.mjs --probe-directions` 仅诊断两个方向步骤，**不能代替全量 E2E**。

`node scripts/e2e/desktop-run.mjs --backup --packaged` 只做无模型备份恢复冒烟，**不能代替全量 E2E**。

默认 opencode-go。网关异常有证据时按 D103 显式加 `--provider=deepseek` 使用官方备用；记录实际供应商，不能冒称网关验证通过。统一 deepseek-v4-flash，不隐式换模型。

## 证据契约

- 测试结果保存在 release 下私有运行目录；完整模式必须包含且仅包含 T1-T5，每项至少一个成功断言且无失败。
- 证据包含 mode、provider、head、version、bundleHash、dirty、code、rendererReady、captureAttempts 和完成时间；实际服务版本也必须匹配候选。超过 24 小时的旧报告、部分完成、脏工作区报告、GUI 零退出但缺失结果文件均不能发布。
- 中止或第一次失败保存 partial，后续命令不得覆盖成成功；供应商诊断仅存枚举类别/耗时，不存 Key 或原始服务错误。
- 完整套件证据证明执行了 T1-T5，不代表覆盖所有 kill/磁盘故障；专项故障注入范围仍应单独说明。

## 本次执行复盘

前两轮的问题包括：先扩大业务修改后收尾发布；重复打包但缺少提交绑定；定向故障未定位便长时间跑后续模型任务；将源码推送与正式发布混为一谈，使远端 CI 无法启动；版本表没有与实际 Release 核对。这些属于流程问题，不应仅归咎于网关波动。

本轮先修流程和证据，不新增业务功能。v1.1.0 的失败 tag 保留不动，修复只进入 v1.1.1 候选。

发布前可运行 `node scripts/verify-release-ledger.mjs` 对已发布台账逐行核对远端正式 Release；远端不可达时返回失败，不将无法核验当作成功。

包管理器由 package.json 的 packageManager 精确固定；CI 不再另写一个漂移的版本号。安全 overrides 与构建脚本允许列表只维护在 pnpm-workspace.yaml。生产与全依赖审计必须分别通过，不能让打包工具链高危从 prod-only 检查中漏过。

结果对象只构造并序列化一次，原始文件与父进程副本使用同一内容。每个门禁结束立即校验传输后的完整证据，不能等到全部付费步骤做完才发现字段缺失；最终打 tag 前仍复查提交和产物未变化。


## 发布完成快照

v1.1.1 已于 2026-09-05 正式发布。后续修复不得重指此 tag；新改动进入下一 PATCH。
