# 统一错误模型

> R5 落地（services/shared/errors.ts），映射矩阵由 tests/error-mapping.test.ts 锁定。

| 错误 | HTTP | 响应 | 语义 |
|---|---|---|---|
| ZodError | 400 | `{error:'参数校验失败', issues}` | 输入校验失败 |
| ConfigurationError（含 ConfigError） | 400 | 消息透传（可操作指引） | 配置缺失/解密失败——修正前不可重试 |
| CancellationError | 499 | 固定文案 | 用户取消，不伪装成 500 |
| TransientProviderError | 503 | 固定文案 | 超时/限流/临时网络——可重试 |
| OutputValidationError | 502 | 固定文案 | 模型输出空/非法/截断 |
| PersistenceError / InvariantError | 500 | 固定文案 | 持久化失败 / 内部不变量破坏 |
| SQLite 约束冲突 | 409 | 固定文案 | 数据冲突 |
| `chapter not found` | 404 | 原文 | 资源缺失 |
| 其余 | 500 | `internal error` | 未分类（防内部信息泄露） |

## 域内约定

- `ConfigError` 继承 `ConfigurationError`（instanceof 双向成立）——生产/生成管线遇到配置错误整批熔断。
- 章节生成域：stale claim（token 失配）抛错且事务回滚；失败处理静默跳过（不触碰新 claim）。
- SSE 生成错误经 `error` 事件回传固定文案；详细日志留在服务端。
- API Key 不出现在错误、日志与 trace。
