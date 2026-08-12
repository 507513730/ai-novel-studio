import { DatabaseSync } from 'node:sqlite'
import { generateChapter } from './generate'
import { callLlmJson } from './jsonSafe'
import { buildChapterReviewContext, buildBackfillContext, buildFixContext, buildPatchContext, applyPatches } from './context'
import { writeCharacterStates } from './ledger'
import { isJobAborted } from './jobQueue'
import { runProductionChapter } from './solutionRunner'
import { parseSolutionSteps } from './solutionAssets'
import { getAutoFixEnabled } from './appSettings'

// ============================================================
// 整本批量生产 pipeline（PLAN §7.2 / P2）
// 对 planned 章节依次：生成 → 审核 → 低分修复（patch_first 升级链）→ 回灌
// 由 scheduler 通过 job 表驱动（执行面隔离）
// ============================================================

export interface ProductionProgress {
  novelId: number
  total: number
  done: number
  currentChapter: string
  currentAction: string
  failed: number
  qualityDebts: number
}

export async function runProductionPipeline(
  db: DatabaseSync,
  novelId: number,
  onProgress: (p: ProductionProgress) => void,
  opts: { from?: number; to?: number; jobId?: number } = {}
): Promise<ProductionProgress> {
  let sql = "SELECT id, title, status, content FROM chapter WHERE novel_id = ? AND content = ''"
  const params: Array<number> = [novelId]
  // P14 B4：范围授权（章节 id 区间）——P20：仅单边传参视为无效（静默全范围），to<from 报错
  if (opts.from !== undefined || opts.to !== undefined) {
    if (opts.from === undefined || opts.to === undefined) {
      throw new Error('范围授权需同时提供 from 与 to')
    }
    if (opts.to < opts.from) {
      throw new Error('范围授权无效：to 小于 from')
    }
  }
  if (opts.from !== undefined && opts.to !== undefined) {
    sql += ' AND id BETWEEN ? AND ?'
    params.push(opts.from, opts.to)
  }
  sql += ' ORDER BY id'
  const chapters = db.prepare(sql).all(...params) as Array<{ id: number; title: string; status: string; content: string }>

  const total = chapters.length
  const progress: ProductionProgress = {
    novelId,
    total,
    done: 0,
    currentChapter: '',
    currentAction: '准备',
    failed: 0,
    qualityDebts: 0
  }
  onProgress(progress)

  for (let i = 0; i < chapters.length; i++) {
    // P20（M2）：取消感知（每章边界检查）；v0.8.0（审查 #8）：watchdog 超时回收同样中止
    if (opts.jobId && isJobAborted(db, opts.jobId)) {
      progress.currentAction = '已取消（用户中止或 watchdog 超时）'
      onProgress(progress)
      throw new Error('job aborted')
    }
    const ch = chapters[i]
    progress.currentChapter = ch.title || `第 ${ch.id} 章`
    progress.currentAction = '生成正文'
    onProgress(progress)

    try {
      // 1. 生成（非流式，P2.1 🟡9：字数不足或失败重试 1 次）
      // P30：书级绑定生产方案（whole_book）时逐章走流水线
      let gen: Awaited<ReturnType<typeof generateChapter>>
      const bound = db
        .prepare("SELECT s.id, s.steps_json FROM novel n JOIN solution s ON s.id = n.current_solution_id WHERE n.id = ? AND s.enabled = 1")
        .get(novelId) as { id: number; steps_json: string } | undefined
      // v0.8.0（审查 #14）：whole_book 判定改解析步骤 stage——正则子串匹配会把
      // role 文本中出现的 "whole_book"（如「检查 whole_book 流程」）误判为流水线方案
      const isWholeBook = bound
        ? parseSolutionSteps(bound.steps_json).some((s) => s.stage === 'whole_book')
        : false
      if (bound && isWholeBook) {
        progress.currentAction = '方案流水线生产'
        onProgress(progress)
        try {
          const prod = await runProductionChapter(db, bound.id, novelId, ch.id)
          gen = { content: prod.content, wordCount: prod.wordCount, aborted: false, usage: { input: 0, output: 0, cacheHit: 0, cacheMiss: 0 } }
        } catch (err) {
          // 流水线失败 → 回退默认生成（v0.8.0：不再静默——用户以为流水线生效实际走了默认生成）
          console.warn(`[production] 方案流水线回退默认生成（第 ${i + 1} 章）: ${err instanceof Error ? err.message : String(err)}`)
          gen = await generateChapter(db, novelId, ch.id)
        }
      } else {
        gen = await generateChapter(db, novelId, ch.id)
      }
      if (!gen.content || gen.wordCount < 200) {
        progress.currentAction = '生成重试（第 1 次不达标）'
        onProgress(progress)
        await new Promise((r) => setTimeout(r, 2000))
        gen = await generateChapter(db, novelId, ch.id)
      }
      if (!gen.content || gen.wordCount < 200) {
        progress.failed += 1
        progress.currentAction = `生成失败（字数不足 ${gen.wordCount}）`
        onProgress(progress)
        continue
      }

      // 2. 审核
      progress.currentAction = 'AI 审核'
      onProgress(progress)
      const reviewMessages = buildChapterReviewContext(db, novelId, ch.id, gen.content)
      const review = await callLlmJson<{
        score: number
        issues: Array<{ severity: string; problem: string; suggestion: string }>
        needsFix: boolean
      }>(
        db,
        'extraction',
        {
          novelId,
          messages: reviewMessages,
          maxTokens: 4096
        },
        (obj) => {
          const r = obj as Record<string, unknown>
          if (typeof r.score !== 'number') return null
          return {
            score: r.score,
            issues: Array.isArray(r.issues)
              ? r.issues.map((i) => {
                  const x = i as Record<string, unknown>
                  return {
                    severity: String(x.severity ?? 'medium'),
                    problem: String(x.problem ?? ''),
                    suggestion: String(x.suggestion ?? '')
                  }
                })
              : [],
            needsFix: Boolean(r.needsFix)
          }
        },
        'production-review'
      )

      // 3. 低分修复（P2.1 修复 #4：真 patch_first 局部补丁，失败降级整章重写）
      let finalContent = gen.content
      let score = review.score
      if (review.score < 75 && review.issues.length > 0) {
        progress.currentAction = `修复（评分 ${review.score}）`
        onProgress(progress)
        try {
          // 3a. 先尝试局部补丁（patch_first）
          const patchMessages = buildPatchContext(db, novelId, ch.id, gen.content, review.issues)
          const patchResult = await callLlmJson<{ patches: Array<{ target: string; replacement: string }> }>(
            db,
            'extraction',
            {
              novelId,
              messages: patchMessages,
              maxTokens: 4096
            },
            (obj) => {
              const arr = (obj as { patches?: unknown }).patches
              if (!Array.isArray(arr) || arr.length === 0) return null
              return {
                patches: arr
                  .map((p) => {
                    const r = p as Record<string, unknown>
                    return { target: String(r.target ?? ''), replacement: String(r.replacement ?? '') }
                  })
                  .filter((p) => p.target && p.replacement)
              }
            },
            'production-patch'
          )
          const patched = applyPatches(gen.content, patchResult.patches)
          if (patched !== null) {
            finalContent = patched
          } else {
            // 3b. 局部补丁失败（target 未匹配）→ 降级整章重写
            const fixMessages = buildFixContext(db, novelId, ch.id, gen.content, review.issues)
            const fixed = await callLlmJson<{ content: string }>(
              db,
              'extraction',
              {
                novelId,
                messages: fixMessages,
                maxTokens: 8192
              },
              (obj) => {
                const r = obj as Record<string, unknown>
                return typeof r.content === 'string' && r.content.length > 100 ? { content: r.content } : null
              },
              'production-fix'
            )
            finalContent = fixed.content
          }
          // 修复后重审（重审闭环）
          const rescoreMessages = buildChapterReviewContext(db, novelId, ch.id, finalContent)
          const rescore = await callLlmJson<{ score: number }>(
            db,
            'extraction',
            {
              novelId,
              messages: rescoreMessages,
              maxTokens: 2048
            },
            (obj) => {
              const r = obj as Record<string, unknown>
              return typeof r.score === 'number' ? { score: r.score } : null
            },
            'production-rescore'
          )
          score = rescore.score
        } catch {
          // 修复失败：保留原正文，记质量债务
          progress.qualityDebts += 1
        }
      }

      // 4. 写回修复后的正文（如有）
      if (finalContent !== gen.content) {
        db.prepare(
          "UPDATE chapter SET content = ?, word_count = ?, status = 'reviewed', updated_at = datetime('now') WHERE id = ?"
        ).run(finalContent, (finalContent.match(/[\u4e00-\u9fff]/g) ?? []).length, ch.id)
      } else {
        db.prepare(
          "UPDATE chapter SET status = 'reviewed', updated_at = datetime('now') WHERE id = ?"
        ).run(ch.id)
      }

      // 5. 回灌
      progress.currentAction = '状态回灌'
      onProgress(progress)
      try {
        const backfillMessages = buildBackfillContext(db, novelId, ch.id, finalContent)
        const backfill = await callLlmJson<{
          characterStates: Array<{ name: string; state: string }>
          newFacts: Array<{ content: string }>
          foreshadows: Array<{ content: string; hint: string }>
          paidForeshadows: Array<{ content: string }>
        }>(
          db,
          'extraction',
          {
            novelId,
            messages: backfillMessages,
            maxTokens: 4096
          },
          (obj) => {
            const r = obj as Record<string, unknown>
            if (!Array.isArray(r.characterStates) && !Array.isArray(r.newFacts)) return null
            return {
              characterStates: Array.isArray(r.characterStates)
                ? r.characterStates.map((x) => {
                    const c = x as Record<string, unknown>
                    return { name: String(c.name ?? ''), state: String(c.state ?? '') }
                  })
                : [],
              newFacts: Array.isArray(r.newFacts)
                ? r.newFacts.map((x) => ({ content: String((x as Record<string, unknown>).content ?? '') }))
                : [],
              foreshadows: Array.isArray(r.foreshadows)
                ? r.foreshadows.map((x) => {
                    const f = x as Record<string, unknown>
                    return { content: String(f.content ?? ''), hint: String(f.hint ?? '') }
                  })
                : [],
              paidForeshadows: Array.isArray(r.paidForeshadows)
                ? r.paidForeshadows.map((x) => ({ content: String((x as Record<string, unknown>).content ?? '') }))
                : []
            }
          },
          'production-backfill'
        )
        const insertFact = db.prepare(
          'INSERT INTO fact (novel_id, chapter_id, content, confirmed) VALUES (?, ?, ?, 1)'
        )
        const insertForeshadow = db.prepare(
          "INSERT INTO foreshadow (novel_id, chapter_id, content, status) VALUES (?, ?, ?, 'laid')"
        )
        db.exec('BEGIN')
        try {
          for (const f of backfill.newFacts) if (f.content) insertFact.run(novelId, ch.id, f.content)
          for (const f of backfill.foreshadows) if (f.content) insertForeshadow.run(novelId, ch.id, f.content)
          for (const p of backfill.paidForeshadows) {
            const row = db
              .prepare(
                "SELECT id FROM foreshadow WHERE novel_id = ? AND content = ? AND status = 'laid' ORDER BY id LIMIT 1"
              )
              .get(novelId, p.content) as { id: number } | undefined
            if (row) db.prepare("UPDATE foreshadow SET status = 'paid' WHERE id = ?").run(row.id)
          }
          // P2.1 修复 #1：角色状态写入 ledger（与手动 confirm 路径一致）
          if (backfill.characterStates.length > 0) {
            writeCharacterStates(db, novelId, backfill.characterStates)
          }
          db.exec('COMMIT')
        } catch (err) {
          db.exec('ROLLBACK')
          throw err
        }
      } catch (err) {
        // v0.8.0（审查 #14）：回灌失败不再静默——不影响主流程但必须可见
        console.warn(`[production] 回灌失败（第 ${i + 1} 章，评分 ${score}）: ${err instanceof Error ? err.message : String(err)}`)
      }

      progress.done = i + 1
      progress.currentAction = `完成（评分 ${score}）`
      onProgress(progress)
    } catch (err) {
      progress.failed += 1
      progress.currentAction = `失败：${err instanceof Error ? err.message.slice(0, 80) : String(err)}`
      db.prepare("UPDATE chapter SET status = 'failed' WHERE id = ?").run(ch.id)
      onProgress(progress)
    }
  }

  // v0.10.0（批B/I2）：生产完成后自动入队质量债修复（开关开 + 存在待修复债务时）
  // 业界约束（D81）：evaluator-optimizer 模式需停止条件与成本护栏——修复任务入 job 队列串行执行、
  // 每章内部自限轮次（fixChapterOnce），用户可随时在任务中心取消/设置页关闭
  try {
    if (getAutoFixEnabled(db) && opts.jobId) {
      const pending = db
        .prepare(
          `SELECT COUNT(DISTINCT chapter_id) AS c FROM quality_debt q
           JOIN chapter c ON c.id = q.chapter_id WHERE q.resolved = 0 AND c.novel_id = ?`
        )
        .get(novelId) as { c: number }
      if (Number(pending.c) > 0) {
        const queued = db
          .prepare(
            `INSERT INTO job (type, status, progress, payload_json)
             SELECT 'debt-fix', 'queued', 0, ?
             WHERE NOT EXISTS (
               SELECT 1 FROM job WHERE type = 'debt-fix' AND status IN ('queued','running')
                 AND json_extract(payload_json, '$.novelId') = ?
             )`
          )
          .run(JSON.stringify({ novelId }), novelId)
        if (Number(queued.changes) > 0) {
          console.log(`[production] 自动入队质量债修复（${pending.c} 章）`)
        }
      }
    }
  } catch (err) {
    console.warn(`[production] 自动修复入队失败: ${err instanceof Error ? err.message : String(err)}`)
  }

  return progress
}
