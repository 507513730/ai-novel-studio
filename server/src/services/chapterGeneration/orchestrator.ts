// 章节生成编排域（spec §3.1）：只协调上下文、LLM、截断检测、后处理与持久化，
// 不直接写 chapter / chapter_version（状态走 state.ts，落库走 persistence.ts）。
import { DatabaseSync } from 'node:sqlite'
import { getRouteConfig, callLlm, ConfigError } from '../llm'
import { buildChapterWriteContext, estimateTokens } from '../context'
import { recordUsage } from '../usage'
import { runTripleReview } from '../tripleReview'
import { claimChapter, failClaimedChapter } from './state'
import { persistGeneratedChapter } from './persistence'
import { postProcessGeneratedContent } from './postProcess'

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
  degradedReasons?: string[] // 显式降级（如反 AI 重写失败保留原文）
}

/**
 * 章节正文生成核心（SSE 路由与整本生产共用）
 * - 前缀冻结上下文（buildChapterWriteContext）
 * - thinking disabled 显式（D12）
 * - 支持中止（保留已生成部分）
 * - 最终正文版本契约：所有后处理完成后单事务落库，版本快照与章节正文完全一致
 */
export async function generateChapter(
  db: DatabaseSync,
  novelId: number,
  chapterId: number,
  opts: GenerateOptions = {}
): Promise<GenerateResult> {
  const claim = claimChapter(db, novelId, chapterId)

  // v0.17.0（审查 H2）：抢占后全链路 try/catch——任何异常/空内容都复位状态，杜绝永久卡 'generating'
  try {
    const route = getRouteConfig(db, 'prose')
    if (!route || !route.apiKeyEncrypted) throw new ConfigError('prose 路由未配置 API Key——请在 设置 → 供应商 保存后重试')

    // v0.9.2（审查 #25）：统一走 callLlm 流式——候选链降级/错误分类/记账/signal 全部一致；
    // abort 时 callLlm 返回部分内容（不抛错），此处按 signal.aborted 感知

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

    const aborted = opts.signal?.aborted ?? false
    // v0.23.1（批次 A4）：max_tokens 截断检测——必须先于一切后处理副作用；
    // 截断的半章不再静默落库为 written，显式失败并提示调整（外层 catch 复位 failed，可重试）
    if (!aborted && llmResult.truncated) {
      throw new Error(
        '生成被 max_tokens 截断（finish_reason=length）——请在设置 → 模型路由调大 max_tokens，或降低单章目标字数后重试'
      )
    }

    const processed = await postProcessGeneratedContent(db, novelId, chapterId, llmResult.content, aborted)
    const content = processed.content
    if (processed.degradedReasons.length > 0) {
      for (const reason of processed.degradedReasons) {
        console.warn(`[generate] 章节 ${chapterId} 降级: ${reason}`)
      }
    }

    let usageInput = llmResult.usage.input
    let usageOutput = llmResult.usage.output
    let cacheHit = llmResult.usage.cacheHit
    let cacheMiss = llmResult.usage.cacheMiss

    const wordCount = (content.match(/[\u4e00-\u9fff]/g) ?? []).length
    if (!content) console.warn(`[generate] 章节 ${chapterId} 产出为空 → 置 failed（可重试）`)
    // v0.15.0：确定性校验——字数区间告警（按后处理后的最终内容判定）
    if (!aborted && wordCount > 0 && (wordCount < 1500 || wordCount > 4500)) {
      console.warn(`[constraint] 章节 ${chapterId} 字数 ${wordCount} 超出常规区间（1500-4500）`)
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

    const persisted = persistGeneratedChapter(db, claim, { content, aborted })

    return {
      content,
      wordCount: persisted.wordCount,
      aborted,
      usage: { input: usageInput, output: usageOutput, cacheHit, cacheMiss },
      degradedReasons: processed.degradedReasons
    }
  } catch (err) {
    // v0.17.0（审查 H2）：异常复位状态（仅复位自己抢占的 generating）
    // v0.24.3（写书实战纠错）：ConfigError 时章节并未真正尝试生成，
    // 恢复抢占前状态（claim.previousStatus 为抢占前快照）而非误标 failed
    failClaimedChapter(db, claim, err)
    console.warn(`[generate] 章节 ${chapterId} 生成失败: ${err instanceof Error ? err.message : String(err)}`)
    throw err
  }
}
