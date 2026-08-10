import type { Request, Response, NextFunction } from 'express'

// ============================================================
// 安全边界（P2.2 修复 #1）
// CORS 白名单 + Origin 校验：只允许本地来源（file://、localhost、127.0.0.1）
// 阻止任意网页通过浏览器跨站调用本地 API（消耗额度/篡改数据）
// ============================================================

const DEV_RENDERER = process.env.ELECTRON_RENDERER_URL
const DEV_ORIGIN = DEV_RENDERER ? new URL(DEV_RENDERER).origin : null

export const ALLOWED_ORIGINS = new Set<string>([
  'null', // file:// 页面（Electron 打包态）
  'http://localhost:5173', // electron-vite dev renderer
  DEV_ORIGIN ?? ''
].filter(Boolean))

export function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return true // 非浏览器客户端（curl/Node）无 Origin，放行
  if (ALLOWED_ORIGINS.has(origin)) return true
  // localhost / 127.0.0.1 任意端口
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return true
  return false
}

export function originGuard(req: Request, res: Response, next: NextFunction): void {
  const origin = req.headers.origin
  if (!isAllowedOrigin(origin)) {
    res.status(403).json({ error: 'origin not allowed' })
    return
  }
  // 白名单来源回显 ACAO（浏览器需要）
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    res.setHeader('Vary', 'Origin')
  }
  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return
  }
  next()
}
