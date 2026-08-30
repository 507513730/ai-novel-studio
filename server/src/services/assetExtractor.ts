import type { DatabaseSync } from 'node:sqlite'
import { callLlmJson } from './jsonSafe'
import { stripHtmlTags } from './sanitize'
import { JSON_FORMAT } from '../prompts'

// ============================================================
// P23 批1：统一资产提取器
// 输入任意文本 → 按资产类型 AI 产出结构化草稿（不保存，供预览/人工修改）
// 类型：knowledge / world / mode / style / genre / base-character / title / anti-ai
// ============================================================

export type AssetType =
  | 'knowledge'
  | 'world'
  | 'mode'
  | 'style'
  | 'genre'
  | 'base-character'
  | 'title'
  | 'anti-ai'

const TYPE_LABEL: Record<AssetType, string> = {
  knowledge: '知识库文档',
  world: '世界样本',
  mode: '推进模式',
  style: '写法特征',
  genre: '流派模板',
  'base-character': '基础角色模板',
  title: '标题组',
  'anti-ai': '反 AI 词库'
}

interface ExtractResult {
  type: AssetType
  draft: Record<string, unknown>
}

function promptFor(type: AssetType, title: string, text: string): string {
  const head = `你是内容提炼师。从用户提供的文本中提炼「${TYPE_LABEL[type]}」草稿（可人工修改后再保存）。\n${JSON_FORMAT}\n\n文本来源：${title || '（无标题）'}\n\n【文本】\n${text.slice(0, 12000)}`
  switch (type) {
    case 'knowledge':
      return `${head}\n\n请输出 {"title": "文档标题（≤30字）", "summary": "一句话摘要（≤60字）", "content": "原文要点整理（≤2000字，结构化）"}`
    case 'world':
      return `${head}\n\n请输出 {"name": "世界名（≤20字）", "manual": {"力量体系": "…", "社会结构": "…", "地理": "…", "历史脉络": "…"}, "factions": ["势力1：描述", "势力2：描述"]}`
    case 'mode':
      return `${head}\n\n请输出 {"name": "模式名（≤20字）", "description": "一句话（≤40字）", "pattern": {"cadence": "节奏建议（推进/舒缓/断章）", "density": "爽点密度建议", "beats": ["黄金三章要点", "断章钩子要点"]}}`
    case 'style':
      return `${head}\n\n请输出 {"name": "写法名（≤20字）", "features": [{"category": "叙事/描写/对话/节奏/用词", "name": "特征名", "description": "特征描述（≤80字）"}], "antiAiWords": ["提炼出的 AI 腔词（若无则空数组）"]}`
    case 'genre':
      return `${head}\n\n请输出 {"name": "流派名（≤20字）", "genreType": "题材类型（如 都市/仙侠/悬疑）", "propulsion": ["推进方式"], "payoff": ["兑现方式"], "conflict": ["冲突类型"], "beats": ["黄金三章要点", "断章钩子要点"]}`
    case 'base-character':
      return `${head}\n\n请输出 {"name": "角色名（≤20字）", "role": "主角/配角/反派", "identity": "身份（≤40字）", "personality": "性格（≤60字）", "goal": "目标（≤40字）", "weakness": "弱点（≤40字）", "relation": "与主角关系（≤40字）"}`
    case 'title':
      return `${head}\n\n请输出 {"titles": [{"title": "书名", "reason": "理由（≤20字）"}]}，共 10 个，风格多样（悬念/爽感/文艺/直白）`
    case 'anti-ai':
      return `${head}\n\n请输出 {"name": "词库名（≤20字，如：模板腔检测）", "words": ["AI 腔词汇/句式（≤30字每个）"]}，提炼文本中的模板化表达，10-30 个`
  }
}

const parseGeneric = (obj: unknown): Record<string, unknown> | null =>
  obj && typeof obj === 'object' ? (obj as Record<string, unknown>) : null

export async function extractAsset(
  db: DatabaseSync,
  type: AssetType,
  text: string,
  title?: string
): Promise<ExtractResult> {
  if (!text.trim()) throw new Error('文本为空')
  const draft = await callLlmJson<Record<string, unknown>>(
    db,
    'extraction',
    {
      novelId: null as unknown as number,
      messages: [{ role: 'user', content: promptFor(type, title ?? '', text) }],
      maxTokens: 4096
    },
    parseGeneric,
    `asset-extract-${type}`
  )
  return { type, draft }
}

// ---------- 文件导入解析（TXT / MD / EPUB） ----------

/** 按章节标题（第X章/Chapter N）或空行分段；返回 { title, chapters: [{title, content}] } */
export function splitChapters(text: string): Array<{ title: string; content: string }> {
  const lines = text.split(/\r?\n/)
  const chapters: Array<{ title: string; content: string }> = []
  let current: { title: string; content: string[] } | null = null
  let hasTitleMatch = false
  const titleRe = /^\s*(第\s*[0-9一二三四五六七八九十百千零两]+\s*[章节回卷部集][^：:。]{0,30}|Chapter\s+\d+[^:：]{0,30}|楔子|序章|番外|后记)\s*[:：]?\s*(.*)$/i
  for (const line of lines) {
    const t = line.trim()
    const m = t.match(titleRe)
    if (m && (t.length < 40 || m[1])) {
      hasTitleMatch = true
      if (current) chapters.push({ title: current.title, content: current.content.join('\n') })
      current = { title: m[0].trim(), content: [] }
    } else if (current) {
      current.content.push(line)
    } else if (t) {
      // 未匹配标题前的内容归入开头段（后续若出现标题则成为第一章）
      current = { title: hasTitleMatch ? '开头' : '片段 1', content: [line] }
    }
  }
  if (current) chapters.push({ title: current.title, content: current.content.join('\n') })
  // 无标题匹配 → 按空行分段
  if (!hasTitleMatch) {
    const paras = text.split(/\n\s*\n/).filter((p) => p.trim())
    return paras.slice(0, 300).map((p, i) => ({ title: `片段 ${i + 1}`, content: p.trim().slice(0, 2000) }))
  }
  return chapters.slice(0, 300)
}

/** EPUB 解析（epub2：createAsync → flow 章节列表 → getChapterAsync 逐章取文本） */
export async function parseEpub(buffer: Buffer): Promise<string> {
  try {
    const { EPub } = await import('epub2')
    const epub = await EPub.createAsync(buffer as unknown as string)
    const flow = (epub as unknown as { flow: Array<{ id: string }> }).flow
    const parts: string[] = []
    for (const item of flow) {
      try {
        const text = await epub.getChapterAsync(item.id)
        parts.push(String(text ?? ''))
      } catch {
        /* 单章失败跳过 */
      }
    }
    const text = stripHtmlTags(parts.join('\n\n')).trim()
    if (text.length < 100) throw new Error('EPUB 内容过少或为空')
    return text
  } catch (err) {
    throw new Error(`EPUB 解析失败（${err instanceof Error ? err.message : String(err)}）。可尝试先导出为 TXT/MD 再导入。`)
  }
}
