// 章节执行路由：审核 / 修复（patch_first，核心在 debtFix）/ 轻量本地校对
import type { Router } from 'express'
import type { DatabaseSync } from 'node:sqlite'
import { z } from 'zod'
import { buildChapterReviewContext } from '../../services/context/dynamic'
import { callLlmJson } from '../../services/jsonSafe'
import { fixChapterOnce } from '../../services/debtFix'
import { deriveNeedsFix } from '../../services/reviewPolicy'
import { detectLocalIssues } from '../../services/proofread'

// 审核（可复用：首次审核 + 修复后重审）
async function performReview(
  db: DatabaseSync,
  novelId: number,
  chapterId: number,
  content: string
): Promise<{
  score: number
  strengths: string[]
  issues: Array<{ severity: string; location: string; problem: string; suggestion: string }>
  needsFix: boolean
}> {
  const messages = buildChapterReviewContext(db, novelId, chapterId, content)
  const review = await callLlmJson<{
    score: number
    strengths: string[]
    issues: Array<{ severity: string; location: string; problem: string; suggestion: string }>
    needsFix: boolean
  }>(
    db,
    'extraction',
    {
      novelId,
      messages,
      maxTokens: 4096
    },
    (obj) => {
      const r = obj as Record<string, unknown>
      if (typeof r.score !== 'number') return null
      return {
        score: r.score,
        strengths: Array.isArray(r.strengths) ? r.strengths.map(String) : [],
        issues: Array.isArray(r.issues)
          ? r.issues.map((i) => {
              const x = i as Record<string, unknown>
              return {
                severity: String(x.severity ?? 'medium'),
                location: String(x.location ?? ''),
                problem: String(x.problem ?? ''),
                suggestion: String(x.suggestion ?? '')
              }
            })
          : [],
        needsFix: Boolean(r.needsFix)
      }
    },
    'review'
  )
  // 记录质量债务（high/medium 问题）
  // P20（C7）：按章节+签名去重（同章重复审核不重复插）；修复时置 resolved
  const insertDebt = db.prepare(
    `INSERT OR IGNORE INTO quality_debt (chapter_id, issue, severity)
     SELECT ?, ?, ? WHERE NOT EXISTS (
       SELECT 1 FROM quality_debt WHERE chapter_id = ? AND issue = ? AND resolved = 0
     )`
  )
  for (const issue of review.issues) {
    if (issue.severity === 'high' || issue.severity === 'medium') {
      const sig = `${issue.location} ${issue.problem}`
      insertDebt.run(chapterId, sig, issue.severity, chapterId, sig)
    }
  }
  db.prepare(
    "UPDATE chapter SET review_json = ?, status = 'reviewed', updated_at = datetime('now') WHERE id = ?"
  ).run(JSON.stringify(review), chapterId)
  return review
}

