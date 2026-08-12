# 安全策略（SECURITY）

## 支持的版本

| 版本 | 支持状态 |
|---|---|
| ≥ 0.9.0 | ✅ 支持 |
| < 0.9.0 | ❌ 不再支持（建议升级） |

安全修复通常跟随最近版本发布（PATCH），见 `docs/CHANGELOG.md`。

## 报告漏洞

**请勿在公开 Issue 中报告漏洞。** 使用以下方式之一私密报告：

1. **GitHub 安全公告**：仓库页面 → Security → Report a vulnerability（推荐）
2. **私密 Issue 联系**：若无公开邮箱，可在 Issue 中说明"有安全问题要报告，请开启私密渠道"，由维护者回复联系方式

## 报告内容

- 受影响的版本
- 漏洞类型与严重程度
- 完整复现步骤（最小化）
- 期望行为 vs 实际行为

## 本项目的安全设计（供审计参考）

- **API Key**：经 Electron `safeStorage`（系统密钥环/DPAPI）加密后入库，禁止明文/日志/前端暴露；设置页只回显 `has_key` 布尔
- **本地服务**：Express 仅监听 `127.0.0.1` 随机端口；打包态强制 `X-App-Token`（随机生成，经 preload 注入渲染进程，恶意网页拿不到）
- **CORS**：仅允许本地来源（file://、localhost）；null Origin（打包态）强制 token
- **渲染进程**：`contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`；外链仅 http/https；阻止导航到外部站点
- **数据**：SQLite 全部参数化查询（无 SQL 注入面）；无任意文件读写接口
- **错误处理**：API 错误只回固定文案，内部信息（路径/SQL 细节）只进服务端日志

## 已知边界（设计取舍）

- 单用户本地应用：鉴权目标是"阻止恶意网页跨站调用本地 API"，不提供多用户隔离
- `safeStorage` 不可用时密钥明文存储（有告警日志）——Linux 无 keyring 环境的已知降级
