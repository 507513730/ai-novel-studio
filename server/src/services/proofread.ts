// v0.24.4（A4 轻量校对）：确定性本地检查（零 token）——错别字/语义部分由 extraction 单次调用补
export interface LocalIssue {
  type: 'repeat' | 'mojibake'
  location: string
  problem: string
  suggestion: string
}

const REPEAT_RE = /([\u4e00-\u9fff]{1,3}\s*)\1+/g

/** 重复词检测：相邻 1-3 字连续重复（的的/哈哈哈/不断不断）；叠词（AA 型如"慢慢"）豁免 */
export function detectRepeatWords(content: string): LocalIssue[] {
  const out: LocalIssue[] = []
  const seen = new Set<string>()
  let m: RegExpExecArray | null
  REPEAT_RE.lastIndex = 0
  while ((m = REPEAT_RE.exec(content)) !== null) {
    const token = m[1].trim()
    // AA 型叠词豁免（慢慢/轻轻/渐渐）；AAA 及以上仍报
    if (!token || token.length === 0 || (token.length === 1 && m[0].replace(/\s/g, '').length <= 2)) continue
    if (seen.has(token)) continue
    seen.add(token)
    out.push({
      type: 'repeat',
      location: m[0].slice(0, 30),
      problem: `重复用词「${token}」连续出现（${Math.floor(m[0].length / Math.max(1, m[1].trim().length))} 次）`,
      suggestion: '删除重复，保留一次'
    })
  }
  return out
}

/** 乱码检测：4+ 连续 ?（半/全角）/ 替换字符� / 连续空白段落 */
export function detectMojibake(content: string): LocalIssue[] {
  const out: LocalIssue[] = []
  const moji = /\?{4,}|\uFF1F{4,}|\uFFFD+/.exec(content)
  if (moji) {
    out.push({ type: 'mojibake', location: moji[0].slice(0, 30), problem: '疑似编码损坏字符', suggestion: '检查并修正该段文本' })
  }
  return out
}

export function detectLocalIssues(content: string): LocalIssue[] {
  return [...detectRepeatWords(content), ...detectMojibake(content)]
}
