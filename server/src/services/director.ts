import { DatabaseSync } from 'node:sqlite'
import { callLlmJson } from './jsonSafe'
import { isJobCancelled, isJobAborted } from './jobQueue'
import {
  generateDirectionsPrompt,
  parseDirections,
  generateFramingPrompt,
  generateMacroPrompt,
  generateWorldManualPrompt,
  generateWorldFactionsPrompt,
  generateWorldMapPrompt,
  generateCharsCorePrompt,
  generateCharsExtendedPrompt,
  parseCharacters,
  generateVolumesPrompt,
  parseVolumes,
  generateBeatsPrompt,
  parseBeats,
  generateChaptersPrompt,
  generateRefinePrompt,
  parseRefine
} from './planner'

// ============================================================
// 自动导演状态机（PLAN §7.1 / P2）
// 11 阶段注册表 + node:sqlite 检查点 + 阶段产物落库判定（幂等）
// + 循环熔断（replan 次数上限 + 决策路径去重）
// ============================================================

export type DirectorStage =
  | 'inspiration'
  | 'directions'
  | 'framing'
  | 'macro'
  | 'world'
  | 'characters'
  | 'volumes'
  | 'beats'
  | 'chapters'
  | 'refine'
  | 'ready'

export const STAGE_LABELS: Record<DirectorStage, string> = {
  inspiration: '灵感理解',
  directions: '方向生成（2 套 + 标题组）',
  framing: '项目设定（framing）',
  macro: '故事宏观规划',
  world: '世界观骨架',
  characters: '角色方案',
  volumes: '卷战略',
  beats: '节奏板',
  chapters: '章节清单',
  refine: '章节细化',
  ready: '可开写检查点'
}

export const STAGE_ORDER: DirectorStage[] = [
  'inspiration',
  'directions',
  'framing',
  'macro',
  'world',
  'characters',
  'volumes',
  'beats',
  'chapters',
  'refine',
  'ready'
]

export interface DirectorCheckpoint {
  stage: DirectorStage
  progress: Record<string, boolean>
  decisions: string[] // 决策路径去重（熔断）
  replanCount: number
  mode: 'auto' | 'supervised'
  chaptersPerVolume?: number // P2.2 🟡10：保留用户配置
  lastError?: string
  displayStatus: string
  blockingReason?: string
  resumeAction?: string
}

export interface DirectorTask {
  id: number
  novelId: number
  stage: DirectorStage
  status: 'running' | 'paused' | 'done' | 'failed' | 'cancelled'
  mode: 'auto' | 'supervised'
  checkpoint: DirectorCheckpoint
}

const MAX_REPLAN = 3

// P2.1 🟡5：按 novel.genre 取流派爽点/节奏模板
function getGenreTemplate(db: DatabaseSync, novelId: number): string {
  const novel = db.prepare('SELECT genre FROM novel WHERE id = ?').get(novelId) as
    | { genre: string }
    | undefined
  if (!novel?.genre) return ''
  const preset = db
    .prepare('SELECT name, beat_templates_json, payoff_json FROM genre_asset WHERE novel_id IS NULL AND genre_type = ?')
    .get(novel.genre) as { name: string; beat_templates_json: string; payoff_json: string } | undefined
  if (!preset) return ''
  const beats = JSON.parse(preset.beat_templates_json || '[]') as string[]
  const payoffs = JSON.parse(preset.payoff_json || '[]') as string[]
  const parts: string[] = []
  if (beats.length > 0) {
    parts.push(`【流派节奏模板（${preset.name}）】`)
    for (const b of beats) parts.push(`- ${b}`)
  }
  if (payoffs.length > 0) {
    parts.push('【爽点兑现方式】')
    for (const p of payoffs) parts.push(`- ${p}`)
  }
  return parts.join('\n')
}

