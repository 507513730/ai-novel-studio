// 导演阶段执行器：framing（项目设定 + 自动流派映射）
import { DatabaseSync } from 'node:sqlite'
import { callLlmJson } from '../../jsonSafe'
import { injectGuidance } from '../../settingBrief'
import { generateFramingPrompt } from '../../planner'
import { loadNovel, type StageContext } from './shared'

export async function runFramingStage(db: DatabaseSync, novelId: number, _ctx: StageContext): Promise<void> {
  const novel = loadNovel(db, novelId)
  const row = db.prepare('SELECT direction_json FROM novel WHERE id = ?').get(novelId) as {
    direction_json: string
  }
  const dirs = JSON.parse(row.direction_json ?? '[]') as Array<{ scheme?: Record<string, unknown> }>
  const framing = await callLlmJson<Record<string, unknown>>(
    db,
    'extraction',
    {
      novelId,
      messages: [
        { role: 'user', content: injectGuidance(db, novelId, generateFramingPrompt(novel.inspiration, dirs[0]?.scheme ?? {})) }
      ],
      maxTokens: 2048
    },
    (obj) => (obj && typeof obj === 'object' ? (obj as Record<string, unknown>) : null),
    'director-framing'
  )
  // P2.1 🟡5：从方向方案自动设置流派（映射到 genre_asset 预设）
  const genreFromDirection = String(dirs[0]?.scheme?.genre ?? '').trim()
  const presetGenres = ['都市', '玄幻', '仙侠', '科幻', '悬疑', '言情']
  const matchedGenre = presetGenres.find((g) => genreFromDirection.includes(g)) ?? genreFromDirection
  db.prepare(
    "UPDATE novel SET title = ?, framing_json = ?, genre = ?, status = 'framed', updated_at = datetime('now') WHERE id = ?"
  ).run(
    (dirs[0]?.scheme?.title as string) ?? novel.title ?? '未命名小说',
    // 写书修复：保留既有字段（settingBrief 等）——此前整体覆盖导致设定简报丢失
    JSON.stringify({ ...(JSON.parse(novel.framing_json || '{}') as Record<string, unknown>), ...framing }),
    matchedGenre,
    novelId
  )
}
