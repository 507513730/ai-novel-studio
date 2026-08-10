import { Router } from 'express'
import type { DatabaseSync } from 'node:sqlite'
import { z } from 'zod'
import { callLlm } from '../services/llm'
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
