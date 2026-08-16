import type { DatabaseSync } from 'node:sqlite'
import { callLlmJson } from './jsonSafe'
import { JSON_FORMAT, CHAPTER_TITLE_RULE } from '../prompts'
import { getSystemPrompt } from '../prompts/promptAsset'

// ============================================================
// 公共规划层（P2.2 🟡6）
// 公共规划器（P2.2 🟡6）
// 导演链与手动路由共用的生成函数（防 prompt/解析逻辑漂移）
// ============================================================

export interface PlannerCtx {
  chaptersPerVolume?: number
  genreTemplate?: string
  prevVolumeHook?: string
  prevChapterEnding?: string
}

// ---------- 方向 ----------
// v0.23.1（批次 B1）：contextLine 参数化（novels.ts 定向重做上下文——此前内联副本漂移）
export function generateDirectionsPrompt(inspiration: string, contextLine = ''): string {
  return `${getSystemPrompt('direction')}\n${JSON_FORMAT}\n\n灵感：${inspiration}${contextLine}\n\n请输出 {"directions": [2 套方案]}，每套含 title/sellingPoint/genre/coreSetting/mainline/first30/readerFeeling。`
}

// v0.17.0（审查 M7）：解析统一于此（此前 novels.ts 本地副本漂移：≥1 vs ≥2 + 缺字段补齐）
export function parseDirections(obj: unknown): Array<{ id: string; scheme: Record<string, unknown> }> | null {
  const arr = (obj as { directions?: unknown }).directions
  if (!Array.isArray(arr) || arr.length === 0) return null
  const out: Array<{ id: string; scheme: Record<string, unknown> }> = []
  for (let i = 0; i < arr.length; i++) {
    const d = arr[i] as Record<string, unknown>
    if (!d.title || !d.sellingPoint || !d.genre) return null
    out.push({
      id: `d${i + 1}`,
      scheme: {
        title: String(d.title),
        sellingPoint: String(d.sellingPoint),
        genre: String(d.genre ?? ''),
        coreSetting: String(d.coreSetting ?? ''),
        mainline: String(d.mainline ?? ''),
        first30: String(d.first30 ?? ''),
        readerFeeling: String(d.readerFeeling ?? '')
      }
    })
  }
  return out
}

// ---------- framing ----------
// v0.23.1（批次 B1）：notes 参数化（novels.ts 补充行——此前内联副本独有，导演链缺失）
export function generateFramingPrompt(inspiration: string, direction: unknown, notes = ''): string {
  return `${getSystemPrompt('planning')}\n${JSON_FORMAT}\n\n灵感：${inspiration}\n方向：${JSON.stringify(direction)}${notes ? `\n补充：${notes}` : ''}\n\n请输出 {"summary": "故事梗概", "sellingPoint": "卖点", "readerFeeling": "目标读者感受", "first30Promise": "前30章承诺"}`
}

// ---------- macro ----------
export function generateMacroPrompt(title: string, framingJson: string): string {
  return `${getSystemPrompt('macro')}\n${JSON_FORMAT}\n\n书名：${title}\n设定：${framingJson}\n\n请输出 {"storyEngine": "故事引擎（核心张力）", "longConflict": "长期对立", "payoffSummary": "推进与兑现摘要", "theme": "主题"}`
}

// ---------- 世界观（3 步） ----------
// v0.23.1（批次 B1）：webCtx 参数化 + 指令文本统一为超集（worlds.ts 手动路由独有细节回灌；
// 解析器同步收敛——此前 worlds.ts 内联三份）
export function generateWorldManualPrompt(base: string, webCtx = ''): string {
  return `${getSystemPrompt('world')}\n${JSON_FORMAT}\n\n${base}${webCtx ? `\n\n${webCtx}` : ''}\n\n第一步请只输出世界观手册（力量体系、核心规则、社会结构、历史脉络），格式 {"category": "描述"}，4-6 个 category，每项 50-120 字。`
}

export function generateWorldFactionsPrompt(base: string, manual: Record<string, string>): string {
  return `${getSystemPrompt('world')}\n${JSON_FORMAT}\n\n${base}\n世界观手册：${JSON.stringify(manual)}\n\n第二步请输出势力清单，格式 {"factions": [{"name": "势力名", "desc": "描述", "stance": "立场"}]}，4-8 个势力。`
}

export function generateWorldMapPrompt(base: string): string {
  return `${getSystemPrompt('world')}\n${JSON_FORMAT}\n\n${base}\n\n第三步请输出关键地点清单，格式 {"place": "描述"}，3-5 个地点，每项 30-80 字。`
}

export function parseWorldManual(obj: unknown): Record<string, string> | null {
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    const rec = obj as Record<string, unknown>
    if (Object.keys(rec).length >= 2) return rec as Record<string, string>
  }
  return null
}

