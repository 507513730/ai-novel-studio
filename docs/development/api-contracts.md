# API 契约

> 路径/方法/状态码/camelCase 响应保持兼容，由 tests/api-contracts.test.ts 锁定。路由只做校验、服务调用与响应映射。

## 挂载

`/api/novels/:novelId/...`（章节执行/卷章/导演/自动化/分析/风格/导出）、`/api/settings`、`/api/agents`、`/api/solutions`、`/api`（任务中心/资产/知识库）。

## 关键端点（示例）

| 端点 | 说明 |
|---|---|
| POST /:novelId/chapters/:chapterId/generate | SSE 流式生成（context/delta/thinking/done/aborted/error 事件） |
| POST .../review · /fix · /backfill · /proofread | 审核 / patch_first 修复 / 回灌 / 本地校对 |
| GET·POST .../versions[/:versionId][/diff|/restore] | 版本列表/快照/详情/diff/恢复 |
| GET /:novelId/search · .../context-preview | 全书检索 / 写作上下文可视化 |
| GET·POST /:novelId/memory[/character|/faction] | 记忆面查看与修正 |
| POST /jobs + GET /jobs/:id + cancel/retry | 任务中心（入队/轮询/取消/换模型重试） |

## 错误响应

统一 `{ error: string }`（ZodError 附 `issues`）；映射矩阵见 [error-model](error-model.md)。

## 鉴权

- 打包态 Electron renderer 经 preload 注入 `X-App-Token`（preload 引导竞态下 IPC 侧限定主窗口顶层 frame）。
- Origin 白名单：无 Origin（非浏览器）/ localhost 任意端口 / file://(null) + token / dev 5173。
