import type { DatabaseSync } from 'node:sqlite'
import { getSystemPrompt } from '../prompts/promptAsset'
import { getBoundStyleRules } from './styleEngine'
import { smartContextText, type SmartContext } from './smartContext'
import type { LlmMessage } from './llm'
import { TfidfRetriever } from './retrieval'

// 前缀冻结组装器（PLAN §3.3）
// [冻结前缀区] 系统提示 → 书级合约(framing) → 世界观手册 → 角色账本(按参与者筛选)
// [可变区]    本章任务单 → 前文滚动摘要
//
// token 预算守卫：中文按 1 字 ≈ 1.2 token 粗估；超限裁剪顺序：
// 前文摘要 → 角色账本 → 世界观手册（书级合约不可裁剪）

export interface CharacterLedgerEntry {
  id: number
  name: string
  status: string
  profile: string
}

export interface FrozenContext {
  contract: string
  world: string
  characters: string
  external?: string // P4 外部资料直塞
  hash: string
}

/**
 * C1：读取书级智能上下文（若已生成）
 */
function getSmartContext(db: DatabaseSync, novelId: number): SmartContext | null {
  const novel = db.prepare('SELECT framing_json FROM novel WHERE id = ?').get(novelId) as
    | { framing_json: string }
    | undefined
  const framing = JSON.parse(novel?.framing_json ?? '{}') as { smartContext?: SmartContext }
  return framing.smartContext ?? null
}

function hashOf(s: string): string {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(36)
}

function truncate(text: string, maxChars: number): string {
  if (maxChars <= 0) return ''
  if (text.length <= maxChars) return text
  return text.slice(0, maxChars) + '…[已截断]'
}

function estimateTokens(text: string): number {
  // 中文为主：1 汉字 ≈ 1.2 token；其余字符 ≈ 0.4 token
  const cjk = (text.match(/[\u4e00-\u9fff]/g) ?? []).length
  const other = text.length - cjk
  return Math.ceil(cjk * 1.2 + other * 0.4)
}

function getNovel(db: DatabaseSync, novelId: number): {
  title: string
  framing_json: string
} | null {
  return db.prepare('SELECT title, framing_json FROM novel WHERE id = ?').get(novelId) as never
}

function getWorld(db: DatabaseSync, novelId: number): string {
  const row = db
    .prepare('SELECT manual_json, factions_json, map_json, timeline_json FROM world WHERE novel_id = ?')
    .get(novelId) as
    | { manual_json: string; factions_json: string; map_json: string; timeline_json: string }
    | undefined
  if (!row) return ''
  const parts: string[] = []
  const manual = JSON.parse(row.manual_json || '{}') as Record<string, unknown>
  if (Object.keys(manual).length > 0) {
    parts.push('【世界观手册】')
    for (const [k, v] of Object.entries(manual)) {
      parts.push(`- ${k}：${typeof v === 'string' ? v : JSON.stringify(v)}`)
    }
  }
  const factions = JSON.parse(row.factions_json || '[]') as Array<{ name: string; desc: string }>
  if (factions.length > 0) {
    parts.push('【势力】')
    for (const f of factions) parts.push(`- ${f.name}：${f.desc}`)
  }
  return parts.join('\n')
}

function getCharacters(db: DatabaseSync, novelId: number, limit = 12): string {
  const rows = db
    .prepare(
      `SELECT name, profile_json, status, ledger_json FROM character
       WHERE novel_id = ? ORDER BY CASE status WHEN 'roster' THEN 0 ELSE 1 END, id LIMIT ?`
    )
    .all(novelId, limit) as Array<{
    name: string
    profile_json: string
    status: string
    ledger_json: string
  }>
  const lines: string[] = []
  for (const r of rows) {
    const p = JSON.parse(r.profile_json || '{}') as {
      identity?: string
      personality?: string
      goal?: string
    }
    const ledger = JSON.parse(r.ledger_json || '{}') as { states?: string[] }
    const meta = [p.identity, p.personality, p.goal].filter(Boolean).join('；')
    let line = `- ${r.name}${r.status === 'pending' ? '（待确认）' : ''}：${meta}`
    // 回灌闭环：角色当前状态（已确认入账）注入上下文，保持跨章连续性
    if (ledger.states && ledger.states.length > 0) {
      line += `\n  当前状态：${ledger.states.join('；')}`
    }
    lines.push(line)
  }
  return lines.join('\n')
}

