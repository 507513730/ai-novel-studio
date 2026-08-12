// v0.12.0（批D/P31）：卷章定位——方案步骤感知"章在卷中的角色"
// 设计（本地设计，D86）：整本生产逐章复用方案时，步骤 prompt 注入卷战略/节拍/卷内位置，
// 让方案步骤（大纲/正文片段等）按卷章角色调整创作方向（开篇铺垫 / 推进 / 收尾钩子）

import { DatabaseSync } from 'node:sqlite'

export interface ChapterPosition {
  volumeTitle: string
  volumeIndex: number
  chapterIndexInVolume: number
  chapterCountInVolume: number
  beatTitle: string
  beatSummary: string
  role: string // 卷内角色：开篇 / 推进 / 收尾 / （无卷数据时 '未知'）
}

export function getChapterPosition(db: DatabaseSync, novelId: number, chapterId: number): ChapterPosition | null {
  const chapter = db
    .prepare('SELECT volume_id, beat_id FROM chapter WHERE id = ? AND novel_id = ?')
    .get(chapterId, novelId) as { volume_id: number | null; beat_id: number | null } | undefined
  if (!chapter || chapter.volume_id === null) return null

  const volume = db
    .prepare('SELECT title, order_index FROM volume WHERE id = ? AND novel_id = ?')
    .get(chapter.volume_id, novelId) as { title: string; order_index: number } | undefined
  if (!volume) return null

  // 卷内章节位置（按 id 顺序，与整本生产一致）
  const inVolume = db
    .prepare(
      'SELECT COUNT(*) AS c FROM chapter WHERE novel_id = ? AND volume_id = ? AND id <= ?'
    )
    .get(novelId, chapter.volume_id, chapterId) as { c: number }
  const totalInVolume = db
    .prepare('SELECT COUNT(*) AS c FROM chapter WHERE novel_id = ? AND volume_id = ?')
    .get(novelId, chapter.volume_id) as { c: number }

  const index = Number(inVolume.c) || 0
  const total = Number(totalInVolume.c) || 0
  const role = total <= 1 ? '独立章' : index <= 1 ? '开篇' : index >= total ? '收尾' : '推进'

  let beatTitle = ''
  let beatSummary = ''
  if (chapter.beat_id !== null) {
    const beat = db
      .prepare('SELECT title, summary FROM beat WHERE id = ?')
      .get(chapter.beat_id) as { title: string; summary: string } | undefined
    if (beat) {
      beatTitle = beat.title
      beatSummary = beat.summary
    }
  }

  return {
    volumeTitle: volume.title || `第 ${volume.order_index + 1} 卷`,
    volumeIndex: Number(volume.order_index) || 0,
    chapterIndexInVolume: index,
    chapterCountInVolume: total,
    beatTitle,
    beatSummary,
    role
  }
}

/** 卷章定位块（注入方案步骤 prompt；无卷数据返回空串） */
export function chapterPositionBlock(db: DatabaseSync, novelId: number, chapterId: number): string {
  const pos = getChapterPosition(db, novelId, chapterId)
  if (!pos) return ''
  const lines = [
    '【卷章定位】',
    `卷：${pos.volumeTitle}（第 ${pos.volumeIndex + 1} 卷，本卷共 ${pos.chapterCountInVolume} 章）`,
    `本章：${pos.chapterIndexInVolume}/${pos.chapterCountInVolume} · 卷内角色：${pos.role}`
  ]
  if (pos.beatTitle) {
    lines.push(`节拍：${pos.beatTitle}${pos.beatSummary ? `（${pos.beatSummary.slice(0, 120)}）` : ''}`)
  }
  lines.push('创作提示：按卷内角色调整本章任务——开篇铺垫设定与钩子、推进保持节奏与伏笔、收尾强化冲突与断章钩子。')
  return '\n' + lines.join('\n')
}
