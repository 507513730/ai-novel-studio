import { DatabaseSync } from 'node:sqlite'
import { getRouteConfig, callLlm } from './llm'
import { buildChapterWriteContext, estimateTokens } from './context'
import { recordUsage } from './usage'
import { runTripleReview } from './tripleReview'
import { getBoundStyleRules, detectAntiAiHits, extractAntiAiWordsFromRules } from './styleEngine'
import { replaceProtagonistName, validateConstraints, recordConstraintViolation } from './constraintEngine'
import { callLlmJson } from './jsonSafe'

export interface GenerateOptions {
  signal?: AbortSignal
  onDelta?: (text: string) => void
  onThinking?: (text: string) => void
  tripleReview?: boolean // P2.3：三方会审开关（默认开）
  include?: string[] // B1：注入段过滤（contract/world/characters/continuity/genre/triple/style/summary/external）
  guidance?: string // P19 ①：本次引导（单次）
}

export interface GenerateResult {
  content: string
  wordCount: number
  aborted: boolean
  usage: { input: number; output: number; cacheHit: number; cacheMiss: number }
}

/**
 * 章节正文生成核心（SSE 路由与整本生产共用）
 * - 前缀冻结上下文（buildChapterWriteContext）
 * - thinking disabled 显式（D12）
 * - 支持中止（保留已生成部分）
 */
