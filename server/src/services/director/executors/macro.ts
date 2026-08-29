// 导演阶段执行器：macro（故事宏观规划，合并进 framing_json）
import { DatabaseSync } from 'node:sqlite'
import { callLlmJson } from '../../jsonSafe'
import { injectGuidance } from '../../settingBrief'
import { generateMacroPrompt } from '../../planner'
import { loadNovel, type StageContext } from './shared'

export async function runMacroStage(db: DatabaseSync, novelId: number, _ctx: StageContext): Promise<void> {
  const novel = loadNovel(db, novelId)
  const macro = await callLlmJson<Record<string, unknown>>(
    db,
    'extraction',
    {
      novelId,
      messages: [{ role: 'user', content: injectGuidance(db, novelId, generateMacroPrompt(novel.title, novel.framing_json)) }],
      maxTokens: 2048
    },
    (obj) => (obj && typeof obj === 'object' ? (obj as Record<string, unknown>) : null),
    'director-macro'
  )
  const current = JSON.parse(novel.framing_json || '{}') as Record<string, unknown>
  db.prepare("UPDATE novel SET framing_json = ?, updated_at = datetime('now') WHERE id = ?").run(
    JSON.stringify({ ...current, macro }),
    novelId
  )
}
