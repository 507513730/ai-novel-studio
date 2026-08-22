// v0.24.2（F3 版本 diff）：行级 Myers diff（零依赖纯 TS）——版本历史「对比当前」
// 中文正文按 \n 拆行，行段级差异对人可读；先修剪公共前后缀（版本差异通常集中在中间），
// 中间段超限时退化（防 O(ND) 内存爆炸，大文本只做逐行对照）

export type DiffLineType = 'same' | 'add' | 'del'

export interface DiffLine {
  type: DiffLineType
  text: string
}

export interface DiffResult {
  lines: DiffLine[]
  added: number
  removed: number
  degraded: boolean
}

/** Myers O(ND) 差异算法（在修剪后的中间段上运行；D = 编辑距离） */
function myers(a: string[], b: string[]): DiffLine[] {
  const n = a.length
  const m = b.length
  const max = n + m
  let v = new Map<number, number>()
  const trace: Array<Map<number, number>> = []
  let dFinal = -1

  outer: for (let d = 0; d <= max; d++) {
    // trace 记录每层开始时的 v（即 d-1 层结果，回溯用）
    trace.push(v)
    const next = new Map<number, number>()
    for (let k = -d; k <= d; k += 2) {
      let x: number
      if (k === -d || (k !== d && (v.get(k - 1) ?? -1) < (v.get(k + 1) ?? -1))) {
        x = v.get(k + 1) ?? 0 // down（插入）
      } else {
        x = (v.get(k - 1) ?? 0) + 1 // right（删除）
      }
      let y = x - k
      while (x < n && y < m && a[x] === b[y]) {
        x++
        y++
      }
      next.set(k, x)
      if (x >= n && y >= m) {
        dFinal = d
        break outer
      }
    }
    v = next
  }
  if (dFinal < 0) {
    // 理论不可达（d 最多 n+m 必达终点）；兜底返回全删+全增
    return [
      ...a.map((t) => ({ type: 'del' as const, text: t })),
      ...b.map((t) => ({ type: 'add' as const, text: t }))
    ]
  }

  // 回溯：从终点沿路径向起点走，逆序收集编辑序列
  const out: DiffLine[] = []
  let x = n
  let y = m
  for (let d = dFinal; d >= 0; d--) {
    const vd = trace[d]!
    const k = x - y
    let prevK: number
    if (k === -d || (k !== d && (vd.get(k - 1) ?? -1) < (vd.get(k + 1) ?? -1))) {
      prevK = k + 1 // 上一步为 down（插入）
    } else {
      prevK = k - 1 // 上一步为 right（删除）
    }
    const prevX = vd.get(prevK) ?? 0
    const prevY = prevX - prevK
    while (x > prevX && y > prevY) {
      out.push({ type: 'same', text: a[x - 1]! })
      x--
      y--
    }
    if (d === 0) break
    if (x === prevX) {
      out.push({ type: 'add', text: b[y - 1]! })
      y = prevY
    } else {
      out.push({ type: 'del', text: a[x - 1]! })
      x = prevX
    }
  }
  out.reverse()
  return out
}

export function diffLines(oldText: string, newText: string, opts: { maxMiddleLines?: number } = {}): DiffResult {
  const maxMiddle = opts.maxMiddleLines ?? 4000
  // 空文本视为 0 行（''.split('\n') 返回 ['']——会造成幽灵空行增删）
  const a = oldText === '' ? [] : oldText.split('\n')
  const b = newText === '' ? [] : newText.split('\n')

  // 公共前后缀修剪（版本差异通常集中在中间）
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--
    endB--
  }
  const prefix: DiffLine[] = a.slice(0, start).map((t) => ({ type: 'same', text: t }))
  const suffix: DiffLine[] = a.slice(endA).map((t) => ({ type: 'same', text: t }))
  const aMid = a.slice(start, endA)
  const bMid = b.slice(start, endB)

  const degraded = aMid.length + bMid.length > maxMiddle
  const middle: DiffLine[] = degraded
    ? [
        ...aMid.map((t) => ({ type: 'del' as const, text: t })),
        ...bMid.map((t) => ({ type: 'add' as const, text: t }))
      ]
    : myers(aMid, bMid)

  const lines = [...prefix, ...middle, ...suffix]
  return {
    lines,
    added: lines.filter((l) => l.type === 'add').length,
    removed: lines.filter((l) => l.type === 'del').length,
    degraded
  }
}