// P13 G2：本章参与者精准筛选（从任务单提取人名 → 匹配名册 → 注入详情）
// 冻结区保持全量摘要（缓存纪律），此函数用于可变区"本章角色特写"省 token
export function getCharactersForChapter(
  db: DatabaseSync,
  novelId: number,
  chapterId: number,
  limit = 6
): string {
  const chapter = db
    .prepare('SELECT goal_json FROM chapter WHERE id = ? AND novel_id = ?')
    .get(chapterId, novelId) as { goal_json: string } | undefined
  if (!chapter) return ''
  const goalText = String(chapter.goal_json ?? '')
  if (!goalText || goalText === '{}') return ''

  const rows = db
    .prepare(
      `SELECT name, profile_json, status, ledger_json FROM character
       WHERE novel_id = ? ORDER BY CASE status WHEN 'roster' THEN 0 ELSE 1 END, id`
    )
    .all(novelId) as Array<{
    name: string
    profile_json: string
    status: string
    ledger_json: string
  }>

  // 匹配：任务单全文包含角色名（含后缀"说/想/走向"等去尾匹配）
  const matched = rows.filter((r) => {
    const name = r.name.trim()
    if (!name || name.length < 2) return false
    if (goalText.includes(name)) return true
    // 去常见后缀再匹配（"苏晚的"/"林默说"）
    return goalText.includes(name.replace(/[的了说想望到进走看]/g, ''))
  })

  const pool = matched.length >= 2 ? matched : matched.concat(rows.filter((r) => r.status === 'roster')).slice(0, limit)
  const chosen = pool.slice(0, limit)
  if (chosen.length === 0) return ''

  const lines: string[] = []
  for (const r of chosen) {
    const p = JSON.parse(r.profile_json || '{}') as {
      identity?: string
      personality?: string
      goal?: string
      weakness?: string
    }
    const ledger = JSON.parse(r.ledger_json || '{}') as { states?: string[] }
    const meta = [p.identity, p.personality, p.goal, p.weakness].filter(Boolean).join('；')
    let line = `- ${r.name}：${meta}`
    if (ledger.states && ledger.states.length > 0) {
      line += `\n  当前状态：${ledger.states.join('；')}`
    }
    lines.push(line)
  }
  return `【本章角色特写（${chosen.map((r) => r.name).join('、')}）】\n${lines.join('\n')}`
}

/**
 * P4 外部资料直塞注入（替代 RAG 的低成本方案）：
 * kb_doc 中 status='direct' 的文档注入冻结前缀区（复用缓存机制）
 */
// P17-5B：知识库检索（TF-IDF，按相关性 Top-K 注入可变区）
const kbCache = new Map<number, { version: number; retriever: TfidfRetriever }>()

export function getKnowledgeRetrieval(db: DatabaseSync, novelId: number, query: string): string | null {
  if (!query.trim()) return null
  const docs = db
    .prepare("SELECT id, title, content FROM kb_doc WHERE novel_id = ? AND content != '' ORDER BY id")
    .all(novelId) as Array<{ id: number; title: string; content: string }>
  if (docs.length === 0) return null

  let cached = kbCache.get(novelId)
  if (!cached) {
    cached = { version: 0, retriever: new TfidfRetriever() }
    kbCache.set(novelId, cached)
  }
  if (cached.version !== docs.length) {
    cached.retriever.indexNow(docs.map((d) => ({ id: d.id, title: d.title, content: d.content })))
    cached.version = docs.length
  }
  const hits = cached.retriever.searchNow(query, 3)
  if (hits.length === 0) return null
  const parts = hits.map((h) => `- 《${h.title}》：${h.content.slice(0, 400)}`)
  return `【知识库检索（按相关性）】\n${parts.join('\n')}`
}function getExternalMaterials(db: DatabaseSync, novelId: number, maxChars = 6000): string {
  const rows = db
    .prepare(
      "SELECT title, content FROM kb_doc WHERE novel_id = ? AND status = 'direct' ORDER BY id LIMIT 5"
    )
    .all(novelId) as Array<{ title: string; content: string }>
  if (rows.length === 0) return ''
  const parts: string[] = []
  let total = 0
  for (const r of rows) {
    if (total >= maxChars) break
    const chunk = `【参考资料·${r.title}】\n${r.content.slice(0, Math.min(2000, maxChars - total))}`
    parts.push(chunk)
    total += chunk.length
  }
  return parts.join('\n\n')
}

/**
 * 回灌闭环：未回收伏笔 + 已确认事实（章节 N 之前的回灌产物）→ 生成上下文可变区
 */
