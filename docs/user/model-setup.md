# 模型配置

> 支持多供应商 + 任务级路由。参数语义由契约测试锁定（decision-log D117）。

## 供应商与 API Key

- 「设置 → 供应商」新增供应商（名称 / Base URL / API Key）。
- Key 经系统安全存储加密（safeStorage）后入库；解密失败时应用会明确报错并要求重新保存，不会明文落库。
- 「OpenCode Go 网关」可通过「导入」一键配置（读取本机 OpenCode 配置，Key 不落盘到仓库）。

## 任务路由

每个任务类型（prose 生成 / extraction 结构化输出 / review 审核 / director 导演 / chat 对话 / summary 摘要 / analysis 拆书 / planning 规划等）独立配置：

- **模型**：按任务选择（默认全 flash，pro 预留路由位）。
- **thinking 开关**：DeepSeek V4 默认开启思考；关闭时应用会显式发送 `thinking: disabled`（否则温度无效）。
- **温度**：仅 thinking 关闭时生效（开启思考时温度参数无效，界面会提示）。
- **max_tokens**：过低会被截断——生成被截断的章节不会落库（显式失败提示调大）。
- **fallback 链**：主模型失败按顺序降级；重试指定的换模型优先于 fallback。

## 重试与降级

- 章节生成失败：任务级失败，章节标记 failed 可重试；成本确认后重新生成。
- 限流（429）：自动按 Retry-After 退避，之后换 fallback 候选。
- 配置错误（Key 缺失/解密失败）：整批熔断不逐章空转，错误信息给出可操作指引。

## 默认模型

默认主模型 `deepseek-v4-flash`。更换新模型前应先校准对比（校准报告见 `docs/reference/calibration/`）。
