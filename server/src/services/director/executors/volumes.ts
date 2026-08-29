// 导演阶段执行器：volumes（卷战略，含卷幂等去重）
import { DatabaseSync } from 'node:sqlite'
import { callLlmJson } from '../../jsonSafe'
import { injectGuidance } from '../../settingBrief'
import { generateVolumesPrompt, parseVolumes } from '../../planner'
import { loadNovel, type StageContext } from './shared'

export async function runVolumesStage(db: DatabaseSync, novelId: number, ctx: StageContext): Promise<void> {
  const novel = loadNovel(db, novelId)
  const characters = db
    .prepare("SELECT name FROM character WHERE novel_id = ? LIMIT 12")
    .all(novelId) as Array<{ name: string }>
  const volumes = await callLlmJson<
    Array<{ title: string; theme: string; coreConflict: string; keyEvents: string[]; endingHook: string }>
  >(
    db,
    'extraction',
    {
      novelId,
      messages: [
        {
          role: 'user',
          content: injectGuidance(db, novelId, generateVolumesPrompt(
            novel.title,
            novel.framing_json,
            characters.map((c) => c.name).join('；'),
            ctx.chaptersPerVolume
          ))
        }
      ],
      maxTokens: 4096
    },
    parseVolumes,
    'director-volumes'
  )
  // P20（M3）：卷幂等去重（按 novel+title 跳过重跑产物）
  const existingVols = new Set(
    (db.prepare('SELECT title FROM volume WHERE novel_id = ?').all(novelId) as Array<{ title: string }>).map(
      (r) => r.title
    )
  )
  db.exec('BEGIN')
  try {
    for (let i = 0; i < volumes.length; i++) {
      if (existingVols.has(volumes[i].title)) continue
      existingVols.add(volumes[i].title)
      db.prepare(
        'INSERT INTO volume (novel_id, title, strategy_json, skeleton_json, order_index) VALUES (?, ?, ?, ?, ?)'
      ).run(
        novelId,
        volumes[i].title,
        JSON.stringify({
          theme: volumes[i].theme,
          coreConflict: volumes[i].coreConflict,
          chaptersPerVolume: ctx.chaptersPerVolume
        }),
        JSON.stringify({ keyEvents: volumes[i].keyEvents, endingHook: volumes[i].endingHook }),
        i
      )
    }
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}
