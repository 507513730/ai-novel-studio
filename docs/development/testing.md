# 测试

> 门禁：每批 typecheck + lint + vitest 三绿；数据层改动加 db:smoke；打包改动跑 desktop-run --smoke --packaged；发版前跑 E2E 一轮。

## 分层

| 层 | 位置 | 说明 |
|---|---|---|
| 域契约 | tests/*.test.ts | 章节生成/作业/导演/生产/上下文/LLM 的行为锁定（拆分前后特征一致） |
| 架构守护 | tests/architecture-guard.test.ts | 域边界源码扫描（routes 不导 pipeline、版本落库唯一入口等） |
| 组件 | tests/*.test.tsx | jsdom + @testing-library/react（面板渲染/交互） |
| Hook | tests/client-chapter-state.test.ts | renderHook 契约（保存保护/竞态加载/生成控制） |
| 打包态 | scripts/e2e/desktop-run.mjs --smoke --packaged | 构建产物起 server：鉴权/SSE/导出等价验收 |
| E2E | scripts/e2e/round.mjs | T1 配置 / T2 创作主链 / T3 资产 / T4 导演恢复 / T5 功能回归 |

## 约定

- 数据库测试一律内存库（`:memory:` + applyMigrations + seedIfEmpty），禁止写真实用户库。
- mock 外部 SDK（openai / electron）而非服务内部；vi.mock 路径指向迁移后的域模块。
- 故障注入场景：kill/restart、迟到协程、watchdog 回收、空正文、截断、取消竞态——各自有具名测试。

## 证据与付费测试

测试通过必须读取退出码与结构化结果。完整 E2E 要有 T1-T5 全部完成记录；专项 probe、部分通过、人工中止不能替代完整套件。发布证据绑定 SHA、版本、供应商和 app.asar 哈希；脏工作区结果仅供调试。诊断失败先复现单个问题，不重复整轮生成，详见 [发布工作流](release-workflow.md)。

## 运行器预算（D133）

测试使用 forks，最多 4 个 worker、最少 1 个，保持文件隔离。此设置来自默认高并发出现两次 IPC 通道关闭后的有界对照验证，不减少测试，不忽略运行器错误。再次发生异常时仍失败并排查；禁止把“重跑偶尔绿”作为长期发布策略。
