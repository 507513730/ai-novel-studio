// B3 存量书稿接续创作（D125）：外部书 → 工作书转换。
// 导入的连载稿（is_external=1，章节 status='imported'，只有正文）没有方向/framing/卷结构等管线产物，
// 无法被自动导演/方案流水线续写。此服务在导入书基础上反推出管线产物并激活为工作书。
// 复用方向：callLlmJson（extraction 路由）+ 现有 volume/novel 表；不新建一套提取逻辑（AGENTS #31）。
import { DatabaseSync } from 'node:sqlite'
import { callLlmJson } from './jsonSafe'

interface ChapterRow {
  id: number
  title: string
  content: string
}

/** 取导入书的全部章节（按 id 正序） */
function getChapters(db: DatabaseSync, novelId: number): ChapterRow[] {
  return db
    .prepare("SELECT id, title, content FROM chapter WHERE novel_id = ? AND content != '' ORDER BY id")
    .all(novelId) as unknown as ChapterRow[]
}

// ---------- 卷结构（LLM 识别卷边界） ----------
interface VolumeBoundary {
  startIndex: number
  title: string
}

export function parseVolumeBoundaries(obj: unknown, chapterCount: number): VolumeBoundary[] | null {
  const vols = (obj as { volumes?: unknown }).volumes
  if (!Array.isArray(vols) || vols.length === 0) return null
  const out: VolumeBoundary[] = []
  const seen = new Set<number>()
  for (const v of vols) {
    const r = v as Record<string, unknown>
    const si = Number(r.startIndex)
    const title = String(r.title ?? '').trim()
    // 1..chapterCount（含）；每个起点只认一次；起点必须递增
    if (!Number.isInteger(si) || si < 1 || si > chapterCount) return null
    if (seen.has(si)) return null
    if (out.length > 0 && si <= out[out.length - 1].startIndex) return null
    seen.add(si)
    out.push({ startIndex: si, title: title || `第 ${out.length + 1} 卷` })
  }
  // 首卷必须从第 1 章开始
  if (out[0].startIndex !== 1) return null
  return out
}

/**
 * LLM 从章节标题/首段识别卷边界，写 volume 行 + 每章挂 volume_id。
 * 返回卷数。失败抛错（交外层 500，保持幂等可重试）。
 */
