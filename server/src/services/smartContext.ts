import { DatabaseSync } from 'node:sqlite'
import { callLlmJson } from './jsonSafe'

// ============================================================
// C1 智能上下文自动摘要（学习 FeelFish smartContext）
// 每章回灌后自动更新"书级摘要"四段（风格/角色/世界观/剧情脉络），
// 存 novel.framing_json.smartContext，注入生成上下文替换前文回顾
// ============================================================

export interface SmartContext {
  style: string
  characters: string
  world: string
  plot: string
  version: number
  // v0.9.0（审查 D/A）：增量更新门槛字段——updatedAt（最近更新时间）/ chapterCount（更新时的已写章数）
  updatedAt?: string
  chapterCount?: number
}

// v0.9.0（审查 D）：增量更新门槛——距上次 ≥1 小时 或 新写 ≥5 章 才重新生成（先到先触发）
const MIN_INTERVAL_MS = 60 * 60 * 1000
const MIN_NEW_CHAPTERS = 5

const PROMPT = `你是小说的智能上下文维护员。基于全书已写章节与既有摘要，生成或更新书级摘要，输出 JSON：
{"style": "核心风格与基调（叙事风格/语言特点/情感基调，80-150字）", "characters": "人物信息（主角识别+各人物性格动机/关键背景/人物弧光变化，100-200字）", "world": "核心世界观与设定（故事类型/关键规则/时代地点，60-120字）", "plot": "当前故事脉络（主线+分支简述/关键事件/未回收伏笔，100-200字）"}
要求：保留角色原名；记录未回收伏笔与悬念；删除与后续创作无关的细节；不编造不存在的信息；若已有既有摘要，在此基础上增量更新（标注新章节的关键变化）。`

export async function updateSmartContext(
  db: DatabaseSync,
  novelId: number,
  opts: { force?: boolean } = {}
): Promise<SmartContext | null> {
  const novel = db.prepare('SELECT framing_json FROM novel WHERE id = ?').get(novelId) as
    | { framing_json: string }
    | undefined
  if (!novel) throw new Error('novel not found')

  const framing = JSON.parse(novel.framing_json || '{}') as Record<string, unknown>
  const existing = (framing.smartContext ?? null) as SmartContext | null
  if (existing && !opts.force) {
    // v0.9.0（审查 D/A）：增量更新门槛——此前"已有摘要即永久冻结"（增量分支是死代码，
    // 调用方从不传 force）；改为按时间/新章数门槛周期性增量更新，保持书级摘要随剧情推进新鲜
    const elapsed = Date.now() - new Date(existing.updatedAt ?? 0).getTime()
    const written = db
      .prepare("SELECT COUNT(*) AS c FROM chapter WHERE novel_id = ? AND content != ''")
      .get(novelId) as { c: number }
    const newChapters = written.c - (existing.chapterCount ?? written.c)
    if (elapsed < MIN_INTERVAL_MS && newChapters < MIN_NEW_CHAPTERS) {
      return existing
    }
  }

  // 取已写章节（最多 15 章，控制 token）
  const chapters = db
    .prepare(
      "SELECT title, content FROM chapter WHERE novel_id = ? AND content != '' ORDER BY id DESC LIMIT 15"
    )
    .all(novelId) as Array<{ title: string; content: string }>
  if (chapters.length === 0) return null
  const texts = chapters
    .reverse()
    .map((c) => `【${c.title}】\n${c.content.slice(0, 1200)}`)
    .join('\n\n')

  const result = await callLlmJson<SmartContext>(
    db,
    'extraction',
    {
      novelId,
      messages: [
        {
          role: 'user',
          content: `${PROMPT}\n\n${existing ? `【既有摘要】\n${JSON.stringify(existing)}\n` : ''}【已写章节】\n${texts}\n\n只输出 JSON。`
        }
      ],
      maxTokens: 4096
    },
    (obj) => {
      const r = obj as Record<string, unknown>
      if (typeof r.style !== 'string' || typeof r.plot !== 'string') return null
      const written = (
        db.prepare("SELECT COUNT(*) AS c FROM chapter WHERE novel_id = ? AND content != ''").get(novelId) as { c: number }
      ).c
      return {
        style: String(r.style),
        characters: String(r.characters ?? ''),
        world: String(r.world ?? ''),
        plot: String(r.plot),
        version: (existing?.version ?? 0) + 1,
        // v0.9.0（审查 D/A）：落库时间戳 + 章数（增量门槛判定依据）
        updatedAt: new Date().toISOString(),
        chapterCount: written
      }
    },
    'smart-context'
  )

  // 落库（novel.framing_json.smartContext）
  const nextFraming = { ...framing, smartContext: result }
  db.prepare("UPDATE novel SET framing_json = ?, updated_at = datetime('now') WHERE id = ?").run(
    JSON.stringify(nextFraming),
    novelId
  )
  return result
}

/**
 * C2：生成上下文注入（替换前文回顾的精炼版）
 */
export function smartContextText(ctx: SmartContext): string {
  return [
    '【书级智能上下文（必须遵守）】',
    `风格：${ctx.style}`,
    `人物：${ctx.characters}`,
    `世界观：${ctx.world}`,
    `剧情脉络：${ctx.plot}`
  ].join('\n')
}
