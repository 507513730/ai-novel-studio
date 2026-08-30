// B2 地基（D124）：已写片段检索——把作者已写正文入检索库，便于相似片段 as few-shot 写法参考。
// 现阶段作为"地基"：把本章之前已写章节按相关性检索注入（标为【已写章节参考】），
// B2 完整版（作者正文入库 → 生成时检索相似片段作写法示例）在其上扩展。
// 复用 TfidfRetriever（零依赖）；只取当前章节之前的已写章节，避免把"前文回顾"重复成整章直塞。
import { DatabaseSync } from 'node:sqlite'
import { TfidfRetriever } from '../retrieval'

const RECENT_CAP = 12 // 只索引最近 N 章已写正文，控索引成本（前文回顾已覆盖全书摘要）
const TOP_K = 2
const SNIPPET = 300

export function getPriorChapterRetrieval(db: DatabaseSync, novelId: number, chapterId: number, query: string): string | null {
  const q = query.trim()
  if (!q) return null

  const rows = db
    .prepare(
      `SELECT id, title, content FROM chapter
       WHERE novel_id = ? AND id < ? AND content != '' AND status IN ('written','reviewed','done')
       ORDER BY id DESC LIMIT ?`
    )
    .all(novelId, chapterId, RECENT_CAP) as Array<{ id: number; title: string; content: string }>
  if (rows.length === 0) return null
  // 逆序排序转正序（最近 N 章中按时间正序，便于连续性）
  const docs = rows.sort((a, b) => a.id - b.id)

  const retriever = new TfidfRetriever()
  retriever.indexNow(docs.map((d) => ({ id: d.id, title: d.title, content: d.content })))
  const hits = retriever.searchNow(q, TOP_K)
  if (hits.length === 0) return null

  const parts = hits.map((h) => `- 《${h.title}》（写法参考）：${h.content.slice(0, SNIPPET)}`)
  return `【已写章节参考（相似片段）】\n${parts.join('\n')}`
}
