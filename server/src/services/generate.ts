import OpenAI from 'openai'
import { DatabaseSync } from 'node:sqlite'
import { getRouteConfig } from './llm'
import { decryptSecret } from './keyCrypto'
import { buildChapterWriteContext } from './context'
import { recordUsage } from './usage'
import { runTripleReview } from './tripleReview'

export interface GenerateOptions {
  signal?: AbortSignal
  onDelta?: (text: string) => void
  onThinking?: (text: string) => void
  tripleReview?: boolean // P2.3：三方会审开关（默认开）
  include?: string[] // B1：注入段过滤（contract/world/characters/continuity/genre/triple/style/summary/external）
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
    } catch {
      // 三方会审失败不阻塞生成（降级为无约束）
    }
  }

  const ctx = buildChapterWriteContext(db, novelId, chapterId, {
    tripleConstraints,
    include: opts.include
  })

  const body: Record<string, unknown> = {
    model: route.model,
    messages: ctx.messages.map((m) => ({ role: m.role, content: m.content ?? '' })),
    max_tokens: route.maxTokens
  }
  if (route.thinkingEnabled) {
    body.thinking = { type: 'enabled' }
    body.reasoning_effort = route.reasoningEffort
  } else {
    // V4 默认 thinking 开，必须显式 disabled（D12）
    body.thinking = { type: 'disabled' }
    if (route.temperature !== null && route.temperature !== undefined) {
      body.temperature = route.temperature
    }
  }

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

  const wordCount = (content.match(/[\u4e00-\u9fff]/g) ?? []).length

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
