// 章节执行路由：A1 选区 AI 操作（modify/insert/append）
import type { Router } from 'express'
import type { DatabaseSync } from 'node:sqlite'
import { z } from 'zod'
import { callLlmJson } from '../../services/jsonSafe'
import { getBoundStyleRules } from '../../services/styleEngine'
import { AI_ACTIONS, AI_INSERT_ACTIONS } from '../../prompts'

export function registerChapterAiActionRoutes(router: Router, db: DatabaseSync): void {
  router.post('/:novelId/chapters/:chapterId/ai-action', async (req, res, next) => {
    try {
      const novelId = Number(req.params.novelId)
      const chapterId = Number(req.params.chapterId)
      const input = z
        .object({
          action: z.enum([...Object.keys(AI_ACTIONS), ...Object.keys(AI_INSERT_ACTIONS)] as [
            string,
            ...string[]
          ]),
          selection: z.string().optional().default(''),
          instruction: z.string().optional().default(''),
          // v0.9.0（审查 D）：cursor 禁止负值（此前负值时 content.slice(0, -5) 产生错误上下文）
          cursorPosition: z.number().int().nonnegative().optional()
        })
        .parse(req.body)

      const chapter = db
        .prepare('SELECT title, content FROM chapter WHERE id = ? AND novel_id = ?')
        .get(chapterId, novelId) as { title: string; content: string } | undefined
      if (!chapter) {
        res.status(404).json({ error: 'chapter not found' })
        return
      }

      const bound = getBoundStyleRules(db, novelId)
      const styleRules = bound ? [...bound.rules, ...bound.antiAiRules].join('\n') : ''
      const isInsert = input.action in AI_INSERT_ACTIONS
      const actionMeta = isInsert ? AI_INSERT_ACTIONS[input.action] : AI_ACTIONS[input.action]
      const selection = input.selection || ''
      const instruction = input.instruction ? `\n补充要求：${input.instruction}` : ''
      const styleBlock = styleRules ? `\n【本书写法规则（文风对齐时遵守）】\n${styleRules}` : ''

      let content = ''
      if (isInsert) {
        // insert/continue：给出选区上下文 + 光标前后文，插入到选区位置或文末
        const before = chapter.content.slice(0, input.cursorPosition ?? chapter.content.length)
        const after = chapter.content.slice(input.cursorPosition ?? chapter.content.length)
        content = `${actionMeta.prompt}${instruction}${styleBlock}\n\n【上文】\n${before.slice(-2000)}\n\n【下文（若有）】\n${after.slice(0, 500)}`
      } else {
        // modify：改写选中文字
        content = `${actionMeta.prompt}${instruction}${styleBlock}\n\n【选中文字】\n${selection}`
      }

      const result = await callLlmJson<{ content: string }>(
        db,
        'extraction',
        {
          novelId,
          messages: [
            {
              role: 'user',
              content: `${content}\n\n输出 JSON：{"content": "改写/生成的文字（只输出替换内容，不含任何解释）"}`
            }
          ],
          maxTokens: 4096
        },
        (obj) => {
          const r = obj as Record<string, unknown>
          return typeof r.content === 'string' && r.content.length > 0 ? { content: r.content } : null
        },
        `ai-action-${input.action}`
      )

      res.json({
        action: input.action,
        isInsert,
        content: result.content,
        appliedAt: input.cursorPosition ?? (isInsert ? chapter.content.length : undefined)
      })
    } catch (err) {
      next(err)
    }
  })
}