export function parseWorldFactions(obj: unknown): Array<{ name: string; desc: string; stance: string }> | null {
  const arr = (obj as { factions?: unknown }).factions
  if (!Array.isArray(arr) || arr.length === 0) return null
  return arr.map((f) => {
    const r = f as Record<string, unknown>
    return { name: String(r.name ?? ''), desc: String(r.desc ?? ''), stance: String(r.stance ?? '') }
  })
}

export function parseWorldMap(obj: unknown): Record<string, string> | null {
  return obj && typeof obj === 'object' && !Array.isArray(obj) ? (obj as Record<string, string>) : null
}

// ---------- 角色（2 批） ----------
export function generateCharsCorePrompt(base: string): string {
  return `${getSystemPrompt('characters')}\n${JSON_FORMAT}\n\n${base}\n\n第一步：核心阵容（主角 + 2-3 重要配角 + 1-2 反派）4-6 个。格式 {"characters": [{"name","role","identity","personality","goal","weakness","relation"}]}`
}

export function generateCharsExtendedPrompt(base: string, core: Array<{ name: string; role: string }>): string {
  return `${getSystemPrompt('characters')}\n${JSON_FORMAT}\n\n${base}\n核心阵容：${JSON.stringify(core)}\n\n第二步：请输出扩展配角与功能性角色（同门/同僚/市井人物/宿敌爪牙等），共 3-5 个，与核心阵容不重复。格式同上 {"characters": [...]}`
}

export function parseCharacters(obj: unknown): Array<{ name: string; role: string; identity: string; personality: string; goal: string; weakness: string; relation: string }> | null {
  const arr = (obj as { characters?: unknown }).characters
  if (!Array.isArray(arr) || arr.length === 0) return null
  const out: Array<{ name: string; role: string; identity: string; personality: string; goal: string; weakness: string; relation: string }> = []
  for (const c of arr) {
    const r = c as Record<string, unknown>
    if (!r.name) return null
    out.push({
      name: String(r.name),
      role: String(r.role ?? ''),
      identity: String(r.identity ?? ''),
      personality: String(r.personality ?? ''),
      goal: String(r.goal ?? ''),
      weakness: String(r.weakness ?? ''),
      relation: String(r.relation ?? '')
    })
  }
  return out
}

// ---------- 卷 ----------
export function generateVolumesPrompt(
  title: string,
  framingJson: string,
  characters: string,
  chaptersPerVolume: number
): string {
  return `${getSystemPrompt('volumes')}\n${JSON_FORMAT}\n\n书名：${title}\n书级合约：${framingJson}\n角色：${characters}\n每卷 ${chaptersPerVolume} 章，全书 3-5 卷。\n\n请输出 {"volumes": [{"title","theme","coreConflict","keyEvents":[],"endingHook"}]}`
}

export function parseVolumes(obj: unknown): Array<{ title: string; theme: string; coreConflict: string; keyEvents: string[]; endingHook: string }> | null {
  const arr = (obj as { volumes?: unknown }).volumes
  if (!Array.isArray(arr) || arr.length === 0) return null
  const out: Array<{ title: string; theme: string; coreConflict: string; keyEvents: string[]; endingHook: string }> = []
  for (const v of arr) {
    const r = v as Record<string, unknown>
    if (!r.title) return null
    out.push({
      title: String(r.title),
      theme: String(r.theme ?? ''),
      coreConflict: String(r.coreConflict ?? ''),
      keyEvents: Array.isArray(r.keyEvents) ? r.keyEvents.map(String) : [],
      endingHook: String(r.endingHook ?? '')
    })
  }
  return out
}

// ---------- 节奏板 ----------
export function generateBeatsPrompt(
  volumeTitle: string,
  strategyJson: string,
  skeletonJson: string,
  chaptersPerVolume: number,
  genreTemplate?: string
): string {
  return `${getSystemPrompt('beats')}\n${JSON_FORMAT}\n\n卷名：${volumeTitle}\n卷战略：${strategyJson}\n卷骨架：${skeletonJson}\n卷内 ${chaptersPerVolume} 章。\n${genreTemplate ? genreTemplate + '\n' : ''}节奏安排须体现流派模板（爽点密度/黄金三章/断章钩子）。\n\n请输出 {"beats": [{"title","purpose","emotionCurve","scenes":[]}]}，6-12 个。`
}