// P2.1 🟡7：取上一卷的结尾钩子（卷间衔接）
function getPrevVolumeHook(db: DatabaseSync, novelId: number, currentVolumeId: number): string {
  const cur = db.prepare('SELECT order_index FROM volume WHERE id = ?').get(currentVolumeId) as
    | { order_index: number }
    | undefined
  if (!cur || cur.order_index <= 0) return ''
  const prev = db
    .prepare('SELECT skeleton_json FROM volume WHERE novel_id = ? AND order_index = ?')
    .get(novelId, cur.order_index - 1) as { skeleton_json: string } | undefined
  if (!prev) return ''
  const skeleton = JSON.parse(prev.skeleton_json || '{}') as { endingHook?: string }
  return skeleton.endingHook ?? ''
}

// P2.1 🟡7：取前一章的结尾钩子（章间衔接）
function getPrevChapterEnding(db: DatabaseSync, novelId: number, currentChapterId: number): string {
  const rows = db
    .prepare('SELECT id, title, goal_json FROM chapter WHERE novel_id = ? AND id < ? ORDER BY id DESC LIMIT 1')
    .all(novelId, currentChapterId) as Array<{ id: number; title: string; goal_json: string }>
  if (rows.length === 0) return ''
  const goal = JSON.parse(rows[0].goal_json || '{}') as { ending?: string }
  return goal.ending ? `《${rows[0].title}》结尾钩子：${goal.ending}` : ''
}

// ---------- 检查点读写 ----------
export function loadDirectorTask(db: DatabaseSync, novelId: number): DirectorTask | null {
  const row = db
    .prepare('SELECT * FROM director_followup WHERE novel_id = ? ORDER BY id DESC LIMIT 1')
    .get(novelId) as
    | { id: number; novel_id: number; stage: string; checkpoint_json: string; status: string; model_route_id: number | null }
    | undefined
  if (!row) return null
  const checkpoint = JSON.parse(row.checkpoint_json) as DirectorCheckpoint
  return {
    id: row.id,
    novelId: row.novel_id,
    stage: checkpoint.stage ?? (row.stage as DirectorStage),
    status: row.status as DirectorTask['status'],
    mode: checkpoint.mode ?? 'auto',
    checkpoint
  }
}

