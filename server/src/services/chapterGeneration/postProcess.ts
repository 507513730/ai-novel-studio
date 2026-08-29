// 章节生成后处理域（spec §3.1）：主角名替换、硬约束校验登记、反 AI 重写。
// 只变换内存文本与登记质量债，禁止写 chapter / chapter_version（落库统一走 persistence.ts）。
import { DatabaseSync } from 'node:sqlite'
import { callLlmJson } from '../jsonSafe'
import { getBoundStyleRules, detectAntiAiHits, extractAntiAiWordsFromRules } from '../styleEngine'
import { replaceProtagonistName, validateConstraints, recordConstraintViolation } from '../constraintEngine'

export interface PostProcessResult {
  content: string
  degradedReasons: string[]
}

export async function postProcessGeneratedContent(
  db: DatabaseSync,
  novelId: number,
  chapterId: number,
  rawContent: string,
  aborted = false
): Promise<PostProcessResult> {
  const degradedReasons: string[] = []
  // v0.15.0：主角名约束替换（角色表主角名 ≠ 硬约束规范名时自动对齐；中止的部分正文同样对齐）
  let content = replaceProtagonistName(db, novelId, rawContent)

  // v0.23.1（批次 B5）：确定性校验命中即登记质量债（[约束违反] 前缀由 /settings/quality-debts 消费）
  if (!aborted && content.trim().length > 0) {
    for (const v of validateConstraints(db, novelId, content).violations) {
      recordConstraintViolation(db, novelId, v.constraint.id, v.constraint.text, chapterId)
      console.warn(
        `[constraint] 章节 ${chapterId} 违反硬约束「${v.constraint.text}」（禁用词「${v.constraint.keyword}」出现 ${v.count} 次）已登记质量债`
      )
    }
  }

  if (aborted || content.trim().length === 0) return { content, degradedReasons }

  // P20（U8）：反 AI 校验闭环——重度命中（总命中≥5 或单词≥3 次）自动重写一次。
  // 短重写或重写失败保留原文，属显式降级（degradedReasons），不视为生成失败。
  const bound = getBoundStyleRules(db, novelId)
  if (!bound || bound.antiAiRules.length === 0) return { content, degradedReasons }

  const words = extractAntiAiWordsFromRules(bound.antiAiRules)
  const hits = detectAntiAiHits(content, words)
  const totalHits = hits.reduce((sum, hit) => sum + hit.count, 0)
  if (totalHits < 5 && !hits.some((hit) => hit.count >= 3)) return { content, degradedReasons }

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
    if (rewritten.content.length >= content.length * 0.5) {
      content = rewritten.content
    } else {
      degradedReasons.push('anti-ai rewrite rejected: output too short')
      console.warn('[anti-ai] 重写过短（<原文 50%），保留原文')
    }
  } catch (error) {
    degradedReasons.push(`anti-ai rewrite failed: ${error instanceof Error ? error.message : String(error)}`)
    console.warn('[anti-ai] 重写失败，保留原文:', error instanceof Error ? error.message : String(error))
  }

  return { content, degradedReasons }
}