export function parseBeats(obj: unknown): Array<{ title: string; purpose: string; emotionCurve: string; scenes: string[] }> | null {
  const arr = (obj as { beats?: unknown }).beats
  if (!Array.isArray(arr) || arr.length === 0) return null
  const out: Array<{ title: string; purpose: string; emotionCurve: string; scenes: string[] }> = []
  for (const b of arr) {
    const r = b as Record<string, unknown>
    if (!r.title) return null
    out.push({
      title: String(r.title),
      purpose: String(r.purpose ?? ''),
      emotionCurve: String(r.emotionCurve ?? ''),
      scenes: Array.isArray(r.scenes) ? r.scenes.map(String) : []
    })
  }
  return out
}

// ---------- 章节清单 ----------
// v0.23.1（批次 B1）：skeletonJson/prevVolumeHook 参数化统一超集——
// 此前 volumes.ts 手动路由有卷骨架无卷间钩子、导演链有钩子无卷骨架，双向漂移
export function generateChaptersPrompt(
  volumeTitle: string,
  strategyJson: string,
  beatsJson: string,
  count: number,
  opts: { prevVolumeHook?: string; skeletonJson?: string } = {}
): string {
  return `${getSystemPrompt('chapters')}\n${JSON_FORMAT}\n${CHAPTER_TITLE_RULE}\n\n卷名：${volumeTitle}\n卷战略：${strategyJson}\n${opts.skeletonJson ? `卷骨架：${opts.skeletonJson}\n` : ''}节奏板：${beatsJson}\n本章节数：${count}。\n${opts.prevVolumeHook ? `【上一卷结尾钩子（第一卷首章须衔接此钩子）】${opts.prevVolumeHook}\n` : ''}请输出 {"chapters": [{"title","summary","goal"}]}，正好 ${count} 章，按节奏板顺序分配 beat（字段可加 "beatIndex"）。`
}

// v0.23.1（批次 B1）：章节清单解析收敛（beatIndex → beatId 绑定——此前 volumes.ts 与 director.ts 各持一份内联）
export function parseChaptersPlan(
  obj: unknown,
  beats: Array<{ id: number }>
): Array<{ title: string; summary: string; goal: string; beatId: number | null }> | null {
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
}

// ---------- 章节细化 ----------
export function generateRefinePrompt(
  chapterTitle: string,
  summary: string,
  goalJson: string,
  prevChapterEnding?: string
): string {
  return `你是章节细化师。请细化本章任务单：${CHAPTER_TITLE_RULE}\n${JSON_FORMAT}\n\n章节：${chapterTitle}\n摘要：${summary}\n初步目标：${goalJson}\n${prevChapterEnding ? `【上一章衔接要求】${prevChapterEnding}（本章开场须承接该钩子）\n` : ''}请输出 {"purpose": "本章推进目的", "boundary": "本章边界", "tasks": ["任务1"], "scenes": ["场景1"], "ending": "结尾钩子"}`
}

export function parseRefine(obj: unknown): Record<string, unknown> | null {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null
  const r = obj as Record<string, unknown>
  if (typeof r.purpose !== 'string' || r.purpose.trim().length < 4) return null
  if (typeof r.ending !== 'string' || r.ending.trim().length < 4) return null
  if (!Array.isArray(r.tasks) || r.tasks.length === 0) return null
  if (!Array.isArray(r.scenes) || r.scenes.length === 0) return null
  return {
    purpose: String(r.purpose),
    boundary: String(r.boundary ?? ''),
    tasks: r.tasks.map(String),
    scenes: r.scenes.map(String),
    ending: String(r.ending)
  }
}

// ---------- 单章细化执行（v0.23.1 批次 D2：自 volumes.ts 迁入——单章端点与批量 job 共用） ----------
// P12 A4：质量门禁（关键字段非空）由 parseRefine 保证
export async function refineOne(
  db: DatabaseSync,
  chapterId: number,
  chapter: { title: string; summary: string; goal_json: string }
): Promise<Record<string, unknown>> {
  const novelId = (db.prepare('SELECT novel_id FROM chapter WHERE id = ?').get(chapterId) as { novel_id: number })
    .novel_id
  const refined = await callLlmJson<Record<string, unknown>>(
    db,
    'extraction',
    {
      novelId,
      messages: [
        {
          role: 'user',
          content: generateRefinePrompt(chapter.title, chapter.summary, chapter.goal_json)
        }
      ],
      maxTokens: 2048
    },
    parseRefine,
    'refine'
  )
  db.prepare("UPDATE chapter SET goal_json = ?, updated_at = datetime('now') WHERE id = ?").run(
    JSON.stringify(refined),
    chapterId
  )
  return refined
}

// ---------- 卷间/流派共享助手（v0.23.1 批次 B1：自 director.ts 迁入——手动路由同样消费） ----------

// P2.1 🟡5：按 novel.genre 取流派爽点/节奏模板
export function getGenreTemplate(db: DatabaseSync, novelId: number): string {
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
export function getPrevVolumeHook(db: DatabaseSync, novelId: number, currentVolumeId: number): string {
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
