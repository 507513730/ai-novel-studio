// 上下文域可变区与各链路上下文组装（重构计划 R6.1）：
// [可变区] 本次引导 → 连续性状态 → 流派约束 → 三方会审 → 写法规则 → 角色特写 → 知识库检索 →
//          当前定位 → 时间线 → 本章任务单 → 前文摘要
// 预算守卫与裁剪顺序受 context-contract 测试锁定；RAG（TF-IDF）为条件启用，direct 资料排除。
import type { DatabaseSync } from 'node:sqlite'
import { getSystemPrompt } from '../../prompts/promptAsset'
import { getBoundStyleRules } from '../styleEngine'
import { smartContextText, type SmartContext } from '../smartContext'
import type { LlmMessage } from '../llm/types'
import { TfidfRetriever } from '../retrieval'
import { constraintsBlock } from '../constraintEngine'
import { buildFrozenContext } from './frozen'
import { estimateTokens, hashOf, truncate } from './hash'
import { trimFromEnd } from './budget'
import type { ChapterWriteContext } from './types'

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

// P17-5B：知识库检索（TF-IDF，按相关性 Top-K 注入可变区）
// P20（D2）：缓存失效键从"文档条数"升级为"数量+内容 hash"——编辑/删一加一即重建索引
// v0.9.0（审查 #10）：版本键用全量内容 hash——此前只覆盖前 200 字符，改 200 字符之后的内容不失效缓存
// v0.9.0（审查 D）：LRU 驱逐（上限 50 本书），防 kbCache 无界增长
const kbCache = new Map<number, { version: string; retriever: TfidfRetriever }>()
const KB_CACHE_MAX = 50
function kbCacheGet(novelId: number): { version: string; retriever: TfidfRetriever } | undefined {
  const cached = kbCache.get(novelId)
  if (cached) {
    kbCache.delete(novelId)
    kbCache.set(novelId, cached) // 触达即刷新（LRU 语义）
  }
  if (kbCache.size > KB_CACHE_MAX) {
    const oldest = kbCache.keys().next().value
    if (oldest !== undefined) kbCache.delete(oldest)
  }
  return cached
}

