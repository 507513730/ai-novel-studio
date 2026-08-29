// 导演阶段执行器：directions（方向生成，2 套 + 标题组）
import { DatabaseSync } from 'node:sqlite'
import { callLlmJson } from '../../jsonSafe'
import { injectGuidance } from '../../settingBrief'
import { generateDirectionsPrompt, parseDirections } from '../../planner'
import type { StageContext } from './shared'

export async function runDirectionsStage(db: DatabaseSync, novelId: number, _ctx: StageContext): Promise<void> {
  const novel = db.prepare('SELECT inspiration FROM novel WHERE id = ?').get(novelId) as
    | { inspiration: string }
    | undefined
  if (!novel) throw new Error('novel not found')

  const dirs = await callLlmJson<Array<{ id: string; scheme: Record<string, unknown> }>>(
    db,
    'extraction',
    {
      novelId,
      messages: [{ role: 'user', content: injectGuidance(db, novelId, generateDirectionsPrompt(novel.inspiration)) }],
      maxTokens: 4096
    },
    parseDirections,
    'director-directions'
  )
  db.prepare(
    "UPDATE novel SET direction_json = ?, status = 'directions', updated_at = datetime('now') WHERE id = ?"
  ).run(JSON.stringify(dirs), novelId)
}
