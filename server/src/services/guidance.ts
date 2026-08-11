import type { DatabaseSync } from 'node:sqlite'

// P19 ①：两级创作引导工具
// 书级引导（novel.guidance 持久化）+ 单次引导（本次请求，不持久化）
// 组装顺序：书级在前、单次在后（模型更关注最新指令）

export interface WritingSettings {
  lang: 'simplified' | 'traditional'
  format: 'paragraph' | 'longSentence'
  writingMode: 'focused' | 'standard' | 'free'
}

const WRITING_DEFAULTS: WritingSettings = {
  lang: 'simplified',
  format: 'paragraph',
  writingMode: 'standard'
}

// P19 ②⑤：写作偏好（应用级 app_settings，随生成注入冻结区）
export function getWritingSettings(db: DatabaseSync): WritingSettings {
  const rows = db.prepare('SELECT key, value FROM app_settings').all() as Array<{ key: string; value: string }>
  const map = new Map(rows.map((r) => [r.key, r.value]))
  const pick = <K extends keyof WritingSettings>(k: K): WritingSettings[K] => {
    const v = map.get(k)
    return (v === undefined ? WRITING_DEFAULTS[k] : (v as WritingSettings[K]))
  }
  return { lang: pick('lang'), format: pick('format'), writingMode: pick('writingMode') }
}

const LANG_RULE: Record<WritingSettings['lang'], string> = {
  simplified: '全文统一使用简体中文',
  traditional: '全文统一使用繁体中文'
}

const FORMAT_RULE: Record<WritingSettings['format'], string> = {
  paragraph: '按自然段落分段，一段一意，对话独立成段',
  longSentence: '句子可稍长，多用复合句，保持段落完整连续'
}

const MODE_RULE: Record<WritingSettings['writingMode'], string> = {
  focused: '聚焦模式：本章严格围绕任务单目标推进，禁止展开与目标无关的支线',
  standard: '标准模式：围绕任务单推进，可适度铺陈环境与心理',
  free: '自由模式：允许合理的支线发散，但必须在章节结尾回落到主线'
}

/** P19 ②⑤：写作偏好渲染为提示词规则块（未偏离默认时返回空串，省 token） */
export function buildWritingRules(settings: WritingSettings): string {
  const parts: string[] = []
  if (settings.lang !== WRITING_DEFAULTS.lang) parts.push(LANG_RULE[settings.lang])
  if (settings.format !== WRITING_DEFAULTS.format) parts.push(FORMAT_RULE[settings.format])
  if (settings.writingMode !== WRITING_DEFAULTS.writingMode) parts.push(MODE_RULE[settings.writingMode])
  return parts.join('\n')
}

export function getGuidance(db: DatabaseSync, novelId: number): string {
  const row = db.prepare('SELECT guidance FROM novel WHERE id = ?').get(novelId) as
    | { guidance: string }
    | undefined
  return row?.guidance?.trim() ?? ''
}

/** 合并两级引导为一个提示词块（空则返回空串，调用方省略段） */
export function buildGuidanceBlock(bookGuidance: string, perCallGuidance?: string): string {
  const parts: string[] = []
  if (bookGuidance) parts.push(`【创作引导】${bookGuidance}`)
  if (perCallGuidance && perCallGuidance.trim()) parts.push(`【本次引导】${perCallGuidance.trim()}`)
  return parts.join('\n')
}
