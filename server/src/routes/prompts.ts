import { Router } from 'express'
import type { DatabaseSync } from 'node:sqlite'
import { z } from 'zod'
import { callLlm } from '../services/llm/caller'
import { invalidatePromptCache } from '../prompts/promptAsset'

// P17-5A：提示词工作台端点（资产列表 / 更新 / 试跑）
export function createPromptsRouter(db: DatabaseSync): Router {
  const router = Router()

  router.get('/', (_req, res) => {
    const rows = db
      .prepare(
        "SELECT id, name, task_type, template, slots_json, notes FROM prompt_asset WHERE task_type LIKE 'sys_%' OR task_type LIKE 'anti_ai_%' ORDER BY task_type, id"
      )
      .all() as Array<{ id: number; name: string; task_type: string; template: string; slots_json: string; notes: string }>
    res.json({
      prompts: rows.map((r) => ({
        id: r.id,
        name: r.name,
        taskType: r.task_type,
        template: r.template,
        slots: JSON.parse(r.slots_json || '{}'),
        notes: r.notes
      }))
    })
  })

  router.patch('/:id', (req, res, next) => {
    try {
      const id = Number(req.params.id)
      const input = z.object({ template: z.string().min(1) }).parse(req.body)
      db.prepare('UPDATE prompt_asset SET template = ?, notes = ? WHERE id = ?').run(input.template, '已编辑（工作台）', id)
      invalidatePromptCache()
      res.json({ ok: true })
    } catch (err) {
      next(err)
    }
  })

  // ---------- P23 批3（N8）：新建提示词 + 出厂还原 ----------
  router.post('/', (req, res, next) => {
    try {
      const input = z
        .object({
          name: z.string().min(1).max(60),
          template: z.string().min(1).max(20_000),
          notes: z.string().max(200).default('')
        })
        .parse(req.body ?? {})
      const rid = db
        .prepare(
          "INSERT INTO prompt_asset (name, task_type, template, slots_json, notes, original_template) VALUES (?, 'custom', ?, '{}', ?, ?)"
        )
        .run(input.name, input.template, input.notes, input.template)
      res.status(201).json({ id: Number(rid.lastInsertRowid) })
    } catch (err) {
      next(err)
    }
  })

  router.post('/:id/restore', (req, res, next) => {
    try {
      const id = Number(req.params.id)
      const row = db
        .prepare("SELECT original_template, template FROM prompt_asset WHERE id = ? AND original_template != ''")
        .get(id) as { original_template: string; template: string } | undefined
      if (!row) {
        res.status(400).json({ error: '该提示词无出厂模板（自定义提示词无需还原）' })
        return
      }
      db.prepare("UPDATE prompt_asset SET template = ?, notes = '已还原出厂' WHERE id = ?").run(
        row.original_template,
        id
      )
      invalidatePromptCache()
      res.json({ ok: true })
    } catch (err) {
      next(err)
    }
  })

  // 试跑：用渲染后的模板作为 system，最小生成测试
  router.post('/test', async (req, res, next) => {
    try {
      const input = z
        .object({
          template: z.string().min(1),
          vars: z.record(z.string(), z.string()).default({}),
          model: z.string().optional()
        })
        .parse(req.body)
      const text = input.template.replace(/\$\{(\w+)\}/g, (m, name: string) => input.vars[name] ?? m)
      const result = await callLlm(db, 'chat', {
        messages: [
          { role: 'system', content: text },
          { role: 'user', content: '按上述要求输出一段测试内容（简短即可）。' }
        ],
        maxTokens: 300
      })
      res.json({ content: result.content, model: result.model })
    } catch (err) {
      next(err)
    }
  })

  return router
}