export function saveDirectorTask(db: DatabaseSync, task: DirectorTask): void {
  const existing = db
    .prepare('SELECT id FROM director_followup WHERE novel_id = ? ORDER BY id DESC LIMIT 1')
    .get(task.novelId) as { id: number } | undefined
  const json = JSON.stringify(task.checkpoint)
  if (existing) {
    db.prepare(
      "UPDATE director_followup SET stage = ?, checkpoint_json = ?, status = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(task.stage, json, task.status, existing.id)
  } else {
    db.prepare(
      'INSERT INTO director_followup (novel_id, stage, checkpoint_json, status) VALUES (?, ?, ?, ?)'
    ).run(task.novelId, task.stage, json, task.status)
  }
}

// ---------- 阶段产物落库判定（重启幂等的核心） ----------
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

// ---------- 阶段执行 ----------
interface StageContext {
  chaptersPerVolume: number
  // P20（M2）：job 感知（取消时每阶段边界中止）
  jobId?: number
}

async function runStage(
  db: DatabaseSync,
  novelId: number,
  stage: DirectorStage,
  ctx: StageContext
): Promise<void> {
  const novel = db.prepare('SELECT inspiration, framing_json, title FROM novel WHERE id = ?').get(novelId) as
    | { inspiration: string; framing_json: string; title: string }
    | undefined
  if (!novel) throw new Error('novel not found')

  switch (stage) {
    case 'inspiration':
      return
    case 'directions': {
      const dirs = await callLlmJson<Array<{ id: string; scheme: Record<string, unknown> }>>(
        db,
        'extraction',
        {
          novelId,
          messages: [{ role: 'user', content: generateDirectionsPrompt(novel.inspiration) }],
          maxTokens: 4096
        },
        parseDirections,
        'director-directions'
      )
      db.prepare(
        "UPDATE novel SET direction_json = ?, status = 'directions', updated_at = datetime('now') WHERE id = ?"
      ).run(JSON.stringify(dirs), novelId)
      return
    }
    case 'framing': {
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
            { role: 'user', content: generateFramingPrompt(novel.inspiration, dirs[0]?.scheme ?? {}) }
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
        JSON.stringify(framing),
        matchedGenre,
        novelId
      )
      return
    }
    case 'macro': {
      const macro = await callLlmJson<Record<string, unknown>>(
        db,
        'extraction',
        {
          novelId,
          messages: [{ role: 'user', content: generateMacroPrompt(novel.title, novel.framing_json) }],
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
      return
    }
    case 'world': {
      const base = `书名设定：${novel.framing_json}\n灵感：${novel.inspiration}`
      const manual = await callLlmJson<Record<string, string>>(
        db,
        'extraction',
        {
          novelId,
          messages: [{ role: 'user', content: generateWorldManualPrompt(base) }],
          maxTokens: 2048
        },
        (obj) => {
          if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
            const rec = obj as Record<string, unknown>
            return Object.keys(rec).length >= 2 ? (rec as Record<string, string>) : null
          }
          return null
        },
        'director-world-manual'
      )
      const factions = await callLlmJson<Array<{ name: string; desc: string; stance: string }>>(
        db,
        'extraction',
        {
          novelId,
          messages: [{ role: 'user', content: generateWorldFactionsPrompt(base, manual) }],
          maxTokens: 2048
        },
        (obj) => {
          const arr = (obj as { factions?: unknown }).factions
          if (!Array.isArray(arr) || arr.length === 0) return null
          return arr.map((f) => {
            const r = f as Record<string, unknown>
            return { name: String(r.name ?? ''), desc: String(r.desc ?? ''), stance: String(r.stance ?? '') }
          })
        },
        'director-world-factions'
      )
      const map = await callLlmJson<Record<string, string>>(
        db,
        'extraction',
        {
          novelId,
          messages: [{ role: 'user', content: generateWorldMapPrompt(base) }],
          maxTokens: 2048
        },
        (obj) => (obj && typeof obj === 'object' && !Array.isArray(obj) ? (obj as Record<string, string>) : null),
        'director-world-map'
      )
      db.prepare(
        "UPDATE world SET manual_json = ?, factions_json = ?, map_json = ?, updated_at = datetime('now') WHERE novel_id = ?"
      ).run(JSON.stringify(manual), JSON.stringify(factions), JSON.stringify(map), novelId)
      return
    }
    case 'characters': {
      const world = db
        .prepare('SELECT manual_json, factions_json FROM world WHERE novel_id = ?')
        .get(novelId) as { manual_json: string; factions_json: string } | undefined
      const base = `书级合约：${novel.framing_json}\n世界观：${world ? world.manual_json + world.factions_json : ''}`
      type Char = { name: string; role: string; identity: string; personality: string; goal: string; weakness: string; relation: string }
      const core = await callLlmJson<Char[]>(
        db,
        'extraction',
        {
          novelId,
          messages: [{ role: 'user', content: generateCharsCorePrompt(base) }],
          maxTokens: 4096
        },
        parseCharacters,
        'director-characters-core'
      )
      const extended = await callLlmJson<Char[]>(
        db,
        'extraction',
        {
          novelId,
          messages: [
            {
              role: 'user',
              content: generateCharsExtendedPrompt(base, core.map((c) => ({ name: c.name, role: c.role })))
            }
          ],
          maxTokens: 4096
        },
        parseCharacters,
        'director-characters-extended'
      )
      // P20（M3）：幂等去重——按 novel+name 跳过已存在（阶段失败重跑不造重名角色）
      const existingChars = new Set(
        (db.prepare('SELECT name FROM character WHERE novel_id = ?').all(novelId) as Array<{ name: string }>).map(
          (r) => r.name
        )
      )
      const insert = db.prepare(
        'INSERT INTO character (novel_id, name, profile_json, status) VALUES (?, ?, ?, ?)'
      )
      db.exec('BEGIN')
      try {
        for (const c of [...core, ...extended]) {
          if (existingChars.has(c.name)) continue
          existingChars.add(c.name)
          insert.run(
            novelId,
            c.name,
            JSON.stringify({
              role: c.role,
              identity: c.identity,
              personality: c.personality,
              goal: c.goal,
              weakness: c.weakness,
              relation: c.relation
            }),
            'pending'
          )
        }
        db.exec('COMMIT')
      } catch (err) {
        db.exec('ROLLBACK')
        throw err
      }
      return
    }
    case 'volumes': {
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
              content: generateVolumesPrompt(
                novel.title,
                novel.framing_json,
                characters.map((c) => c.name).join('；'),
                ctx.chaptersPerVolume
              )
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
      return
    }
    case 'beats': {
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
                content: generateBeatsPrompt(
                  v.title,
                  v.strategy_json,
                  v.skeleton_json,
                  strategy.chaptersPerVolume ?? 20,
                  genreTemplate
                )
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
      return
    }
    case 'chapters': {
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
                content: generateChaptersPrompt(
                  v.title,
                  v.strategy_json,
                  JSON.stringify(beats),
                  count,
                  prevHook
                )
              }
            ],
            maxTokens: 8192
          },
          (obj) => {
            const arr = (obj as { chapters?: unknown }).chapters
            if (!Array.isArray(arr) || arr.length === 0) return null
            return arr.map((c) => {
              const r = c as Record<string, unknown>
              const beatIndex = Number(r.beatIndex ?? -1)
              return {
                title: String(r.title ?? ''),
                summary: String(r.summary ?? ''),
                goal: String(r.goal ?? ''),
                beatId: beatIndex >= 0 && beats[beatIndex] ? beats[beatIndex].id : null
              }
            })
          },
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
      return
    }
    case 'refine': {
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
                  content: generateRefinePrompt(ch.title, ch.summary, ch.goal_json, prevEnding)
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
      return
    }
    case 'ready':
      return
  }
}