function getContinuityState(db: DatabaseSync, novelId: number, beforeChapterId: number): string {
  const parts: string[] = []
  const foreshadows = db
    .prepare(
      `SELECT content FROM foreshadow
       WHERE novel_id = ? AND status = 'laid' AND (chapter_id IS NULL OR chapter_id < ?)
       ORDER BY id LIMIT 10`
    )
    .all(novelId, beforeChapterId) as Array<{ content: string }>
  if (foreshadows.length > 0) {
    parts.push('【未回收伏笔（写作时酌情呼应，不得遗忘）】')
    for (const f of foreshadows) parts.push(`- ${f.content}`)
  }
  const facts = db
    .prepare(
      `SELECT content FROM fact
       WHERE novel_id = ? AND confirmed = 1 AND (chapter_id IS NULL OR chapter_id < ?)
       ORDER BY id LIMIT 15`
    )
    .all(novelId, beforeChapterId) as Array<{ content: string }>
  if (facts.length > 0) {
    parts.push('【已确认事实（必须遵守，不得矛盾）】')
    for (const f of facts) parts.push(`- ${f.content}`)
  }
  return parts.join('\n')
}

/**
 * 流派/爽点约束注入：按 novel framing 题材匹配 genre_asset，注入 beat_templates/payoff
 */
function getGenreConstraints(db: DatabaseSync, novelId: number): string {
  const novel = db.prepare('SELECT framing_json FROM novel WHERE id = ?').get(novelId) as
    | { framing_json: string }
    | undefined
  const framing = JSON.parse(novel?.framing_json ?? '{}') as Record<string, unknown>
  const genreText = String(
    (framing as { genre?: unknown }).genre ?? (framing as { summary?: string }).summary ?? ''
  )
  const presets = db
    .prepare('SELECT name, genre_type, beat_templates_json, payoff_json FROM genre_asset WHERE novel_id IS NULL')
    .all() as Array<{ name: string; genre_type: string; beat_templates_json: string; payoff_json: string }>
  const match = presets.find(
    (g) => g.genre_type && genreText.includes(g.genre_type)
  ) ?? (presets.length > 0 ? presets[0] : null)
  if (!match) return ''
  const beats = JSON.parse(match.beat_templates_json || '[]') as string[]
  const payoffs = JSON.parse(match.payoff_json || '[]') as string[]
  const parts: string[] = []
  if (beats.length > 0) {
    parts.push(`【流派节奏模板（${match.name}）】`)
    for (const b of beats) parts.push(`- ${b}`)
  }
  if (payoffs.length > 0) {
    parts.push(`【爽点兑现方式】`)
    for (const p of payoffs) parts.push(`- ${p}`)
  }
  return parts.join('\n')
}

function getChapterSummary(db: DatabaseSync, novelId: number, beforeChapterId: number): string {
  // 前 3 章摘要（标题 + 一句话摘要）
  const rows = db
    .prepare(
      `SELECT title, summary FROM chapter
       WHERE novel_id = ? AND id < ? AND status IN ('done', 'reviewed', 'written')
       ORDER BY id DESC LIMIT 3`
    )
    .all(novelId, beforeChapterId) as Array<{ title: string; summary: string }>
  if (rows.length === 0) return ''
  const lines = rows.reverse().map((r) => `- 《${r.title}》：${r.summary || '（无摘要）'}`)
  return `【前文回顾】\n${lines.join('\n')}`
}

export function buildFrozenContext(db: DatabaseSync, novelId: number): FrozenContext {
  const novel = getNovel(db, novelId)
  const contract = novel ? `【书级合约】\n${novel.framing_json}` : ''
  const world = getWorld(db, novelId)
  const characters = getCharacters(db, novelId)
  // P4：外部资料直塞（status='direct'）注入冻结区
  const external = getExternalMaterials(db, novelId)
  return {
    contract,
    world,
    characters,
    external,
    hash: hashOf(contract + '\n' + world + '\n' + characters + '\n' + external)
  }
}

export interface ChapterWriteContext {
  messages: LlmMessage[]
  frozenHash: string
  budgetUsed: number
  budgetLimit: number
}

/**
 * 组装章节正文生成上下文（前缀冻结 + 预算守卫）
 */
