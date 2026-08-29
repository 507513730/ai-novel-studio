import { Router } from 'express'
import type { DatabaseSync } from 'node:sqlite'
import { z } from 'zod'
import { directorProgress } from '../services/director'
import { hubChat } from '../services/hub'
import { enqueueDirectorJob, enqueueProductionJob } from '../services/jobQueue'
import { enqueueDebtFixJob } from '../services/jobs/repository'
import { cancelActiveJob } from '../services/jobs/lifecycle'

/** v0.17.0（LOW）：安全 JSON 解析（损坏数据兜底） */
function safeParseJson(v: unknown): unknown {
  try {
    return JSON.parse(String(v ?? '')) 
  } catch {
    return {}
  }
}

export function createJobsRouter(db: DatabaseSync): Router {
  const router = Router()

  // ---------- 任务中心 ----------
  router.get('/jobs', (_req, res) => {
    const rows = db
      .prepare('SELECT * FROM job ORDER BY id DESC LIMIT 50')
      .all() as Array<Record<string, unknown>>
    res.json({
      jobs: rows.map((r) => ({
        id: r.id,
        type: r.type,
        status: r.status,
        progress: r.progress,
        // v0.17.0（LOW）：JSON.parse 兜底（损坏 payload 不炸整个任务列表）
        payload: safeParseJson(r.payload_json),
        result: safeParseJson(r.result_json),
        error: r.error,
        createdAt: r.created_at
      }))
    })
  })

  // P19 ③：清理已完成/失败任务（参考项目 #77 同类：任务中心无法清空）
  router.delete('/jobs/done', (req, res) => {
    const scope = (req.query.scope as string | undefined) ?? 'done'
    const statuses =
      scope === 'all' ? ["status IN ('done', 'failed', 'cancelled')"] : ["status = 'done'"]
    const deleted = db
      .prepare(`DELETE FROM job WHERE ${statuses.join(' AND ')} AND status != 'running'`)
      .run()
    res.json({ deleted: deleted.changes })
  })

  router.get('/jobs/:id', (req, res) => {
    const row = db.prepare('SELECT * FROM job WHERE id = ?').get(Number(req.params.id)) as
      | Record<string, unknown>
      | undefined
    if (!row) {
      res.status(404).json({ error: 'job not found' })
      return
    }
    res.json({
      job: {
        id: row.id,
        type: row.type,
        status: row.status,
        progress: row.progress,
        payload: safeParseJson(row.payload_json),
        result: safeParseJson(row.result_json),
        error: row.error,
        createdAt: row.created_at
      }
    })
  })

  // P12 A1：任务重试（failed/cancelled → queued，scheduler 重新消费；幂等）
  // P13 G1：支持 model 换模型重试（写入 payload.modelOverride）
  router.post('/jobs/:id/retry', (req, res, next) => {
    try {
      const id = Number(req.params.id)
      const input = z.object({ model: z.string().min(1).optional() }).parse(req.body ?? {})
      const row = db.prepare('SELECT status, payload_json FROM job WHERE id = ?').get(id) as
        | { status: string; payload_json: string }
        | undefined
      if (!row) {
        res.status(404).json({ error: 'job not found' })
        return
      }
      if (!['failed', 'cancelled'].includes(row.status)) {
        res.status(409).json({ error: `任务状态为 ${row.status}，不可重试` })
        return
      }
      let payload: Record<string, unknown> = {}
      try {
        payload = JSON.parse(row.payload_json) as Record<string, unknown>
      } catch {
        /* 忽略损坏 payload */
      }
      if (input.model) {
        payload.modelOverride = input.model
      } else {
        delete payload.modelOverride
      }
      db.prepare(
        "UPDATE job SET status = 'queued', progress = 0, error = NULL, claim_token = NULL, payload_json = ?, updated_at = datetime('now') WHERE id = ?"
      ).run(JSON.stringify(payload), id)
      res.json({ ok: true, modelOverride: input.model ?? null })
    } catch (err) {
      next(err)
    }
  })

  // P12 A1：任务取消（queued 直接取消；running 标记取消——导演主循环感知）
  // R2：转换守卫收拢 lifecycle（queued|running → cancelled；终态 409）
  router.post('/jobs/:id/cancel', (req, res, next) => {
    try {
      const id = Number(req.params.id)
      if (!cancelActiveJob(db, id)) {
        res.status(409).json({ error: '任务不在可取消状态' })
        return
      }
      res.json({ ok: true })
    } catch (err) {
      next(err)
    }
  })

  return router
}

