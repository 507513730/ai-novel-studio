// CodeQL 修复（2026-08-30）：Incomplete multi-character sanitization。
// 用正则 `/<[^>]+>/g` 剥离 HTML 标签被 CodeQL 判定为"不完整多字符清洗"（嵌套/畸形标签可残留）。
// 改为有状态逐字符扫描：凡 `<` 与 `>` 之间的内容一律丢弃，不依赖正则，可证明完整（无 `<` 残留风险）。
// 用途：Wikipedia 摘要（searchmatch 高亮 span）与 EPUB 文本去标签。

export function stripHtmlTags(input: string): string {
  const s = input ?? ''
  let out = ''
  let inTag = false
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (ch === '<') {
      inTag = true
    } else if (ch === '>') {
      inTag = false
    } else if (!inTag) {
      out += ch
    }
  }
  return out
}
