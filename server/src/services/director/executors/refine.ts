// 导演阶段执行器：refine（全部 planned 章节分批细化，每批 8 章 + 章间衔接钩子）
import { DatabaseSync } from 'node:sqlite'
import { callLlmJson } from '../../jsonSafe'
import { injectGuidance } from '../../settingBrief'
import { generateRefinePrompt, parseRefine } from '../../planner'
import { getPrevChapterEnding, type StageContext } from './shared'

export async function runRefineStage(db: DatabaseSync, novelId: number, _ctx: StageContext): Promise<void> {
  // P2.1 修复 #3：全部 planned 章节分批细化（每批 8 章），而非只前 8 章
  const total = db
    .prepare(
      "SELECT COUNT(*) AS c FROM chapter WHERE novel_id = ? AND content = '' AND status = 'planned'"
    )
    .get(novelId) as { c: number }
  const BATCH = 8
  for (let offset = 0; offset < total.c; offset += BATCH) {
    const chapters = db
      .prepare(
        "SELECT id, title, summary, goal_json FROM chapter WHERE novel_id = ? AND content = '' AND status = 'planned' ORDER BY id LIMIT ? OFFSET ?"
      )
      .all(novelId, BATCH, offset) as Array<{ id: number; title: string; summary: string; goal_json: string }>
    for (const ch of chapters) {
      // P2.1 🟡7b：章间衔接（前一章结尾钩子）
      const prevEnding = getPrevChapterEnding(db, novelId, ch.id)
      const refined = await callLlmJson<Record<string, unknown>>(
        db,
        'extraction',
        {
          novelId,
          messages: [
            {
              role: 'user',
              content: injectGuidance(db, novelId, generateRefinePrompt(ch.title, ch.summary, ch.goal_json, prevEnding))
            }
          ],
          maxTokens: 2048
        },
        parseRefine,
        'director-refine'
      )
      db.prepare("UPDATE chapter SET goal_json = ?, updated_at = datetime('now') WHERE id = ?").run(
        JSON.stringify(refined),
        ch.id
      )
    }
  }
}
