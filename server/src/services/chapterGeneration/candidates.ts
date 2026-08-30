// 章节多候选分支生成域（v1.0 后续 A1）：串行生成 N 份候选构想，各存为 chapter_version 快照。
// 与 generateChapter 的区别：不抢占章节、不改 chapter.content/status——只做"生成 + 版本快照 + 返回候选列表"，
// 用户选定后复用现有版本恢复流程（chapterVersionRestore）把该候选落为正文，其余候选留在版本历史。
// 契约：D21/AGENTS #27 不触发章节状态守卫（本路径不改状态）；候选为探查性产出，跳过三方会审与章节写库。
import { DatabaseSync } from 'node:sqlite'
import { getRouteConfig } from '../llm/routes'
import { callLlm } from '../llm/caller'
import { ConfigError } from '../llm/errors'
import { buildChapterWriteContext } from '../context/dynamic'
import { postProcessGeneratedContent } from './postProcess'
import { persistCandidateVersion } from './persistence'

// 每份候选的差异化走向引导（注入 perCallGuidance，复用现有「本次引导」可变区槽位）
export const CANDIDATE_ANGLES = [
  '这一版请侧重情节推进与冲突升级，节奏明快，多用动作、对话与突发事件推进事件。',
  '这一版请侧重氛围铺垫与细节描写，节奏舒缓，突出环境、物件与人物的内心活动。',
  '这一版请侧重人物关系与情感张力，通过对话与互动揭示人物动机并埋下伏笔。'
]

export interface CandidateDraft {
  index: number
  note: string
  content: string
  wordCount: number
  versionId: number
}

export interface CandidateOptions {
  count?: number
  include?: string[]
  signal?: AbortSignal
}

export async function generateChapterCandidates(
  db: DatabaseSync,
  novelId: number,
  chapterId: number,
  opts: CandidateOptions = {}
): Promise<CandidateDraft[]> {
  const count = Math.min(3, Math.max(1, opts.count ?? 2))

  const route = getRouteConfig(db, 'prose')
  if (!route || !route.apiKeyEncrypted) throw new ConfigError('prose 路由未配置 API Key——请在 设置 → 供应商 保存后重试')

  // 防同章并发生成（不抢占状态，只做版本快照——但仍需防并发碰撞与重复烧 token）
  const chapter = db
    .prepare('SELECT id, status FROM chapter WHERE id = ? AND novel_id = ?')
    .get(chapterId, novelId) as { id: number; status: string } | undefined
  if (!chapter) throw new Error('chapter not found')

  const drafts: CandidateDraft[] = []
  for (let i = 0; i < count; i++) {
    if (opts.signal?.aborted) break

    const angle = CANDIDATE_ANGLES[i % CANDIDATE_ANGLES.length]
    const ctx = buildChapterWriteContext(db, novelId, chapterId, {
      include: opts.include,
      perCallGuidance: `（多候选分支第 ${i + 1} 份）${angle}`
    })

    const llmResult = await callLlm(db, 'prose', {
      novelId,
      messages: ctx.messages.map((m) => ({ role: m.role, content: m.content ?? '' })),
      maxTokens: route.maxTokens,
      temperature: route.temperature,
      stream: true,
      onDelta: () => {}, // 候选在服务端串行收敛，无需向客户端逐字推送
      signal: opts.signal
    })

    if (opts.signal?.aborted) break
    if (llmResult.truncated) {
      throw new Error(
        '候选生成被 max_tokens 截断（finish_reason=length）——请在设置 → 模型路由调大 max_tokens，或降低单章目标字数后重试'
      )
    }

    const processed = await postProcessGeneratedContent(db, novelId, chapterId, llmResult.content, false)
    if (processed.degradedReasons.length > 0) {
      for (const reason of processed.degradedReasons) console.warn(`[generateCandidates] 候选 ${i + 1} 降级: ${reason}`)
    }

    const content = processed.content
    if (!content.trim()) throw new Error('候选生成为空')

    const note = `候选 ${i + 1}`
    const versionId = persistCandidateVersion(db, chapterId, content, note)

    drafts.push({
      index: i,
      note,
      content,
      wordCount: (content.match(/[\u4e00-\u9fff]/g) ?? []).length,
      versionId
    })
  }

  return drafts
}
