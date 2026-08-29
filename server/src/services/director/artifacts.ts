// 导演阶段产物判定（重构计划 R4.2 / spec §3.3）：重启幂等的事实源。
// 完成与否只看实际落库产物（world/character/volume/chapter 行与 JSON 字段），
// 不单信 checkpoint 状态——产物在但 checkpoint 未推进时，恢复跳过已完成模型调用。
import { DatabaseSync } from 'node:sqlite'
import { STAGE_ORDER, type DirectorStage } from './stages'

export function isStageDone(db: DatabaseSync, novelId: number, stage: DirectorStage): boolean {
  switch (stage) {
    case 'inspiration':
      return true // 创建书即完成
    case 'directions': {
      const row = db.prepare('SELECT direction_json FROM novel WHERE id = ?').get(novelId) as
        | { direction_json: string }
        | undefined
      const dirs = JSON.parse(row?.direction_json ?? '[]')
      return Array.isArray(dirs) && dirs.length >= 2
    }
    case 'framing': {
      const row = db.prepare('SELECT framing_json FROM novel WHERE id = ?').get(novelId) as
        | { framing_json: string }
        | undefined
      const f = JSON.parse(row?.framing_json ?? '{}') as Record<string, unknown>
      return Boolean(f.summary)
    }
    case 'macro': {
      const row = db.prepare('SELECT framing_json FROM novel WHERE id = ?').get(novelId) as
        | { framing_json: string }
        | undefined
      const f = JSON.parse(row?.framing_json ?? '{}') as { macro?: Record<string, unknown> }
      return Boolean(f.macro?.storyEngine)
    }
    case 'world': {
      const row = db.prepare('SELECT manual_json FROM world WHERE novel_id = ?').get(novelId) as
        | { manual_json: string }
        | undefined
      const m = JSON.parse(row?.manual_json ?? '{}')
      return Object.keys(m).length >= 2
    }
    case 'characters': {
      const row = db.prepare('SELECT COUNT(*) AS c FROM character WHERE novel_id = ?').get(novelId) as {
        c: number
      }
      return row.c >= 5
    }
    case 'volumes': {
      const row = db.prepare('SELECT COUNT(*) AS c FROM volume WHERE novel_id = ?').get(novelId) as {
        c: number
      }
      return row.c >= 2
    }
    case 'beats': {
      const row = db.prepare('SELECT COUNT(*) AS c FROM beat b JOIN volume v ON v.id = b.volume_id WHERE v.novel_id = ?').get(novelId) as {
        c: number
      }
      return row.c >= 1
    }
    case 'chapters': {
      const row = db.prepare('SELECT COUNT(*) AS c FROM chapter WHERE novel_id = ?').get(novelId) as {
        c: number
      }
      return row.c >= 5
    }
    case 'refine': {
      // P2.1 修复 #3：所有 planned 章节都必须有 purpose 才算完成
      const row = db
        .prepare(
          "SELECT COUNT(*) AS c FROM chapter WHERE novel_id = ? AND content = '' AND status = 'planned' AND (goal_json = '{}' OR goal_json IS NULL OR goal_json NOT LIKE '%purpose%')"
        )
        .get(novelId) as { c: number }
      return row.c === 0
    }
    case 'ready':
      return STAGE_ORDER.filter((s) => s !== 'ready' && s !== 'inspiration').every((s) =>
        isStageDone(db, novelId, s)
      )
  }
}