export function buildChapterWriteContext(
  db: DatabaseSync,
  novelId: number,
  chapterId: number,
  opts: { budgetTokens?: number; tripleConstraints?: string[]; include?: string[] } = {}
): ChapterWriteContext {
  const budgetLimit = opts.budgetTokens ?? 12_000
  const frozen = buildFrozenContext(db, novelId)

  // B1：include 过滤（用户可开关注入段，默认全开）
  const include = opts.include
  const has = (key: string): boolean => !include || include.includes(key)

  const chapter = db
    .prepare('SELECT title, summary, goal_json FROM chapter WHERE id = ? AND novel_id = ?')
    .get(chapterId, novelId) as
    | { title: string; summary: string; goal_json: string }
    | undefined
  if (!chapter) throw new Error(`chapter ${chapterId} not found`)

  const taskSheet = [
    '【本章任务单】',
    `章节名：${chapter.title || '（待定）'}`,
    `摘要：${chapter.summary || ''}`,
    `目标：${chapter.goal_json || '{}'}`
  ].join('\n')

  const priorSummary = getChapterSummary(db, novelId, chapterId)
  // C1：智能上下文优先于前文回顾（更精炼省 token）
  const smartCtx = getSmartContext(db, novelId)
  const summaryText = smartCtx ? smartContextText(smartCtx) : priorSummary
  // 回灌闭环 + 爽点约束（P1.5）
  const continuity = getContinuityState(db, novelId, chapterId)
  const genreConstraints = getGenreConstraints(db, novelId)

  // 冻结前缀区（按优先级：合约 > 世界观 > 角色 > 外部资料；B1 include 过滤）
  let frozenText = getSystemPrompt('prose')
  if (frozen.contract && has('contract')) frozenText += '\n\n' + frozen.contract
  if (frozen.world && has('world')) frozenText += '\n\n' + frozen.world
  if (frozen.characters && has('characters')) frozenText += '\n\n【角色账本】\n' + frozen.characters
  if (frozen.external && has('external')) frozenText += '\n\n' + frozen.external

  // 可变区（顺序：连续性状态 → 流派约束 → 三方会审约束 → 写法规则 → 任务单 → 前文摘要；B1 过滤）
  let variableText = ''
  if (continuity && has('continuity')) variableText += continuity + '\n\n'
  if (genreConstraints && has('genre')) variableText += genreConstraints + '\n\n'
  if (opts.tripleConstraints && opts.tripleConstraints.length > 0 && has('triple')) {
    variableText += '【本章三方会审约束（必须遵守）】\n' + opts.tripleConstraints.join('\n') + '\n\n'
  }
  // P4：绑定写法规则 + 反 AI 词（注入生成）
  const styleRules = getBoundStyleRules(db, novelId)
  if (styleRules && styleRules.rules.length > 0 && has('style')) {
    variableText += '【绑定写法要求（必须遵守）】\n' + [...styleRules.rules, ...styleRules.antiAiRules].join('\n') + '\n\n'
  }
  // P13 G2：本章角色特写（精准筛选参与者详情，置于任务单前）
  const chapterSpotlight = getCharactersForChapter(db, novelId, chapterId)
  if (chapterSpotlight && has('characters')) {
    variableText += chapterSpotlight + '\n\n'
  }
  // P17-5B：知识库检索注入（TF-IDF 按相关性 Top-K，无相关不注入省 token）
  if (has('kb')) {
    const kbRetrieval = getKnowledgeRetrieval(db, novelId, `${chapter?.title ?? ''} ${chapter?.summary ?? ''} ${chapter?.goal_json ?? ''}`)
    if (kbRetrieval) variableText += kbRetrieval + '\n\n'
  }
  variableText += taskSheet
  if (summaryText && has('summary')) variableText += '\n\n' + summaryText

  // 预算守卫：先裁可变区摘要，再裁冻结区角色/世界观
  const frozenBudget = Math.floor(budgetLimit * 0.8)
  const variableBudget = budgetLimit - frozenBudget

  if (estimateTokens(variableText) > variableBudget) {
    // 优先压缩前文回顾
    const priorIdx = variableText.indexOf('【前文回顾】')
    if (priorIdx > 0) {
      variableText = variableText.slice(0, priorIdx).trimEnd()
    }
    if (estimateTokens(variableText) > variableBudget) {
      variableText = truncate(variableText, Math.floor((variableBudget / 1.2) * 0.8))
    }
  }

  if (estimateTokens(frozenText) > frozenBudget) {
    // 先裁角色账本段
    const charIdx = frozenText.indexOf('【角色账本】')
    if (charIdx > 0) {
      frozenText = frozenText.slice(0, charIdx).trimEnd()
    }
    if (estimateTokens(frozenText) > frozenBudget) {
      // 再裁世界观
      const worldIdx = frozenText.indexOf('【世界观手册】')
      if (worldIdx > 0) {
        frozenText = frozenText.slice(0, worldIdx).trimEnd()
      }
    }
    if (estimateTokens(frozenText) > frozenBudget) {
      frozenText = truncate(frozenText, Math.floor((frozenBudget / 1.2) * 0.9))
    }
  }

  const finalText = `${frozenText}\n\n${variableText}\n\n请直接输出本章正文。`

  return {
    messages: [{ role: 'user', content: finalText }],
    frozenHash: frozen.hash,
    budgetUsed: estimateTokens(finalText),
    budgetLimit
  }
}

