import type { DatabaseSync } from 'node:sqlite'
import {
  SYSTEM_PROSE,
  SYSTEM_DIRECTION,
  SYSTEM_TITLES,
  SYSTEM_WORLD,
  SYSTEM_CHARACTERS,
  SYSTEM_VOLUMES,
  SYSTEM_BEATS,
  SYSTEM_CHAPTERS,
  SYSTEM_REVIEW,
  SYSTEM_FIX,
  SYSTEM_PATCH,
  SYSTEM_BACKFILL,
  SYSTEM_PLANNING,
  SYSTEM_MACRO
} from './index'

// P17-5A：提示词资产化渲染引擎
// prompt_asset 表 task_type='sys_<key>' 存可编辑模板（运行时改，无需重启）；
// 未命中时 fallback 代码常量（零破坏）。渲染 ${var} 占位符。

export const SYSTEM_PROMPT_KEYS = [
  'prose', 'direction', 'titles', 'world', 'characters', 'volumes', 'beats',
  'chapters', 'review', 'fix', 'patch', 'backfill', 'planning', 'macro'
] as const

const FALLBACK: Record<string, string> = {
  prose: SYSTEM_PROSE,
  direction: SYSTEM_DIRECTION,
  titles: SYSTEM_TITLES,
  world: SYSTEM_WORLD,
  characters: SYSTEM_CHARACTERS,
  volumes: SYSTEM_VOLUMES,
  beats: SYSTEM_BEATS,
  chapters: SYSTEM_CHAPTERS,
  review: SYSTEM_REVIEW,
  fix: SYSTEM_FIX,
  patch: SYSTEM_PATCH,
  backfill: SYSTEM_BACKFILL,
  planning: SYSTEM_PLANNING,
  macro: SYSTEM_MACRO
}

let cache: Record<string, string | null> | null = null
let promptDb: DatabaseSync | null = null

export function initPromptDb(db: DatabaseSync): void {
  promptDb = db
  cache = null
}

export function invalidatePromptCache(): void {
  cache = null
}

/** 获取系统提示文本：优先 prompt_asset（task_type='sys_<key>'），fallback 常量 */
export function getSystemPrompt(key: string): string {
  const fallback = FALLBACK[key]
  if (!fallback) throw new Error(`unknown system prompt key: ${key}`)
  if (promptDb && !cache) {
    const rows = promptDb
      .prepare("SELECT task_type, template FROM prompt_asset WHERE task_type LIKE 'sys_%'")
      .all() as Array<{ task_type: string; template: string }>
    cache = {}
    for (const r of rows) {
      const k = r.task_type.slice(4)
      cache[k] = r.template
    }
  }
  return (cache && cache[key]) ?? fallback
}

/** 渲染 ${var} 占位符（模板中声明的变量） */
export function renderPromptTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\$\{(\w+)\}/g, (m, name: string) => vars[name] ?? m)
}
