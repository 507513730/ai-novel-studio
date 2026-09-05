# CI

- build.yml：main/PR 执行检查；tag 或明确手动运行执行平台矩阵；单独 publish job 依赖整个矩阵成功。
- release-readiness.yml：源码变更（包括 shared 根目录）检查候选版本与文档；不是“已经发布”的证明。读取 git diff 失败必须使检查失败。
- docs-lint.yml：所有 main push 和 PR 检查文档健康，避免发布所需检查因路径过滤缺席。
- codeql.yml：代码安全分析；流程成功仍需检查未关闭高危告警。
- commitlint.yml：PR 提交规范；本地使用 pnpm exec commitlint 核对中文提交。
- pages.yml：站点部署，与桌面产品发布分开记录。

本地门禁通过后 push 才能触发该 SHA 的远端检查。发布脚本按 SHA、分支、事件和工作流名选择 run，不读取“最近一次绿勾”。本地检查与 CI 不是完全相同集合。

失败由推送者闭环；保留失败 run，不删除、不禁用、不静默吞错。禁止改写已发布 tag。推送被拒时检查他人改动，再按约定 rebase，不 force 覆盖。

详细门禁与证据见 [发布工作流](../development/release-workflow.md)。
