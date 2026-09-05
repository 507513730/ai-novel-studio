# 仓库地图

> 面向协作者的结构导览（协作流程见 [AI-AGENT-ONBOARDING](../AI-AGENT-ONBOARDING.md)）。

```
client/src/       React 19 渲染层：pages/（含 chapter/ 子组件与 hooks/）workspace/ components/ editor/
server/src/       服务层：routes/（chapters/ 七模块 + 单域路由）services/（业务域）db/ prompts/
electron/         主进程：main.ts（纯装配）+ state/window/serverProcess/shutdown/ipc/theme/updater
shared/           前后端共享类型（camelCase 契约，AGENTS #20）
tests/            vitest：域契约 / 特征锁定 / 架构守护 / 组件测试
scripts/          db-smoke / e2e（round/longbook）/ release / verify-docs / e2e/desktop-run
docs/             用户文档 user/ · 开发文档 development/ · 运维 operations/ · 参考 reference/ · 治理入口 · archive/
```

## 服务层业务域（R0-R8 重构后）

| 域 | 入口 | 说明 |
|---|---|---|
| chapterGeneration/ | orchestrator（generate.ts 为兼容转发） | 抢占 state / 落库 persistence / 后处理 postProcess |
| jobs/ | scheduler + repository | 生命周期 / payload / 执行器注册表 / claim token |
| director/ | pipeline（director.ts 为兼容转发） | stages / checkpoint / artifacts（产物判定）/ executors |
| production/ | pipeline（production.ts 为兼容转发） | chapterPolicy / progress |
| context/ | dynamic + frozen（context.ts 为兼容转发） | hash / budget（前缀冻结 + 预算裁剪） |
| llm/ | caller（llm.ts 为兼容转发） | routes / candidates / request / errors |
| shared/ | errors.ts + text.ts | 统一错误模型 / 共享纯函数 |
