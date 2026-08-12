import OpenAI from 'openai'
import { DatabaseSync } from 'node:sqlite'
import { getRouteConfig, buildBody } from './llm'
import { decryptSecret } from './keyCrypto'
import { buildChapterWriteContext, estimateTokens } from './context'
import { recordUsage } from './usage'
import { runTripleReview } from './tripleReview'
import { getBoundStyleRules, detectAntiAiHits, extractAntiAiWordsFromRules } from './styleEngine'
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

  const route = getRouteConfig(db, 'prose')
  if (!route || !route.apiKeyEncrypted) throw new Error('prose 路由未配置 API Key')
  const apiKey = await decryptSecret(route.apiKeyEncrypted)

  const client = new OpenAI({
    baseURL: route.baseUrl || undefined,
    apiKey,
    timeout: 300_000
  })

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

  // v0.9.0（审查 #25）：复用 llm.ts 的 buildBody（此前双 LLM 路径各自构造 body，
  // thinking/temperature/jsonMode 逻辑已出现漂移——如 llm.ts 有 jsonMode 处理而此处没有）
  const body = buildBody(
    route,
    {
      messages: ctx.messages.map((m) => ({ role: m.role, content: m.content ?? '' })),
      maxTokens: route.maxTokens,
      temperature: route.temperature
    },
    route.model
  )

  const stream = await client.chat.completions.create(
    {
      ...(body as unknown as OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming),
      stream: true
    },
    { signal: opts.signal }
  )

  let content = ''
  let aborted = false
  let usageInput = 0
  let usageOutput = 0
  let cacheHit = 0
  let cacheMiss = 0

  try {
    for await (const chunk of stream) {
      if (opts.signal?.aborted) {
        aborted = true
        break
      }
      const delta = chunk.choices[0]?.delta
      if (!delta) continue
      const r = delta as unknown as { reasoning_content?: string }
      if (r.reasoning_content) {
        opts.onThinking?.(r.reasoning_content)
      }
      if (delta.content) {
        content += delta.content
        opts.onDelta?.(delta.content)
      }
      const u = chunk.usage as unknown as {
        prompt_tokens?: number
        completion_tokens?: number
        prompt_cache_hit_tokens?: number
        prompt_cache_miss_tokens?: number
      }
      if (u?.prompt_tokens !== undefined) {
        usageInput = u.prompt_tokens
        usageOutput = u.completion_tokens ?? usageOutput
        cacheHit = u.prompt_cache_hit_tokens ?? 0
        cacheMiss = u.prompt_cache_miss_tokens ?? usageInput
      }
    }
  } catch (err) {
    if (!opts.signal?.aborted) throw err
    aborted = true
  }

  let wordCount = (content.match(/[\u4e00-\u9fff]/g) ?? []).length

  if (content) {
    db.prepare('INSERT INTO chapter_version (chapter_id, content, note) VALUES (?, ?, ?)').run(
      chapterId,
      content,
      aborted ? 'AI 生成（中止）' : 'AI 生成'
    )
    db.prepare(
      "UPDATE chapter SET content = ?, word_count = ?, status = 'written', updated_at = datetime('now') WHERE id = ?"
    ).run(content, wordCount, chapterId)
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
                  content: `你是文字润色编辑。以下章节含禁用的 AI 腔词汇，请只替换这些词/句式（保持原文结构与内容），不要改动其他文字。\n禁用词：${words.join('、')}\n\n【正文】\n${content.slice(0, 8000)}\n\n请输出 {"content": "重写后的全文"}`
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
            db.prepare(
              "UPDATE chapter SET content = ?, word_count = ?, updated_at = datetime('now') WHERE id = ?"
            ).run(content, wordCount, chapterId)
          }
        } catch (err) {
          console.warn('[anti-ai] 重写失败，保留原文:', err instanceof Error ? err.message : String(err))
        }
      }
    }
  }

  // P20（C4）：abort/流中断时供应商可能不发最终 usage chunk——用上下文预算+已产出字数量估算补账，
  // 否则最贵的调用（长流中止）从成本统计消失
  if (usageInput === 0 && (aborted || content.length > 0)) {
    usageInput = ctx.budgetUsed
    usageOutput = estimateTokens(content)
    cacheHit = 0
    cacheMiss = usageInput
  }

  if (usageInput > 0) {
    // P2.2 🟡11：统一走 recordUsage（含成本估算）
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

  return { content, wordCount, aborted, usage: { input: usageInput, output: usageOutput, cacheHit, cacheMiss } }
}
