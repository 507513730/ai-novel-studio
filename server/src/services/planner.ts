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
export function generateDirectionsPrompt(inspiration: string): string {
  return `${getSystemPrompt('direction')}\n${JSON_FORMAT}\n\n灵感：${inspiration}\n\n请输出 {"directions": [2 套方案]}，每套含 title/sellingPoint/genre/coreSetting/mainline/first30/readerFeeling。`
}

export function parseDirections(obj: unknown): Array<{ id: string; scheme: Record<string, unknown> }> | null {
  const arr = (obj as { directions?: unknown }).directions
  if (!Array.isArray(arr) || arr.length < 2) return null
  const out: Array<{ id: string; scheme: Record<string, unknown> }> = []
  for (let i = 0; i < arr.length; i++) {
    const d = arr[i] as Record<string, unknown>
    if (!d.title || !d.sellingPoint || !d.genre) return null
    out.push({ id: `d${i + 1}`, scheme: d })
  }
  return out
}

// ---------- framing ----------
export function generateFramingPrompt(inspiration: string, direction: unknown): string {
  return `${getSystemPrompt('planning')}\n${JSON_FORMAT}\n\n灵感：${inspiration}\n方向：${JSON.stringify(direction)}\n\n请输出 {"summary": "故事梗概", "sellingPoint": "卖点", "readerFeeling": "目标读者感受", "first30Promise": "前30章承诺"}`
}

// ---------- macro ----------
export function generateMacroPrompt(title: string, framingJson: string): string {
  return `${getSystemPrompt('macro')}\n${JSON_FORMAT}\n\n书名：${title}\n设定：${framingJson}\n\n请输出 {"storyEngine": "故事引擎", "longConflict": "长期对立", "payoffSummary": "推进与兑现摘要", "theme": "主题"}`
}

// ---------- 世界观（3 步） ----------
export function generateWorldManualPrompt(base: string): string {
  return `${getSystemPrompt('world')}\n${JSON_FORMAT}\n\n${base}\n\n第一步请只输出世界观手册，格式 {"category": "描述"}，4-6 个 category。`
}

export function generateWorldFactionsPrompt(base: string, manual: Record<string, string>): string {
  return `${getSystemPrompt('world')}\n${JSON_FORMAT}\n\n${base}\n世界观手册：${JSON.stringify(manual)}\n\n第二步请输出势力清单 {"factions": [{"name","desc","stance"}]}，4-8 个。`
}

export function generateWorldMapPrompt(base: string): string {
  return `${getSystemPrompt('world')}\n${JSON_FORMAT}\n\n${base}\n\n第三步请输出关键地点 {"place": "描述"}，3-5 个。`
}

// ---------- 角色（2 批） ----------
export function generateCharsCorePrompt(base: string): string {
  return `${getSystemPrompt('characters')}\n${JSON_FORMAT}\n\n${base}\n\n第一步：核心阵容（主角 + 2-3 重要配角 + 1-2 反派）4-6 个。格式 {"characters": [{"name","role","identity","personality","goal","weakness","relation"}]}`
}

export function generateCharsExtendedPrompt(base: string, core: Array<{ name: string; role: string }>): string {
  return `${getSystemPrompt('characters')}\n${JSON_FORMAT}\n\n${base}\n核心：${JSON.stringify(core)}\n\n第二步：扩展配角 3-5 个，不重复。格式同上。`
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
export function generateChaptersPrompt(
  volumeTitle: string,
  strategyJson: string,
  beatsJson: string,
  count: number,
  prevVolumeHook?: string
): string {
  return `${getSystemPrompt('chapters')}\n${JSON_FORMAT}\n${CHAPTER_TITLE_RULE}\n\n卷名：${volumeTitle}\n卷战略：${strategyJson}\n节奏板：${beatsJson}\n本章节数：${count}。\n${prevVolumeHook ? `【上一卷结尾钩子（第一卷首章须衔接此钩子）】${prevVolumeHook}\n` : ''}请输出 {"chapters": [{"title","summary","goal"}]}，正好 ${count} 章（可加 "beatIndex" 分配 beat）。`
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

// ---------- 执行封装（director 用） ----------
export async function runPlannerStage(
  db: DatabaseSync,
  novelId: number,
  task: 'directions' | 'framing' | 'macro' | 'world-manual' | 'world-factions' | 'world-map' | 'characters-core' | 'characters-extended' | 'volumes' | 'beats' | 'chapters' | 'refine',
  prompt: string,
  parse: (obj: unknown) => unknown,
  maxTokens: number
): Promise<unknown> {
  return callLlmJson(
    db,
    'extraction',
    {
      novelId,
      messages: [{ role: 'user', content: prompt }],
      maxTokens
    },
    parse as (obj: unknown) => never,
    `planner-${task}`
  )
}
