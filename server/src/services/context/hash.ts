// 上下文域纯函数（重构计划 R6.1）：hash 与 token 估算。
// 冻结区 hash 用 FNV-1a（codePointAt 覆盖 emoji/补充平面——charCodeAt 取半代理会碰撞）。
export function hashOf(s: string): string {
  let h = 2166136261
  for (const ch of s) {
    h ^= ch.codePointAt(0) ?? 0
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(36)
}

export function truncate(text: string, maxChars: number): string {
  if (maxChars <= 0) return ''
  if (text.length <= maxChars) return text
  return text.slice(0, maxChars) + '…[已截断]'
}

export function estimateTokens(text: string): number {
  // 中文为主：1 汉字 ≈ 1.2 token；其余字符 ≈ 0.4 token
  const cjk = (text.match(/[\u4e00-\u9fff]/g) ?? []).length
  const other = text.length - cjk
  return Math.ceil(cjk * 1.2 + other * 0.4)
}
