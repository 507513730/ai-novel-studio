// v0.9.0（审查 #9）：统一错误中间件
// 未分类错误只回固定文案（防内部信息泄露：SQLite 约束文本/绝对路径/TypeError 原文）
// R5：统一错误模型语义化映射——配置/取消/暂时性供应商/输出校验不再伪装成 500
// （配置类消息本身即用户可操作指引，随响应回传；其余类型回固定文案）

import type { Request, Response, NextFunction } from 'express'
import { ZodError } from 'zod'
import {
  ConfigurationError,
  CancellationError,
  TransientProviderError,
  OutputValidationError
} from './shared/errors'

export function apiErrorMiddleware(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof ZodError) {
    res.status(400).json({ error: '参数校验失败', issues: err.issues })
    return
  }
  // ConfigurationError（含 ConfigError）：配置缺失/解密失败——修正配置前不可重试，
  // 消息为用户可操作指引（"请在 设置 → 供应商 保存后重试"），随响应回传
  if (err instanceof ConfigurationError) {
    const message = err instanceof Error ? err.message : '配置错误'
    console.error('[api] 400 config error:', message)
    res.status(400).json({ error: message })
    return
  }
  // 取消语义不伪装成 500（499：客户端侧取消/请求方中止）
  if (err instanceof CancellationError) {
    res.status(499).json({ error: '操作已取消' })
    return
  }
  // 暂时性供应商错误（超时/限流/临时网络）——可稍后重试
  if (err instanceof TransientProviderError) {
    console.error('[api] 503 transient provider error')
    res.status(503).json({ error: '上游服务暂时不可用，请稍后重试' })
    return
  }
  // 上游模型输出问题（空内容/JSON 非法/截断/结构不完整）
  if (err instanceof OutputValidationError) {
    console.error('[api] 502 output validation error')
    res.status(502).json({ error: '模型输出校验失败，请重试或调整参数' })
    return
  }
  const message = err instanceof Error ? err.message : String(err)
  if (/FOREIGN KEY constraint|UNIQUE constraint|NOT NULL constraint/i.test(message)) {
    console.error('[api] 409 conflict:', message)
    res.status(409).json({ error: '数据冲突（约束不满足）' })
    return
  }
  if (err instanceof Error && err.message === 'chapter not found') {
    res.status(404).json({ error: err.message })
    return
  }
  console.error('[api] error:', message)
  res.status(500).json({ error: 'internal error' })
}
