// P11-1.1：世界数据值渲染（manual/map 的值可能是对象/数组——递归渲染，防 React #31）
export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

// 纯逻辑：把任意世界值展平为 {label, text} 列表（供渲染 + 单测）
export function flattenWorldValue(
  v: unknown,
  key?: string,
  depth = 0
): Array<{ label: string; text: string; depth: number }> {
  const out: Array<{ label: string; text: string; depth: number }> = []
  if (typeof v === 'string') {
    out.push({ label: key ?? '', text: v, depth })
  } else if (typeof v === 'number' || typeof v === 'boolean') {
    out.push({ label: key ?? '', text: String(v), depth })
  } else if (Array.isArray(v)) {
    if (key) out.push({ label: key, text: '', depth })
    for (const item of v) {
      out.push(...flattenWorldValue(item, undefined, depth + 1))
    }
  } else if (isPlainObject(v)) {
    if (key) out.push({ label: key, text: '', depth })
    for (const [k, val] of Object.entries(v)) {
      out.push(...flattenWorldValue(val, k, depth + 1))
    }
  } else if (v === null || v === undefined) {
    out.push({ label: key ?? '', text: '—', depth })
  }
  return out
}