export function registerChapterReviewRoutes(router: Router, db: DatabaseSync): void {
  // ---------- 审核 ----------
  router.post('/:novelId/chapters/:chapterId/review', async (req, res, next) => {
    try {
      const novelId = Number(req.params.novelId)
      const chapterId = Number(req.params.chapterId)
      const chapter = db
        .prepare('SELECT content, goal_json FROM chapter WHERE id = ? AND novel_id = ?')
        .get(chapterId, novelId) as { content: string; goal_json: string } | undefined
      if (!chapter || !chapter.content) {
        res.status(400).json({ error: '章节无正文，先生成再审核' })
        return
      }
      // P19 ③：场景数下限校验（<3 场景 → 追加 high 级问题 + 质量债，参考项目 #103 同类）
      const goal = JSON.parse(chapter.goal_json || '{}') as { scenes?: unknown }
      const sceneCount = Array.isArray(goal.scenes) ? goal.scenes.length : 0
      const review = await performReview(db, novelId, chapterId, chapter.content)
      // v0.24.4（D107）：needsFix 服务端推导（LLM 恒 true 不可用）——展示与自动修复行为一致
      review.needsFix = deriveNeedsFix(review.score, review.issues)
      if (sceneCount > 0 && sceneCount < 3) {
        review.issues.push({
          severity: 'high',
          location: '全章结构',
          problem: `场景数不足（${sceneCount} 个 < 3），节奏拖沓或信息密度低`,
          suggestion: '拆分为至少 3 个场景：起（引入）→ 承（冲突推进）→ 转合（结果与钩子），或在现有场景内补充目标冲突'
        })
        review.needsFix = true
        db.prepare('INSERT INTO quality_debt (chapter_id, issue, severity) VALUES (?, ?, ?)').run(
          chapterId,
          `全章结构 场景数不足（${sceneCount}）`,
          'high'
        )
        db.prepare(
          "UPDATE chapter SET review_json = ?, status = 'reviewed', updated_at = datetime('now') WHERE id = ?"
        ).run(JSON.stringify(review), chapterId)
      }
      res.json({ review })
    } catch (err) {
      next(err)
    }
  })

  // ---------- 修复（patch_first，限 2 轮）——v0.10.0（批B/I2）：核心抽到 services/debtFix 供 job 复用
  router.post('/:novelId/chapters/:chapterId/fix', async (req, res, next) => {
    try {
      const novelId = Number(req.params.novelId)
      const chapterId = Number(req.params.chapterId)
      const r = await fixChapterOnce(db, novelId, chapterId)
      if (r.reason) {
        res.status(400).json({ error: r.reason })
        return
      }
      res.json({
        fixed: r.fixed,
        round: r.round,
        content: r.content,
        rescore: { score: r.score, needsFix: !r.passed, passed: r.passed }
      })
    } catch (err) {
      next(err)
    }
  })

  // ---------- v0.24.4（A4）：轻量本地校对（确定性检查零 token + 单次 extraction 语义检查） ----------
  router.post('/:novelId/chapters/:chapterId/proofread', async (req, res, next) => {
    try {
      const novelId = Number(req.params.novelId)
      const chapterId = Number(req.params.chapterId)
      const input = z.object({ content: z.string().max(30000).optional() }).parse(req.body ?? {})
      const chapter = db
        .prepare('SELECT title, content FROM chapter WHERE id = ? AND novel_id = ?')
        .get(chapterId, novelId) as { title: string; content: string } | undefined
      if (!chapter) {
        res.status(404).json({ error: 'chapter not found' })
        return
      }
      const content = input.content ?? chapter.content
      if (!content.trim()) {
        res.status(400).json({ error: '章节无正文' })
        return
      }
      // 1) 确定性检查（零 token）
      const local = detectLocalIssues(content)
      // 2) 语义检查（extraction 单次调用：错别字/称谓一致性）
      let semantic: Array<{ type: string; location: string; problem: string; suggestion: string }> = []
      try {
        const r = await callLlmJson<{
          issues: Array<{ type: 'typo' | 'name' | 'grammar'; location: string; problem: string; suggestion: string }>
        }>(
          db,
          'extraction',
          {
            novelId,
            messages: [
              {
                role: 'user',
                content: `你是文字校对。检查以下的章节正文（首 6000 字），只报真实问题：错别字（type=typo）、称谓/人名不一致（type=name，如同一人物两种译名）、明显语病（type=grammar）。每条给出原文位置片段与修改建议。没有问题时输出空数组。\n\n章节名：${chapter.title}\n\n【正文】\n${content.slice(0, 6000)}\n\n请输出 JSON：{"issues":[{"type":"typo|name|grammar","location":"原文片段","problem":"问题说明","suggestion":"修改建议"}]}`
              }
            ],
            maxTokens: 2048
          },
          (obj) => {
            const arr = (obj as { issues?: unknown }).issues
            if (!Array.isArray(arr)) return null
            return {
              issues: arr
                .map((x) => {
                  const i = x as Record<string, unknown>
                  return {
                    type: String(i.type ?? 'grammar') as 'typo' | 'name' | 'grammar',
                    location: String(i.location ?? ''),
                    problem: String(i.problem ?? ''),
                    suggestion: String(i.suggestion ?? '')
                  }
                })
                .filter((i) => i.location && i.problem)
            }
          },
          'proofread'
        )
        semantic = r.issues
      } catch {
        // 语义检查失败静默降级（本地检查已覆盖确定性问题）
      }
      res.json({ issues: [...local.map((i) => ({ ...i, type: i.type })), ...semantic], localCount: local.length })
    } catch (err) {
      next(err)
    }
  })
}