export function createAutomationRouter(db: DatabaseSync): Router {
  const router = Router()

  // ---------- 导演命令（Web API 只下发命令，执行在 scheduler） ----------
  router.post('/:novelId/director/run', (req, res, next) => {
    try {
      const novelId = Number(req.params.novelId)
      const input = z
        .object({
          mode: z.enum(['auto', 'supervised']).default('auto'),
          chaptersPerVolume: z.number().int().min(5).max(40).default(20)
        })
        .parse(req.body)
      const enqueued = enqueueDirectorJob(db, novelId, {
        mode: input.mode,
        chaptersPerVolume: input.chaptersPerVolume
      })
      if ('conflict' in enqueued) {
        res.status(409).json({ error: '导演任务已在运行或排队中' })
        return
      }
      res.status(201).json({ jobId: enqueued.jobId })
    } catch (err) {
      next(err)
    }
  })

  // 检查点确认（supervised 模式继续）
  router.post('/:novelId/director/resume', (req, res, next) => {
    try {
      const novelId = Number(req.params.novelId)
      const task = directorProgress(db, novelId)
      if (!task) {
        res.status(404).json({ error: '没有导演任务，先 run' })
        return
      }
      // P2.2 🟡10：resume 保留用户配置的 chaptersPerVolume（不再硬编码 20）
      const chaptersPerVolume = task.checkpoint.chaptersPerVolume ?? 20
      // v0.17.0（审查 M14）：原子入队（INSERT ... WHERE NOT EXISTS 替代 SELECT→INSERT 的 TOCTOU）
      const result = db
        .prepare(
          `INSERT INTO job (type, status, progress, payload_json)
           SELECT 'director', 'queued', 0, ?
           WHERE NOT EXISTS (
             SELECT 1 FROM job WHERE type = 'director' AND status IN ('queued','running') AND json_extract(payload_json, '$.novelId') = ?
           )`
        )
        .run(JSON.stringify({ novelId, mode: task.mode, chaptersPerVolume }), novelId)
      if (Number(result.changes) === 0) {
        res.status(409).json({ error: '导演任务已在运行中' })
        return
      }
      res.status(201).json({ jobId: Number(result.lastInsertRowid), resumedFrom: task.checkpoint.displayStatus })
    } catch (err) {
      next(err)
    }
  })

  // 取消导演
  router.post('/:novelId/director/cancel', (req, res, next) => {
    try {
      const novelId = Number(req.params.novelId)
      const result = db
        .prepare(
          "UPDATE job SET status = 'cancelled', updated_at = datetime('now') WHERE type = 'director' AND status IN ('queued','running') AND json_extract(payload_json, '$.novelId') = ?"
        )
        .run(novelId)
      res.json({ cancelled: Number(result.changes) > 0 })
    } catch (err) {
      next(err)
    }
  })

  router.get('/:novelId/director/status', (req, res) => {
    const novelId = Number(req.params.novelId)
    const task = directorProgress(db, novelId)
    if (!task) {
      res.json({ status: 'not_started' })
      return
    }
    res.json({
      status: task.status,
      stage: task.checkpoint.stage,
      displayStatus: task.checkpoint.displayStatus,
      progress: task.checkpoint.progress,
      replanCount: task.checkpoint.replanCount,
      decisions: task.checkpoint.decisions,
      blockingReason: task.checkpoint.blockingReason ?? null,
      resumeAction: task.checkpoint.resumeAction ?? null,
      lastError: task.checkpoint.lastError ?? null,
      mode: task.mode
    })
  })

  // ---------- 整本生产 ----------
  router.post('/:novelId/produce', (req, res, next) => {
    try {
      const novelId = Number(req.params.novelId)
      // P14 B4：范围授权（可选 from/to 章节 id 区间）
      const input = z
        .object({ from: z.number().int().positive().optional(), to: z.number().int().positive().optional() })
        .parse(req.body ?? {})
      // v0.9.0（审查 D）：from/to 必须成对（此前只传一个会静默退化为全书生产，多烧额度）
      if ((input.from === undefined) !== (input.to === undefined)) {
        res.status(400).json({ error: 'from 与 to 必须同时提供（范围授权）' })
        return
      }
      let pendingSql = "SELECT COUNT(*) AS c FROM chapter WHERE novel_id = ? AND content = ''"
      const pendingParams: Array<number> = [novelId]
      if (input.from !== undefined && input.to !== undefined) {
        pendingSql += ' AND id BETWEEN ? AND ?'
        pendingParams.push(input.from, input.to)
      }
      const pending = db.prepare(pendingSql).get(...pendingParams) as { c: number }
      if (pending.c === 0) {
        res.status(400).json({ error: '所选范围内没有待生成的章节' })
        return
      }
      // v0.9.0（审查 D）：原子插入防重（INSERT...WHERE NOT EXISTS）——此前 check-then-insert 两步
      // 并发 POST 可双插入（TOCTOU），调度器串行执行时第二个变成空跑
      // v0.24.2（F4）：入队逻辑收编 enqueueProductionJob（与方案整本入口共用）
      const queued = enqueueProductionJob(
        db,
        novelId,
        input.from !== undefined && input.to !== undefined ? { from: input.from, to: input.to } : undefined
      )
      if ('conflict' in queued) {
        res.status(409).json({ error: '生产任务已在运行中' })
        return
      }
      res.status(201).json({ jobId: queued.jobId, pending: pending.c })
    } catch (err) {
      next(err)
    }
  })

  // ---------- v0.10.0（批B/I2）：质量债自动修复 ----------
  // 待修复数量（章节页徽标 + 设置页展示）
  router.get('/:novelId/debts', (req, res) => {
    const novelId = Number(req.params.novelId)
    const pending = db
      .prepare(
        `SELECT COUNT(DISTINCT chapter_id) AS c FROM quality_debt q
         JOIN chapter c ON c.id = q.chapter_id WHERE q.resolved = 0 AND c.novel_id = ?`
      )
      .get(novelId) as { c: number }
    res.json({ pendingDebts: Number(pending.c) || 0 })
  })

  // 手动触发自动修复（原子防重，复用 job 队列）
  router.post('/:novelId/debts/fix', (req, res, next) => {
    try {
      const novelId = Number(req.params.novelId)
      // R5：入队收拢 jobs/repository（与 production 收尾共用，消除复制 SQL）
      const result = enqueueDebtFixJob(db, novelId)
      if ('conflict' in result) {
        res.status(409).json({ error: '自动修复任务已在运行中' })
        return
      }
      res.status(201).json({ jobId: result.jobId })
    } catch (err) {
      next(err)
    }
  })

  // ---------- 状态 projection（前端轮询） ----------
  router.get('/:novelId/status', (req, res) => {    const novelId = Number(req.params.novelId)
    const chapters = db
      .prepare(
        "SELECT COUNT(*) AS c, SUM(CASE WHEN content != '' THEN 1 ELSE 0 END) AS written, SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed FROM chapter WHERE novel_id = ?"
      )
      .get(novelId) as { c: number; written: number | null; failed: number | null }
    const director = directorProgress(db, novelId)
    const activeJob = db
      .prepare(
        "SELECT id, type, status, progress, result_json FROM job WHERE status IN ('queued','running') AND json_extract(payload_json, '$.novelId') = ? ORDER BY id DESC LIMIT 1"
      )
      .get(novelId) as
      | { id: number; type: string; status: string; progress: number; result_json: string }
      | undefined
    // v0.22.2：下一步引导（书级"不知道该干什么"问题）——规则优先级：
    // ① 生产进行中 ② 正文未写完（含失败章） ③ 写完有质量债 ④ 全部完成
    const written = chapters.written ?? 0
    const total = chapters.c
    const failed = chapters.failed ?? 0
    const remaining = Math.max(0, total - written)
    const debts = db
      .prepare(
        'SELECT COUNT(DISTINCT chapter_id) AS c FROM quality_debt WHERE resolved = 0 AND chapter_id IN (SELECT id FROM chapter WHERE novel_id = ?)'
      )
      .get(novelId) as { c: number }
    let nextSteps: Record<string, unknown>
    if (activeJob) {
      nextSteps = {
        title: '生产进行中',
        description: `${activeJob.type === 'production' ? '正文生产' : '任务执行'}中：已完成 ${written}/${total} 章${failed > 0 ? `，${failed} 章失败待重试` : ''}——可到任务中心查看进度`,
        action: { label: '查看任务中心', to: '/tasks' }
      }
    } else if (remaining > 0) {
      nextSteps = {
        title: '继续生产正文',
        description: `本书已完成 ${written}/${total} 章（${failed > 0 ? `${failed} 章失败待重试，` : ''}剩余 ${remaining} 章待生产）——进入章节执行页开始生产`,
        action: { label: '进入章节执行', to: `/novels/${novelId}/chapters` }
      }
    } else if (debts.c > 0) {
      nextSteps = {
        title: '收尾：修复质量债',
        description: `正文已全部完成，还有 ${debts.c} 个章节有待修复项——建议先清理质量债再导出`,
        action: { label: '查看质量债', to: '/settings' }
      }
    } else {
      nextSteps = {
        title: '本书已完成',
        description: `全部 ${total} 章已写完且无待修复项——可导出全书或开启新书`,
        action: { label: '导出章节', to: `/novels/${novelId}/chapters` }
      }
    }
    res.json({
      novelId,
      chapters: total,
      written,
      failed,
      director: director
        ? {
            status: director.status,
            displayStatus: director.checkpoint.displayStatus,
            blockingReason: director.checkpoint.blockingReason ?? null
          }
        : null,
      activeJob: activeJob
        ? {
            id: activeJob.id,
            type: activeJob.type,
            status: activeJob.status,
            progress: activeJob.progress,
            detail: JSON.parse(activeJob.result_json || '{}')
          }
        : null,
      nextSteps
    })
  })

  // ---------- Creative Hub 对话 ----------
  router.post('/:novelId/hub/chat', async (req, res, next) => {
    try {
      const novelId = Number(req.params.novelId)
      const input = z.object({ message: z.string().min(1).max(4000) }).parse(req.body)
      const result = await hubChat(db, novelId, input.message)
      res.json(result)
    } catch (err) {
      next(err)
    }
  })

  return router
}