export function buildChapterReviewContext(
  db: DatabaseSync,
  novelId: number,
  chapterId: number,
  content: string
): LlmMessage[] {
  const chapter = db
    .prepare('SELECT title, summary, goal_json FROM chapter WHERE id = ?')
    .get(chapterId) as { title: string; summary: string; goal_json: string } | undefined
  const frozen = buildFrozenContext(db, novelId)
  const taskSheet = chapter
    ? `【本章任务单】\n章节名：${chapter.title}\n摘要：${chapter.summary}\n目标：${chapter.goal_json}`
    : ''
  const text = [
    getSystemPrompt('review'),
    frozen.contract,
    frozen.world ? `\n${frozen.world}` : '',
    frozen.characters ? `\n【角色账本】\n${frozen.characters}` : '',
    `\n${taskSheet}`,
    `\n【章节正文】\n${content}`,
    '\n请输出审核 JSON：{"score": 0-100, "strengths": [..], "issues": [{"severity":"high|medium|low","location":"..","problem":"..","suggestion":".."}], "needsFix": true|false}'
  ].join('\n')
  return [{ role: 'user', content: text }]
}

export function buildBackfillContext(
  db: DatabaseSync,
  novelId: number,
  chapterId: number,
  content: string
): LlmMessage[] {
  const chapter = db
    .prepare('SELECT title, summary FROM chapter WHERE id = ?')
    .get(chapterId) as { title: string; summary: string } | undefined
  const frozen = buildFrozenContext(db, novelId)
  const text = [
    getSystemPrompt('backfill'),
    frozen.contract,
    frozen.world ? `\n${frozen.world}` : '',
    frozen.characters ? `\n【角色账本】\n${frozen.characters}` : '',
    `\n【本章】${chapter?.title ?? ''}：${chapter?.summary ?? ''}`,
    `\n【章节正文】\n${content}`,
    '\n请输出 JSON：{"characterStates":[{"name":"..","state":"位置/情绪/实力/关系变化"}],"newFacts":[{"content":".."}],"foreshadows":[{"content":"..","hint":"回收线索"}],"paidForeshadows":[{"content":".."}]}'
  ].join('\n')
  return [{ role: 'user', content: text }]
}

export function buildFixContext(
  _db: DatabaseSync,
  _novelId: number,
  chapterId: number,
  content: string,
  issues: unknown[]
): LlmMessage[] {
  const text = [
    getSystemPrompt('fix'),
    `【审核问题清单】\n${JSON.stringify(issues, null, 2)}`,
    `【原章节正文】\n${content}`,
    // P14 D：必须含 "json" 字样（json_object response_format 硬要求，DeepSeek/网关 400 规则）
    '\n请输出 JSON：{"content": "修改后的完整正文（只修正问题，不改变剧情走向与文风）"}'
  ].join('\n')
  void chapterId
  return [{ role: 'user', content: text }]
}

/**
 * P2.1 修复 #4：局部补丁上下文（patch_first 策略）
 * LLM 输出 patches（target 逐字匹配 + replacement），代码替换
 */
export function buildPatchContext(
  _db: DatabaseSync,
  _novelId: number,
  chapterId: number,
  content: string,
  issues: unknown[]
): LlmMessage[] {
  const text = [
    getSystemPrompt('patch'),
    `【审核问题清单】\n${JSON.stringify(issues, null, 2)}`,
    `【原章节正文】\n${content}`,
    '\n请输出 {"patches": [...]}（纯 JSON，不要解释）。'
  ].join('\n')
  void chapterId
  return [{ role: 'user', content: text }]
}

/**
 * P2.1 修复 #4：应用局部补丁到正文
 * 每个 patch 的 target 必须唯一逐字匹配；任一失败返回 null（调用方降级整章重写）
 */
export function applyPatches(content: string, patches: Array<{ target: string; replacement: string }>): string | null {
  let result = content
  for (const p of patches) {
    if (!p.target || !p.replacement) continue
    const idx = result.indexOf(p.target)
    if (idx < 0) return null // target 未匹配 → 降级
    // 检查唯一性（替换后再次出现说明不唯一）
    const rest = result.slice(idx + p.target.length)
    if (rest.includes(p.target)) return null
    result = result.slice(0, idx) + p.replacement + rest
  }
  // 无有效 patch 视为失败
  return result === content ? null : result
}
