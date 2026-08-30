// B1 词条触发注入（D124，NovelAI Lorebook 机制）：内容命中关键词 → 自动注入该词条设定。
// 与相似度检索（getKnowledgeRetrieval）并存：相似度按相关性召回（超窗兜底），触发式切中关键词即注入（更前置/更精准）。
// 数据源 = kb_doc.keywords（逗号分隔触发词）；排除 status='direct'（直塞资料已走冻结区，避免双份进提示词）。
import { DatabaseSync } from 'node:sqlite'

export interface KbTriggerDoc {
  id: number
  title: string
  content: string
  keywords: string
}

/** 归一化触发词：按中英文逗号/顿号切分、去空白，return 非空去重列表 */
export function parseKeywords(raw: string): string[] {
  const terms = raw
    .split(/[,،，、;；]/)
    .map((s) => s.trim())
    .filter(Boolean)
  // 去重（保序）
  const seen = new Set<string>()
  const out: string[] = []
  for (const t of terms) {
    const k = t.toLowerCase()
    if (!seen.has(k)) {
      seen.add(k)
      out.push(t)
    }
  }
  return out
}

/**
 * 构建「词条触发注入」区块：用 queryText（= 正在写的正文前文 + 本章标题/摘要）逐条命中 kb_doc.keywords。
 * 命中 <= MAX_HITS 条（按触发顺序去重），无命中返回 null。每条注入词条标题 + 内容片段。
 */
const MAX_HITS = 3
const SNIPPET = 400

export function getKbTriggerInjection(db: DatabaseSync, novelId: number, queryText: string): string | null {
  const q = queryText.trim()
  if (!q) return null
  const qLower = q.toLowerCase()

  const docs = db
    .prepare(
      "SELECT id, title, content, keywords FROM kb_doc WHERE novel_id IN (0, ?) AND content != '' AND status != 'direct' AND keywords != '' ORDER BY id"
    )
    .all(novelId) as unknown as KbTriggerDoc[]
  if (docs.length === 0) return null

  const hits: KbTriggerDoc[] = []
  const used = new Set<string>()
  for (const d of docs) {
    const terms = parseKeywords(d.keywords)
    if (terms.length === 0) continue
    const matched = terms.find((t) => {
      const k = t.toLowerCase()
      if (used.has(k)) return false
      return qLower.includes(k)
    })
    if (matched) {
      used.add(matched.toLowerCase())
      hits.push(d)
      if (hits.length >= MAX_HITS) break
    }
  }
  if (hits.length === 0) return null

  const parts = hits.map((d) => `- 《${d.title}》：${d.content.slice(0, SNIPPET)}`)
  return `【词条触发（命中关键词）】\n${parts.join('\n')}`
}