export function getKnowledgeRetrieval(db: DatabaseSync, novelId: number, query: string): string | null {
  if (!query.trim()) return null
  // P20（D7）：status='direct' 的直塞资料排除（已走冻结区直塞，避免双份进提示词）
  // 写书修复（2026-08-12）：全局知识库（novel_id=0）对所有书可见（IN (0, ?)）
  const docs = db
    .prepare(
      "SELECT id, title, content FROM kb_doc WHERE novel_id IN (0, ?) AND content != '' AND status != 'direct' ORDER BY id"
    )
    .all(novelId) as Array<{ id: number; title: string; content: string }>
  if (docs.length === 0) return null

  const versionKey = `${docs.length}:${hashOf(docs.map((d) => `${d.id}:${hashOf(d.content)}`).join('|'))}`
  let cached = kbCacheGet(novelId)
  if (!cached) {
    cached = { version: '', retriever: new TfidfRetriever() }
    kbCache.set(novelId, cached)
  }
  if (cached.version !== versionKey) {
    cached.retriever.indexNow(docs.map((d) => ({ id: d.id, title: d.title, content: d.content })))
    cached.version = versionKey
  }
  const hits = cached.retriever.searchNow(query, 3)
  if (hits.length === 0) return null
  const parts = hits.map((h) => `- 《${h.title}》：${h.content.slice(0, 400)}`)
  return `【知识库检索（按相关性）】\n${parts.join('\n')}`
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

// P19 ⑥：当前定位（卷战略 → 节拍 → 本章目标），限量 600 字；查不到任何信息返回空串
// v0.13.0（批E/I4）：时间线消费——最近 N 条全书事件（timeline_event 表此前只写不读，
// 现作为世界状态机的"事件记忆"层注入可变区；按章过滤 chapter_id <= 当前章）
function getTimelineEvents(db: DatabaseSync, novelId: number, chapterId: number, limit = 5): string {
  const rows = db
    .prepare(
      `SELECT content, time_ref FROM timeline_event
       WHERE novel_id = ? AND chapter_id <= ? ORDER BY id DESC LIMIT ?`
    )
    .all(novelId, chapterId, limit) as Array<{ content: string; time_ref: string }>
  if (rows.length === 0) return ''
  const lines = rows
    .reverse()
    .map((r) => `- ${r.content}${r.time_ref ? `（${r.time_ref}）` : ''}`)
  return `【时间线（最近事件）】\n${lines.join('\n')}`
}

export function getChapterLocation(db: DatabaseSync, chapterId: number): string {
  const chapter = db
    .prepare('SELECT volume_id, beat_id, goal_json FROM chapter WHERE id = ?')
    .get(chapterId) as { volume_id: number | null; beat_id: number | null; goal_json: string } | undefined
  if (!chapter) return ''
  const parts: string[] = []
  if (chapter.volume_id) {
    const vol = db
      .prepare('SELECT title, strategy_json FROM volume WHERE id = ?')
      .get(chapter.volume_id) as { title: string; strategy_json: string } | undefined
    if (vol) {
      const strategy = JSON.parse(vol.strategy_json || '{}') as {
        theme?: string
        coreConflict?: string
        payoff?: string
      }
      const volLine = [`本卷：${vol.title}`]
      if (strategy.theme) volLine.push(`主题：${strategy.theme}`)
      if (strategy.coreConflict) volLine.push(`核心冲突：${strategy.coreConflict}`)
      parts.push('【当前定位】' + volLine.join('；'))
    }
  }
  if (chapter.beat_id) {
    const beat = db
      .prepare('SELECT title, summary FROM beat WHERE id = ?')
      .get(chapter.beat_id) as { title: string; summary: string } | undefined
    if (beat) {
      parts.push(`所属节拍：${beat.title}${beat.summary ? `（${beat.summary.slice(0, 80)}）` : ''}`)
    }
  } else if (chapter.volume_id) {
    const beats = db
      .prepare('SELECT title FROM beat WHERE volume_id = ? ORDER BY order_index LIMIT 5')
      .all(chapter.volume_id) as Array<{ title: string }>
    if (beats.length > 0) parts.push(`本卷节奏序列：${beats.map((b) => b.title).join(' → ')}`)
  }
  const goal = JSON.parse(chapter.goal_json || '{}') as { title?: string; goal?: string; scenes?: unknown[] }
  if (goal.title || goal.goal) {
    const goalParts = [`本章目标：${goal.goal || goal.title || ''}`]
    if (Array.isArray(goal.scenes)) goalParts.push(`计划场景数：${goal.scenes.length}`)
    parts.push(goalParts.join('；'))
  }
  return parts.join('\n').slice(0, 600)
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

/**
 * 组装章节正文生成上下文（前缀冻结 + 预算守卫）
 */
export function buildChapterWriteContext(
  db: DatabaseSync,
  novelId: number,
  chapterId: number,
  opts: { budgetTokens?: number; tripleConstraints?: string[]; include?: string[]; perCallGuidance?: string } = {}
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

  // 冻结前缀区（按优先级：合约 > 世界观 > 角色 > 外部资料 > 书级引导 > 写作要求；B1 include 过滤）
  let frozenText = getSystemPrompt('prose')
  // v0.15.0：硬约束最高优先（用户强调的事项——主角名/红线，任何产出不得违反）
  if (has('contract')) {
    const cBlock = constraintsBlock(db, novelId)
    if (cBlock) frozenText += '\n\n' + cBlock
  }
  if (frozen.contract && has('contract')) frozenText += '\n\n' + frozen.contract
  if (frozen.world && has('world')) frozenText += '\n\n' + frozen.world
  if (frozen.characters && has('characters')) frozenText += '\n\n【角色账本】\n' + frozen.characters
  if (frozen.external && has('external')) frozenText += '\n\n【外部资料】\n' + frozen.external
  // P19 ①：书级引导注入冻结区（改引导→hash 变→缓存失效，语义正确）
  if (frozen.guidance) frozenText += '\n\n【创作引导】\n' + frozen.guidance
  // P19 ②⑤：写作偏好规则注入冻结区（非默认才注入；改设置→hash 变→缓存失效）
  if (frozen.writingRules) frozenText += '\n\n【写作要求】\n' + frozen.writingRules

  // 可变区（顺序：本次引导 → 连续性状态 → 流派约束 → 三方会审 → 写法规则 → 任务单 → 前文摘要；B1 过滤）
  let variableText = ''
  // P19 ①：本次引导（单次，仅本请求；追加在前保持模型关注）
  if (opts.perCallGuidance) variableText += '【本次引导】\n' + opts.perCallGuidance + '\n\n'
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
  // P19 ⑥：当前定位（卷战略 → 节拍 → 本章目标 4 级聚焦，限量 600 字）
  if (has('location')) {
    const location = getChapterLocation(db, chapterId)
    if (location) variableText += location + '\n\n'
  }
  // v0.13.0（批E/I4）：时间线消费——全书已发生事件的结构化记忆（timeline_event 表此前只写不读）
  if (has('summary')) {
    const timeline = getTimelineEvents(db, novelId, chapterId, 5)
    if (timeline) variableText += timeline + '\n\n'
  }
  variableText += taskSheet
  if (summaryText && has('summary')) variableText += '\n\n' + summaryText

  // 预算守卫（P20 C5/C6：从尾部向头部逐段裁剪，高价值段（引导/约束/任务单）最后才裁）
  const frozenBudget = Math.floor(budgetLimit * 0.8)
  const variableBudget = budgetLimit - frozenBudget

  // 冻结区裁剪顺序（尾→头：写作要求 → 引导 → 外部资料 → 角色账本 → 世界观 → 合约）
  const FROZEN_TRIM_ORDER = ['【写作要求】', '【创作引导】', '【外部资料】', '【角色账本】', '【世界观手册】']
  // 可变区裁剪顺序（先裁尾部低价值：前文回顾 → 知识库 → 定位 → 写法规则 → 约束 → 连续性 → 本次引导；
  // 任务单永不整段裁，极端超限只截 head 保 tail）
  const VARIABLE_TRIM_ORDER = [
    '【前文回顾】',
    '【时间线（最近事件）】',
    '【知识库检索（按相关性）】',
    '【当前定位】',
    '【绑定写法要求（必须遵守）】',
    '【本章三方会审约束（必须遵守）】',
    '【未回收伏笔（写作时酌情呼应，不得遗忘）】',
    '【本次引导】'
  ]

  if (estimateTokens(variableText) > variableBudget) {
    variableText = trimFromEnd(variableText, VARIABLE_TRIM_ORDER, variableBudget)
    if (estimateTokens(variableText) > variableBudget) {
      // 极端超限：优先保留任务单段（旧实现 taskIdx=-1 时原样放行 = 预算守卫静默失效，已修复）
      const taskIdx = variableText.indexOf('【本章任务单】')
      const head = taskIdx > 0 ? variableText.slice(0, taskIdx) : ''
      const tail = taskIdx > 0 ? variableText.slice(taskIdx) : variableText
      variableText = head.slice(0, Math.floor((variableBudget / 1.2) * 0.5)) + tail
      // 无任务单段（任务单缺失/空章）：按预算硬截断尾部（逐段丢尾部，保留头部指令）
      while (estimateTokens(variableText) > variableBudget && variableText.length > 200) {
        variableText = variableText.slice(0, -200)
      }
    }
  }

  if (estimateTokens(frozenText) > frozenBudget) {
    frozenText = trimFromEnd(frozenText, FROZEN_TRIM_ORDER, frozenBudget)
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
    // v0.15.0：约束注入（修复/回灌链同样遵循硬约束）
    constraintsBlock(db, novelId),
    frozen.contract,
    frozen.world ? `\n${frozen.world}` : '',
    frozen.characters ? `\n【角色账本】\n${frozen.characters}` : '',
    `\n【本章】${chapter?.title ?? ''}：${chapter?.summary ?? ''}`,
    `\n【章节正文】\n${content}`,
    // v0.13.0（批E/I4）：势力状态提取——世界状态机的势力维度（factions 当前动态）
    '\n请输出 JSON：{"characterStates":[{"name":"..","state":"位置/情绪/实力/关系变化"}],"newFacts":[{"content":".."}],"foreshadows":[{"content":"..","hint":"回收线索"}],"paidForeshadows":[{"content":".."}],"factionStates":[{"name":"势力名","state":"当前状态/实力/立场变化"}]}'
  ].join('\n')
  return [{ role: 'user', content: text }]
}

export function buildFixContext(
  db: DatabaseSync,
  novelId: number,
  chapterId: number,
  content: string,
  issues: unknown[]
): LlmMessage[] {
  const text = [
    getSystemPrompt('fix'),
    // v0.15.0：约束注入（修复链不违背硬约束——如不改变主角名/红线）
    constraintsBlock(db, novelId),
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
