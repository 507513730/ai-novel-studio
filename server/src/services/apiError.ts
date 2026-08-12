// v0.9.0（审查 #9）：带状态码的业务错误 + 统一错误中间件
// 未分类错误只回固定文案（防内部信息泄露：SQLite 约束文本/绝对路径/TypeError 原文）

import type { Request, Response, NextFunction } from 'express'
import { ZodError } from 'zod'

export class ApiError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
    this.name = 'ApiError'
  }
}

/** 客户端可见的错误文案（固定、无内部信息） */
export function publicErrorText(err: unknown): { status: number; message: string } {
  if (err instanceof ApiError) {
    return { status: err.status, message: err.message }
  }
  return { status: 500, message: 'internal error' }
}

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
