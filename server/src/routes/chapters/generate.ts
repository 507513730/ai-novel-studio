// 章节执行路由：SSE 流式正文生成（传输层——生成核心在 chapterGeneration 域）
import type { Router } from 'express'
import type { DatabaseSync } from 'node:sqlite'
import { z } from 'zod'
import { buildChapterWriteContext } from '../../services/context/dynamic'
import { generateChapter } from '../../services/chapterGeneration/orchestrator'
import { generateChapterCandidates } from '../../services/chapterGeneration/candidates'

export function registerChapterGenerationRoutes(router: Router, db: DatabaseSync): void {
  router.post('/:novelId/chapters/:chapterId/generate', async (req, res) => {
    // P20（S5）：参数 zod 校验（NaN/越界/超大 guidance 一律 400）
    const genInput = z
      .object({
        guidance: z.string().max(1000).optional()
      })
      .safeParse(req.body ?? {})
    if (!genInput.success) {
      res.status(400).json({ error: 'invalid request body' })
      return
    }
    const novelId = z.coerce.number().int().positive().safeParse(req.params.novelId)
    const chapterId = z.coerce.number().int().positive().safeParse(req.params.chapterId)
    if (!novelId.success || !chapterId.success) {
      res.status(400).json({ error: 'invalid chapter id' })
      return
    }

    const abort = new AbortController()
    let aborted = false
    // v0.7.2+（Node24 语义修复）：Node 24 的 IncomingMessage 'close' 在请求体读完即触发，
    // 用 req.on('close') 会让 SSE 生成被自己立即 abort（所有事件被吞、0 字产出）。
    // 改监听 res 流：仅当响应未正常结束时触发 abort（= 客户端真正断连/取消）。
    res.on('close', () => {
      if (!res.writableEnded) {
        aborted = true
        abort.abort()
      }
    })

    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders()

    const send = (event: string, data: unknown): void => {
      if (aborted || res.writableEnded) return
      try {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
      } catch {
        /* 连接已死：停止写入（P20 D1：不再抛未捕获异常） */
      }
    }

    try {
      // B1：include 过滤（用户勾选的注入段）
      const include = req.query.include
        ? String(req.query.include)
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : undefined
      const ctx = buildChapterWriteContext(db, novelId.data, chapterId.data, { include })
      send('context', { frozenHash: ctx.frozenHash, budgetUsed: ctx.budgetUsed, budgetLimit: ctx.budgetLimit })

      const result = await generateChapter(db, novelId.data, chapterId.data, {
        signal: abort.signal,
        onDelta: (text) => send('delta', { text }),
        onThinking: (text) => send('thinking', { delta: text }),
        include,
        guidance: genInput.data.guidance // P19 ①：单次引导
      })

      if (result.aborted) {
        send('aborted', { content: result.content, wordCount: result.wordCount })
      } else {
        send('done', {
          content: result.content,
          wordCount: result.wordCount,
          usage: result.usage
        })
      }
      res.end()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('[generate] SSE error:', message)
      // v0.23.1（批次 A5）：复位仅限自己抢占的 generating（对齐章节域守卫——
      // 此前无守卫，理论上可把并发他方已置 written 的章节改标 failed）
      db.prepare(
        "UPDATE chapter SET status = 'failed', updated_at = datetime('now') WHERE id = ? AND status = 'generating'"
      ).run(chapterId.data)
      // v0.9.0（审查 #9）：SSE 事件只发固定文案（详细日志留服务端）
      send('error', { message: '生成失败，详情见服务端日志' })
      res.end()
    }
  })

  // v1.0 后续（A1 多候选分支生成）：串行生成 N 份候选构想，各存为 chapter_version 快照，
  // 不抢占章节、不改 chapter.content/status；返回候选列表供客户端并排对比，选定后走版本恢复。
  router.post('/:novelId/chapters/:chapterId/candidates', async (req, res, next) => {
    try {
      const input = z.object({ count: z.number().int().min(1).max(3).optional() }).parse(req.body ?? {})
      const novelId = z.coerce.number().int().positive().parse(req.params.novelId)
      const chapterId = z.coerce.number().int().positive().parse(req.params.chapterId)

      const include = req.query.include
        ? String(req.query.include)
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : undefined

      const abort = new AbortController()
      req.on('close', () => {
        if (!res.writableEnded) abort.abort()
      })

      const candidates = await generateChapterCandidates(db, novelId, chapterId, { count: input.count, include, signal: abort.signal })
      res.json({ candidates })
    } catch (err) {
      next(err)
    }
  })
}
