// 导演阶段执行器：chapters（逐卷章节清单，节拍板门禁 + 章节幂等去重）
import { DatabaseSync } from 'node:sqlite'
import { callLlmJson } from '../../jsonSafe'
import { injectGuidance } from '../../settingBrief'
import { generateChaptersPrompt, parseChaptersPlan, getPrevVolumeHook } from '../../planner'
import type { StageContext } from './shared'

export async function runChaptersStage(db: DatabaseSync, novelId: number, _ctx: StageContext): Promise<void> {
  const vols = db
    .prepare('SELECT id, title, strategy_json, skeleton_json FROM volume WHERE novel_id = ? ORDER BY order_index')
    .all(novelId) as Array<{ id: number; title: string; strategy_json: string; skeleton_json: string }>
  for (const v of vols) {
    // P13 G5：节拍板门禁（导演链同守则）
    const beatCount = (db.prepare('SELECT COUNT(*) AS c FROM beat WHERE volume_id = ?').get(v.id) as { c: number }).c
    if (beatCount === 0) {
      throw new Error(`卷「${v.title}」没有节奏板，请先完成节奏板阶段（节拍板是拆章依据）`)
    }
    const strategy = JSON.parse(v.strategy_json) as { chaptersPerVolume: number }
    const count = strategy.chaptersPerVolume ?? 20
    const beats = db
      .prepare('SELECT id, title, summary FROM beat WHERE volume_id = ? ORDER BY order_index')
      .all(v.id) as Array<{ id: number; title: string; summary: string }>
    const prevHook = getPrevVolumeHook(db, novelId, v.id) // P2.1 🟡7 卷间衔接
    const plan = await callLlmJson<
      Array<{ title: string; summary: string; goal: string; beatId: number | null }>
    >(
      db,
      'extraction',
      {
        novelId,
        messages: [
          {
            role: 'user',
            content: injectGuidance(db, novelId, generateChaptersPrompt(
              v.title,
              v.strategy_json,
              JSON.stringify(beats),
              count,
              // v0.23.1（批次 B1）：统一超集——补卷骨架注入（与手动路由对齐）
              { prevVolumeHook: prevHook, skeletonJson: v.skeleton_json }
            ))
          }
        ],
        maxTokens: 8192
      },
      (obj) => parseChaptersPlan(obj, beats),
      'director-chapters'
    )
    // P20（M3）：章节幂等去重（按 volume+title 跳过重跑产物）
    const existingChapters = new Set(
      (
        db.prepare('SELECT title FROM chapter WHERE volume_id = ?').all(v.id) as Array<{ title: string }>
      ).map((r) => r.title)
    )
    db.exec('BEGIN')
    try {
      for (const cp of plan) {
        if (existingChapters.has(cp.title)) continue
        existingChapters.add(cp.title)
        db.prepare(
          'INSERT INTO chapter (novel_id, volume_id, beat_id, title, summary, goal_json, status) VALUES (?, ?, ?, ?, ?, ?, ?)'
        ).run(novelId, v.id, cp.beatId, cp.title, cp.summary, JSON.stringify({ goal: cp.goal }), 'planned')
      }
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
  }
}