// ---------- 主循环（执行面隔离：由 scheduler 驱动） ----------
export async function runDirectorPipeline(
  db: DatabaseSync,
  novelId: number,
  mode: 'auto' | 'supervised' = 'auto',
  ctx: StageContext = { chaptersPerVolume: 20 }
): Promise<void> {
  // 加载或新建任务
  let task = loadDirectorTask(db, novelId)
  if (!task) {
    task = {
      id: 0,
      novelId,
      stage: 'inspiration',
      status: 'running',
      mode,
      checkpoint: {
        stage: 'inspiration',
        progress: {},
        decisions: [],
        replanCount: 0,
        mode,
        chaptersPerVolume: ctx.chaptersPerVolume, // P2.2 🟡10
        displayStatus: '导演启动',
        resumeAction: '自动推进'
      }
    }
  }
  task.status = 'running'
  task.mode = mode
  task.checkpoint.chaptersPerVolume = ctx.chaptersPerVolume // P2.2 🟡10：resume 时保留
  saveDirectorTask(db, task)

  for (const stage of STAGE_ORDER) {
    // P20（M2）：取消感知（用户取消 → 中止并标记 task）；v0.8.0（审查 #8）：watchdog 超时同样中止
    if (ctx.jobId && isJobAborted(db, ctx.jobId)) {
      const watchdogStuck = isJobCancelled(db, ctx.jobId) === false
      task.status = 'cancelled'
      task.checkpoint.displayStatus = watchdogStuck ? '导演已中止（任务超时回收）' : '导演已取消（用户中止）'
      task.checkpoint.resumeAction = '重新运行导演以继续'
      saveDirectorTask(db, task)
      return
    }

    // 熔断：超过上限直接停
    // P20（M6）：按阶段计数——早期网络抖动不耗尽全局预算
    const stageReplans = task.checkpoint.decisions.filter((d) => d.startsWith(`${stage}:`)).length
    if (stageReplans > MAX_REPLAN) {
      task.status = 'failed'
      task.checkpoint.displayStatus = '重规划超限，需人工介入'
      task.checkpoint.blockingReason = `阶段 ${STAGE_LABELS[stage]} 连续重规划 ${stageReplans} 次超过上限 ${MAX_REPLAN}`
      task.checkpoint.resumeAction = '人工修改后重跑导演'
      saveDirectorTask(db, task)
      return
    }

    // 幂等：产物已落库则跳过（重启恢复的关键）
    if (isStageDone(db, novelId, stage)) {
      task.checkpoint.progress[stage] = true
      task.stage = stage
      task.checkpoint.stage = stage
      task.checkpoint.displayStatus = `阶段完成：${STAGE_LABELS[stage]}（跳过）`
      saveDirectorTask(db, task)
      continue
    }

    task.stage = stage
    task.checkpoint.stage = stage
    task.checkpoint.displayStatus = `执行中：${STAGE_LABELS[stage]}`
    task.checkpoint.lastError = undefined
    saveDirectorTask(db, task)

    try {
      await runStage(db, novelId, stage, ctx)
      task.checkpoint.progress[stage] = true
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      task.checkpoint.lastError = message
      task.checkpoint.replanCount += 1
      // 决策路径去重（熔断）：同类错误不无限重试
      const sig = `${stage}:${message.slice(0, 60)}`
      if (!task.checkpoint.decisions.includes(sig)) {
        task.checkpoint.decisions.push(sig)
      }
      const isRetryable =
        /LLM JSON 输出解析失败|rate limit|429|503|timeout|网络|ECONN|配额|insufficient_quota/i.test(message)
      // P20（M6）：按阶段计数判定可重试
      const stageReplansNow = task.checkpoint.decisions.filter((d) => d.startsWith(`${stage}:`)).length
      if (isRetryable && stageReplansNow <= MAX_REPLAN) {
        task.status = 'running'
        task.checkpoint.displayStatus = `阶段失败（可重试 ${stageReplansNow}/${MAX_REPLAN}）：${STAGE_LABELS[stage]}`
        saveDirectorTask(db, task)
        await new Promise((r) => setTimeout(r, 2000))
        continue // 重试当前阶段
      }
      task.status = 'failed'
      task.checkpoint.displayStatus = `失败（不可自动恢复）：${STAGE_LABELS[stage]}`
      task.checkpoint.blockingReason = message
      task.checkpoint.resumeAction = mode === 'supervised' ? '确认后重试' : '人工介入或换模型后 resume'
      saveDirectorTask(db, task)
      return
    }

    // supervised 模式：每阶段完成暂停等确认
    if (mode === 'supervised' && stage !== 'ready') {
      task.status = 'paused'
      task.checkpoint.displayStatus = `检查点：${STAGE_LABELS[stage]} 完成，等待确认`
      task.checkpoint.resumeAction = 'resume 继续下一阶段'
      saveDirectorTask(db, task)
      return
    }
  }

  // P2.1 🟡10：auto 模式自动确认 pending 角色入册（supervised 保持手动）
  if (task.mode === 'auto') {
    db.prepare(
      "UPDATE character SET status = 'roster', updated_at = datetime('now') WHERE novel_id = ? AND status = 'pending'"
    ).run(novelId)
  }

  task.status = 'done'
  task.checkpoint.stage = 'ready'
  task.checkpoint.displayStatus = '导演完成：全书规划可开写'
  saveDirectorTask(db, task)
}

export function directorProgress(db: DatabaseSync, novelId: number): DirectorTask | null {
  return loadDirectorTask(db, novelId)
}
