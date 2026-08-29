// 导演阶段执行器：beats（逐卷节奏板，含节拍幂等去重）
import { DatabaseSync } from 'node:sqlite'
import { callLlmJson } from '../../jsonSafe'
import { injectGuidance } from '../../settingBrief'
import { generateBeatsPrompt, parseBeats, getGenreTemplate } from '../../planner'
import type { StageContext } from './shared'

export async function runBeatsStage(db: DatabaseSync, novelId: number, _ctx: StageContext): Promise<void> {
  const vols = db
    .prepare('SELECT id, title, strategy_json, skeleton_json FROM volume WHERE novel_id = ? ORDER BY order_index')
    .all(novelId) as Array<{ id: number; title: string; strategy_json: string; skeleton_json: string }>
  for (const v of vols) {
    const strategy = JSON.parse(v.strategy_json) as { chaptersPerVolume: number }
    const genreTemplate = getGenreTemplate(db, novelId) // P2.1 🟡5
    const beats = await callLlmJson<
      Array<{ title: string; purpose: string; emotionCurve: string; scenes: string[] }>
    >(
      db,
      'extraction',
      {
        novelId,
        messages: [
          {
            role: 'user',
            content: injectGuidance(db, novelId, generateBeatsPrompt(
              v.title,
              v.strategy_json,
              v.skeleton_json,
              strategy.chaptersPerVolume ?? 20,
              genreTemplate
            ))
          }
        ],
        maxTokens: 4096
      },
      parseBeats,
      'director-beats'
    )
    // P20（M3）：节拍幂等去重（按 volume+title 跳过重跑产物）
    const existingBeats = new Set(
      (
        db.prepare('SELECT title FROM beat WHERE volume_id = ?').all(v.id) as Array<{ title: string }>
      ).map((r) => r.title)
    )
    db.exec('BEGIN')
    try {
      for (let i = 0; i < beats.length; i++) {
        if (existingBeats.has(beats[i].title)) continue
        existingBeats.add(beats[i].title)
        db.prepare('INSERT INTO beat (volume_id, title, summary, order_index) VALUES (?, ?, ?, ?)').run(
          v.id,
          beats[i].title,
          JSON.stringify({
            purpose: beats[i].purpose,
            emotionCurve: beats[i].emotionCurve,
            scenes: beats[i].scenes
          }),
          i
        )
      }
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
  }
}
