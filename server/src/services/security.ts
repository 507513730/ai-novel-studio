import type { Request, Response, NextFunction } from 'express'

// ============================================================
// 安全边界（P2.2 修复 #1 + P20 深度防护）
// CORS 白名单 + Origin 校验：只允许本地来源（file://、localhost、127.0.0.1）
// 阻止任意网页通过浏览器跨站调用本地 API（消耗额度/篡改数据）
//
// P20（S1）：file:// 页面的 Origin 是字符串 "null"，恶意沙箱 iframe 的 Origin
// 恰好也是 "null"——无法从 Origin 头区分二者。因此对 null Origin 强制要求
// X-App-Token（Electron renderer 经 preload 注入，恶意网页拿不到），未配置
// SERVER_TOKEN（独立调试）时退化为仅 Origin 校验。
// ============================================================

const DEV_RENDERER = process.env.ELECTRON_RENDERER_URL
const DEV_ORIGIN = DEV_RENDERER ? new URL(DEV_RENDERER).origin : null

export const ALLOWED_ORIGINS = new Set<string>(
  [
    'http://localhost:5173', // electron-vite dev renderer
    DEV_ORIGIN ?? ''
  ].filter(Boolean)
)

export function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return true // 非浏览器客户端（curl/Node/Electron file:// 部分场景）无 Origin，放行
  if (ALLOWED_ORIGINS.has(origin)) return true
  // localhost / 127.0.0.1 任意端口
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return true
  // file:// 打包态（Origin: null）——需配合 X-App-Token 深度校验（见 originGuard）
  if (origin === 'null') return true
  return false
}

/**
 * v0.25.0（审查 M3）：是否强制校验 X-App-Token。
 * 仅在 SERVER_TOKEN 已配置时生效；显式设置 AI_NOVEL_TOKEN_OPTIONAL=1 可关闭
 * （供独立调试 / 浏览器直连调试使用）。
 */
function tokenRequired(): boolean {
  return Boolean(process.env.SERVER_TOKEN) && process.env.AI_NOVEL_TOKEN_OPTIONAL !== '1'
}

function reject(res: Response): void {
  res.status(403).json({ error: 'origin not allowed' })
}

export function originGuard(req: Request, res: Response, next: NextFunction): void {
  const origin = req.headers.origin
  if (!isAllowedOrigin(origin)) {
    reject(res)
    return
  }
  // 白名单来源回显 ACAO（浏览器需要）
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-App-Token')
    res.setHeader('Vary', 'Origin')
  }
  // v0.25.0（审查 M3）：预检请求不携带自定义头，必须放行，否则浏览器实际请求发不出去
  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return
  }
  if (tokenRequired()) {
    // v0.25.0（审查 M3）：纵深防御——此前仅 null Origin 校验 token，导致任何本机进程
    // 只要不发 Origin 头（curl / 脚本 / 第三方软件）即可免鉴权读写本地 API 并消耗用户额度。
    // 现对全部请求强制校验；Electron renderer 经 preload 注入 token，行为不变。
    if (req.headers['x-app-token'] !== process.env.SERVER_TOKEN) {
      reject(res)
      return
    }
  } else if (origin === 'null') {
    // P20（S1）：未配置 token 时，file:// 与恶意沙箱 iframe 的 Origin 同为 "null" 无法区分
    // v0.17.0（审查 M1）：fail-closed——一律拒绝（此前放行=打包态裸奔）
    reject(res)
    return
  }
  next()
}
