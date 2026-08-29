// 导演阶段执行器共享设施（重构计划 R4.2 / spec §3.3）。
import { DatabaseSync } from 'node:sqlite'

export interface StageContext {
  chaptersPerVolume: number
}

export interface NovelRow {
  inspiration: string
  framing_json: string
  title: string
}

export function loadNovel(db: DatabaseSync, novelId: number): NovelRow {
  const novel = db.prepare('SELECT inspiration, framing_json, title FROM novel WHERE id = ?').get(novelId) as
    | NovelRow
    | undefined
  if (!novel) throw new Error('novel not found')
  return novel
}

// P2.1 🟡7：取前一章的结尾钩子（章间衔接）
export function getPrevChapterEnding(db: DatabaseSync, novelId: number, currentChapterId: number): string {
  const rows = db
    .prepare('SELECT id, title, goal_json FROM chapter WHERE novel_id = ? AND id < ? ORDER BY id DESC LIMIT 1')
    .all(novelId, currentChapterId) as Array<{ id: number; title: string; goal_json: string }>
  if (rows.length === 0) return ''
  const goal = JSON.parse(rows[0].goal_json || '{}') as { ending?: string }
  return goal.ending ? `《${rows[0].title}》结尾钩子：${goal.ending}` : ''
}