export async function generateChapter(
  db: DatabaseSync,
  novelId: number,
  chapterId: number,
  opts: GenerateOptions = {}
): Promise<GenerateResult> {
  const chapter = db
    .prepare('SELECT id, title, status FROM chapter WHERE id = ? AND novel_id = ?')
    .get(chapterId, novelId) as { id: number; title: string; status: string } | undefined
  if (!chapter) throw new Error('chapter not found')

  // P2.2 修复 #4：原子抢占（防同章并发生成 → 双写/双倍费用）
  const claimed = db
    .prepare(
      "UPDATE chapter SET status = 'generating', updated_at = datetime('now') WHERE id = ? AND novel_id = ? AND status NOT IN ('generating')"
    )
    .run(chapterId, novelId)
  if (Number(claimed.changes) === 0) {
    throw new Error('章节正在生成中（或状态不允许），请等待完成')
  }

  // v0.17.0（审查 H2）：抢占后全链路 try/catch——任何异常/空内容都复位状态，杜绝永久卡 'generating'
  try {
  const route = getRouteConfig(db, 'prose')
  if (!route || !route.apiKeyEncrypted) throw new Error('prose 路由未配置 API Key')

  // v0.9.2（审查 #25）：独立 OpenAI client 删除——统一走 callLlm 流式
  // （此前 generate 不参与候选链降级/错误分类/重试；body 构造已出现漂移）

  // P2.3 三方会审：主编/世界观/角色各产出一条约束注入生成上下文（默认开）
  let tripleConstraints: string[] = []
  if (opts.tripleReview !== false) {
    try {
      const chapter = db
        .prepare('SELECT title, summary, goal_json FROM chapter WHERE id = ? AND novel_id = ?')
        .get(chapterId, novelId) as { title: string; summary: string; goal_json: string } | undefined
      if (chapter) {
        const taskSheet = `章节名：${chapter.title}\n摘要：${chapter.summary}\n目标：${chapter.goal_json}`
      const review = await runTripleReview(db, novelId, taskSheet)
      tripleConstraints = [
        `【主编约束】${review.director}`,
        `【世界观约束】${review.world}`,
        `【角色约束】${review.character}`
      ]
      if (process.env.AI_NOVEL_DEBUG === '1') {
        console.log('[triple-review]', JSON.stringify(tripleConstraints, null, 2))
      }
      }
    } catch (err) {
      // P20（M7）：三方会审失败不阻塞生成（降级为无约束），但必须可见——不再静默
      console.warn(
        `[triple-review] 降级（本章无会审约束）: ${err instanceof Error ? err.message : String(err)}`
      )
    }
  }

  const ctx = buildChapterWriteContext(db, novelId, chapterId, {
    tripleConstraints,
    include: opts.include,
    perCallGuidance: opts.guidance
  })

  // v0.9.2（审查 #25）：统一走 callLlm 流式——候选链降级/错误分类/记账/signal 全部一致；
  // abort 时 callLlm 返回部分内容（不抛错），此处按 signal.aborted 感知
  const llmResult = await callLlm(db, 'prose', {
    novelId,
    messages: ctx.messages.map((m) => ({ role: m.role, content: m.content ?? '' })),
    maxTokens: route.maxTokens,
    temperature: route.temperature,
    stream: true,
    onDelta: (text) => opts.onDelta?.(text),
    onThinking: (text) => opts.onThinking?.(text),
    signal: opts.signal
  })

  const llmContent = llmResult.content
  // 反 AI 重写可能替换内容，故用 let
  let content = llmContent
  // v0.15.0：主角名约束替换（角色表主角名 ≠ 硬约束规范名时自动对齐）
  content = replaceProtagonistName(db, novelId, content)
  const aborted = opts.signal?.aborted ?? false
  // v0.23.1（批次 A4）：max_tokens 截断检测——截断的半章不再静默落库为 written，
  // 显式失败并提示调整（外层 catch 会复位 failed，可重试）
  if (!aborted && llmResult.truncated) {
    throw new Error(
      '生成被 max_tokens 截断（finish_reason=length）——请在设置 → 模型路由调大 max_tokens，或降低单章目标字数后重试'
    )
  }
  let usageInput = llmResult.usage.input
  let usageOutput = llmResult.usage.output
  let cacheHit = llmResult.usage.cacheHit
  let cacheMiss = llmResult.usage.cacheMiss

  let wordCount = (content.match(/[\u4e00-\u9fff]/g) ?? []).length
  if (content) {
    db.prepare('INSERT INTO chapter_version (chapter_id, content, note) VALUES (?, ?, ?)').run(
      chapterId,
      content,
      aborted ? 'AI 生成（中止）' : 'AI 生成'
    )
    // v0.22.0（审查 N1·本地设计决策）：整章替换→覆盖语义（非累加，防重生膨胀）。
    // 累计语义只在 PATCH 增量编辑（volumes.ts delta）有效；整章替换后旧内容已被物理覆盖，
    // 旧字数不再存在于 content，累加无意义且重生必膨胀（3000+3500=6500 而当前内容仅 3500）。
    // 覆盖使 ai_words==当前内容 AI 字数；human_words=0（整章替换丢弃先前人工编辑）。
    db.prepare(
      "UPDATE chapter SET content = ?, word_count = ?, status = 'written', ai_words = ?, human_words = 0, updated_at = datetime('now') WHERE id = ?"
    ).run(content, wordCount, wordCount, chapterId)
  } else {
    // v0.17.0（审查 H2）：空内容显式置 failed（此前跳过 UPDATE → 永久卡 'generating'）
    db.prepare(
      "UPDATE chapter SET status = 'failed', updated_at = datetime('now') WHERE id = ? AND status = 'generating'"
    ).run(chapterId)
    console.warn(`[generate] 章节 ${chapterId} 产出为空 → 置 failed（可重试）`)
  }
  // v0.15.0：确定性校验——字数区间告警（异常区间记录质量债）
  if (!aborted && wordCount > 0 && (wordCount < 1500 || wordCount > 4500)) {
    console.warn(`[constraint] 章节 ${chapterId} 字数 ${wordCount} 超出常规区间（1500-4500）`)
  }

  // v0.23.1（批次 B5）：接通约束违反统计——最终内容（含反 AI 重写后）确定性校验，
  // 命中登记质量债（[约束违反] 前缀由 /settings/quality-debts 遵守率统计消费；
  // 此前写入方缺失，UI 统计恒 0——D98 审查死特性项）
  if (!aborted && content.trim().length > 0) {
    for (const v of validateConstraints(db, novelId, content).violations) {
      recordConstraintViolation(db, novelId, v.constraint.id, v.constraint.text, chapterId)
      console.warn(`[constraint] 章节 ${chapterId} 违反硬约束「${v.constraint.text}」（禁用词「${v.constraint.keyword}」出现 ${v.count} 次）已登记质量债`)
    }
  }

  // P20（U8）：反 AI 校验闭环——生成后检测，重度命中（总命中≥5 或单词≥3 次）自动重写一次
  if (!aborted && content.trim().length > 0) {
    const bound = getBoundStyleRules(db, novelId)
    if (bound && bound.antiAiRules.length > 0) {
      const words = extractAntiAiWordsFromRules(bound.antiAiRules)
      const hits = detectAntiAiHits(content, words)
      const totalHits = hits.reduce((a, h) => a + h.count, 0)
      if (totalHits >= 5 || hits.some((h) => h.count >= 3)) {
        console.warn(
          `[anti-ai] 命中 ${totalHits} 次（${hits.slice(0, 5).map((h) => `${h.word}x${h.count}`).join(',')}），自动重写一次`
        )
        try {
          const rewritten = await callLlmJson<{ content: string }>(
            db,
            'extraction',
            {
              novelId,
              messages: [
                {
                  role: 'user',
                  content: `你是文字润色编辑。以下章节含禁用的 AI 腔词汇，请只替换这些词/句式（保持原文结构与内容），不要改动其他文字。\n禁用词：${words.join('、')}\n\n【正文】\n${content.slice(0, 8000)}\n\n请只输出 JSON 对象：{"content": "重写后的全文"}`
                }
              ],
              maxTokens: 8192
            },
            (obj) => {
              const r = obj as Record<string, unknown>
              if (typeof r.content === 'string' && r.content.length > 100) return { content: r.content }
              return null
            },
            'anti-ai-rewrite'
          )
          if (rewritten && rewritten.content.length >= content.length * 0.5) {
            content = rewritten.content
            wordCount = (content.match(/[\u4e00-\u9fff]/g) ?? []).length
            // v0.22.0（审查 N1）：反 AI 重写仍为整章 AI 内容→同步覆盖 ai_words
            db.prepare(
              "UPDATE chapter SET content = ?, word_count = ?, ai_words = ?, updated_at = datetime('now') WHERE id = ?"
            ).run(content, wordCount, wordCount, chapterId)
          }
        } catch (err) {
          console.warn('[anti-ai] 重写失败，保留原文:', err instanceof Error ? err.message : String(err))
        }
      }
    }
  }

  // P20（C4）+ v0.9.2（#25）：abort 时 callLlm 不记账（正常完成已由 callLlm 统一记账，防双记）——
  // 此处对中止的调用补账：供应商可能不发最终 usage chunk，用上下文预算+已产出字数量估算
  if (aborted) {
    if (usageInput === 0 && content.length > 0) {
      usageInput = ctx.budgetUsed
      usageOutput = estimateTokens(content)
      cacheHit = 0
      cacheMiss = usageInput
    }
    if (usageInput > 0) {
      recordUsage(db, {
        novelId,
        taskType: 'prose',
        provider: route.providerName,
        model: route.model,
        inputTokens: usageInput,
        outputTokens: usageOutput,
        cacheHit,
        cacheMiss,
        costEstimate: 0,
        degraded: false
      })
    }
  }

  return { content, wordCount, aborted, usage: { input: usageInput, output: usageOutput, cacheHit, cacheMiss } }
  } catch (err) {
    // v0.17.0（审查 H2）：异常复位状态（仅复位自己抢占的 generating）
    db.prepare(
      "UPDATE chapter SET status = 'failed', updated_at = datetime('now') WHERE id = ? AND status = 'generating'"
    ).run(chapterId)
    console.warn(`[generate] 章节 ${chapterId} 生成失败 → 置 failed: ${err instanceof Error ? err.message : String(err)}`)
    throw err
  }
}