export async function deriveVolumeStructure(db: DatabaseSync, novelId: number): Promise<number> {
  const chapters = getChapters(db, novelId)
  if (chapters.length === 0) throw new Error('没有可转的章节正文')
  const chapterCount = chapters.length
  // 附带编号 + 标题 + 首段，供识别卷边界（控制在 token 预算内）
  const list = chapters
    .map((c, i) => `${i + 1}. ${c.title || '（未命名）'}｜${c.content.slice(0, 60).replace(/\n/g, ' ')}`)
    .join('\n')

  const boundaries = await callLlmJson<VolumeBoundary[]>(
    db,
    'extraction',
    {
      novelId,
      messages: [
        {
          role: 'user',
          content: `你是小说结构分析师。以下是一部连载小说的章节清单（每行：序号. 标题｜首段）。请判断自然卷边界，输出 JSON：{"volumes": [{"startIndex": 序号, "title": "卷名"}]}。\n要求：startIndex 是每卷第一章的序号（首卷必须为 1），按顺序递增、不重不漏；卷数 1-6；标题贴合内容。\n\n【章节清单】\n${list}\n\n只输出 JSON。`
        }
      ],
      maxTokens: 2048
    },
    (obj) => parseVolumeBoundaries(obj, chapterCount),
    'volume-boundaries'
  )
  if (!boundaries || boundaries.length === 0) throw new Error('卷边界识别失败')

  // 每卷终点 = 下一卷起点 - 1（最后 = chapterCount）
  const toVol = new Map<number, number>() // chapterIndex(1-based) -> volumeIndex
  for (let v = 0; v < boundaries.length; v++) {
    const start = boundaries[v].startIndex
    const volIdx = v + 1
    let end = chapterCount
    if (v < boundaries.length - 1) end = boundaries[v + 1].startIndex - 1
    for (let i = start; i <= end; i++) toVol.set(i, volIdx)
  }

  db.exec('BEGIN')
  try {
    // 清空既有 volume（幂等重跑）
    db.prepare('DELETE FROM volume WHERE novel_id = ?').run(novelId)
    for (let v = 0; v < boundaries.length; v++) {
      const b = boundaries[v]
      db.prepare("INSERT INTO volume (novel_id, title, strategy_json, order_index) VALUES (?, ?, '{}', ?)").run(
        novelId,
        b.title,
        v
      )
    }
    const volRows = db.prepare('SELECT id, order_index FROM volume WHERE novel_id = ? ORDER BY order_index').all(novelId) as unknown as Array<{ id: number; order_index: number }>
    for (const [iStr, volIdx] of toVol.entries()) {
      const i = Number(iStr)
      const volRow = volRows[volIdx - 1]
      if (!volRow) continue
      const ch = chapters[i - 1]
      if (!ch) continue
      db.prepare('UPDATE chapter SET volume_id = ? WHERE id = ?').run(volRow.id, ch.id)
    }
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
  return boundaries.length
}

// ---------- 章节摘要回填（缺 summary/goal 的章从正文首段提取） ----------
export function backfillChapterSummaries(db: DatabaseSync, novelId: number): number {
  const rows = db
    .prepare(
      "SELECT id, title, content FROM chapter WHERE novel_id = ? AND content != '' AND (summary = '' OR goal_json = '{}') ORDER BY id"
    )
    .all(novelId) as unknown as Array<{ id: number; title: string; content: string }>
  let filled = 0
  for (const r of rows) {
    const first = r.content.trim().split(/\n+/).filter((l) => l.trim()).slice(0, 2).join(' ').slice(0, 120)
    db.prepare("UPDATE chapter SET summary = ?, goal_json = '{}' WHERE id = ?").run(first || `第...章`, r.id)
    filled++
  }
  return filled
}

// ---------- 方向 + framing（从正文推导） ----------
interface DerivedDirection {
  title: string
  sellingPoint: string
  genre: string
  coreSetting: string
  mainline: string
  first30: string
  readerFeeling: string
}

function parseDirection(obj: unknown): DerivedDirection | null {
  const d = obj as Record<string, unknown>
  if (!d.title || !d.sellingPoint || !d.genre) return null
  return {
    title: String(d.title),
    sellingPoint: String(d.sellingPoint),
    genre: String(d.genre),
    coreSetting: String(d.coreSetting ?? ''),
    mainline: String(d.mainline ?? ''),
    first30: String(d.first30 ?? ''),
    readerFeeling: String(d.readerFeeling ?? '')
  }
}

/** 从已有正文反推方向方案与 framing；写入 novel.direction_json + framing_json（幂等覆盖）。 */
export async function deriveDirectionAndFraming(db: DatabaseSync, novelId: number): Promise<void> {
  const novel = db.prepare('SELECT title, inspiration FROM novel WHERE id = ?').get(novelId) as
    | { title: string; inspiration: string }
    | undefined
  if (!novel) throw new Error('novel not found')
  const chapters = getChapters(db, novelId)
  const excerpt = chapters
    .slice(0, 15)
    .map((c) => `· ${c.title || '（未命名）'}：${c.content.slice(0, 200).replace(/\n/g, '')}`)
    .join('\n')
    .slice(0, 6000)

  const dir = await callLlmJson<DerivedDirection>(
    db,
    'extraction',
    {
      novelId,
      messages: [
        {
          role: 'user',
          content: `你是小说编辑。根据下列已写内容，为这部小说提炼方向方案 JSON：{"title": "方案名", "sellingPoint": "卖点", "genre": "流派", "coreSetting": "核心设定", "mainline": "主线", "first30": "前30章承诺", "readerFeeling": "目标读者感受"}。\n\n【已写内容摘录】\n${excerpt}\n\n只输出 JSON。`
        }
      ],
      maxTokens: 2048
    },
    (obj) => parseDirection(obj),
    'derived-direction'
  )

  const framing = await callLlmJson<Record<string, unknown>>(
    db,
    'extraction',
    {
      novelId,
      messages: [
        {
          role: 'user',
          content: `你是小说编辑。根据已写内容提炼小说梗概 JSON：{"title": "书名", "summary": "故事梗概（80-150字）", "sellingPoint": "卖点", "readerFeeling": "目标读者感受", "first30Promise": "前30章承诺"}。\n\n【已写内容摘录】\n${excerpt}\n\n只输出 JSON。`
        }
      ],
      maxTokens: 2048
    },
    (obj) => (obj && typeof obj === 'object' ? (obj as Record<string, unknown>) : null),
    'derived-framing'
  )

  db.exec('BEGIN')
  try {
    db.prepare("UPDATE novel SET direction_json = ?, status = 'framing', updated_at = datetime('now') WHERE id = ?").run(
      JSON.stringify([{ id: 'converted', scheme: dir }]),
      novelId
    )
    db.prepare("UPDATE novel SET framing_json = ?, updated_at = datetime('now') WHERE id = ?").run(
      JSON.stringify(framing ?? { title: novel.title, summary: '', sellingPoint: dir.sellingPoint }),
      novelId
    )
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}

// ---------- 激活为工作书（翻转标记 + 状态） ----------
export function activateAsWorkingBook(db: DatabaseSync, novelId: number): void {
  db.exec('BEGIN')
  try {
    db.prepare("UPDATE novel SET is_external = 0, status = 'draft', updated_at = datetime('now') WHERE id = ?").run(novelId)
    // imported 章节 → written（可被整书直塞 / 续写前文纳入）
    db.prepare("UPDATE chapter SET status = 'written', updated_at = datetime('now') WHERE novel_id = ? AND status = 'imported'").run(novelId)
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}
