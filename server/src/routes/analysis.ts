import { Router } from 'express'
import type { DatabaseSync } from 'node:sqlite'
import { z } from 'zod'
import {
  runBookAnalysis,
  analyzeCharacter,
  analyzeCharacterEvolution,
  type AnalysisDepth,
  type CharacterProfileDepth
} from '../services/analysis'

export function createAnalysisRouter(db: DatabaseSync): Router {
  // P18 D2：角色演变分析——每章后自动更新 summary
  const dimText = (d: unknown): string => (typeof d === 'string' ? d : ((d as { summary?: unknown })?.summary as string) ?? '')
  const router = Router()

  // 拆书（三档）
  router.post('/:novelId/analysis', async (req, res, next) => {
    try {
      const novelId = Number(req.params.novelId)
      const input = z
        .object({ depth: z.enum(['quick', 'standard', 'full']).default('standard') })
        .parse(req.body)
      const report = await runBookAnalysis(db, novelId, input.depth as AnalysisDepth)
      res.json({ report })
    } catch (err) {
      next(err)
    }
  })

  router.get('/:novelId/analysis', (req, res) => {
    const novelId = Number(req.params.novelId)
    const rows = db
      .prepare(
        'SELECT id, depth, result_json, created_at FROM book_analysis WHERE novel_id = ? ORDER BY id DESC LIMIT 10'
      )
      .all(novelId) as Array<Record<string, unknown>>
    res.json({
      analyses: rows.map((r) => ({
        id: r.id,
        depth: r.depth,
        result: JSON.parse(String(r.result_json ?? '{}')),
        createdAt: r.created_at
      }))
    })
  })

  // 角色档案（四档）
  router.post('/:novelId/analysis/character', async (req, res, next) => {
    try {
      const novelId = Number(req.params.novelId)
      const input = z
        .object({
          name: z.string().min(1),
          depth: z.enum(['brief', 'standard', 'deep', 'full']).default('standard')
        })
        .parse(req.body)
      const profile = await analyzeCharacter(db, novelId, input.name, input.depth as CharacterProfileDepth)
      res.json({ profile })
    } catch (err) {
      next(err)
    }
  })

  // 形象演变（覆盖率扫描）
  router.post('/:novelId/analysis/evolution', async (req, res, next) => {
    try {
      const novelId = Number(req.params.novelId)
      const input = z
        .object({
          name: z.string().min(1),
          coverage: z.enum(['25', '50', '75', '100']).default('100')
        })
        .parse(req.body)
      const evolution = await analyzeCharacterEvolution(
        db,
        novelId,
        input.name,
        Number(input.coverage) as 25 | 50 | 75 | 100
      )
      res.json({ evolution })
    } catch (err) {
      next(err)
    }
  })

  // 拆书产物复用：发布知识库
  router.post('/:novelId/analysis/:analysisId/publish-kb', (req, res, next) => {
    try {
      const novelId = Number(req.params.novelId)
      const analysisId = Number(req.params.analysisId)
      const row = db
        .prepare('SELECT depth, result_json FROM book_analysis WHERE id = ? AND novel_id = ?')
        .get(analysisId, novelId) as { depth: string; result_json: string } | undefined
      if (!row) {
        res.status(404).json({ error: 'analysis not found' })
        return
      }
      const result = JSON.parse(row.result_json) as Record<string, unknown>
      // P18 D2：维度兼容（新对象格式取 summary，旧字符串格式原样）
      const dimText = (d: unknown): string => (typeof d === 'string' ? d : ((d as { summary?: unknown })?.summary as string) ?? '')
      const content = [
        `【拆书报告 · ${row.depth} 档】`,
        `题材定位：${dimText(result.genre)}`,
        `剧情结构：${dimText(result.structure)}`,
        `人物系统：${dimText(result.characters)}`,
        `世界设定：${dimText(result.world)}`,
        `写法技法：${dimText(result.style)}`,
        `优点：${Array.isArray(result.strengths) ? result.strengths.join('；') : ''}`,
        `缺点：${Array.isArray(result.weaknesses) ? result.weaknesses.join('；') : ''}`
      ].join('\n')
      const kb = db
        .prepare(
          "INSERT INTO kb_doc (novel_id, title, source, content, status) VALUES (?, ?, '拆书', ?, 'indexed')"
        )
        .run(novelId, `拆书报告（${row.depth} 档）`, content)
      res.status(201).json({ kbDocId: Number(kb.lastInsertRowid) })
    } catch (err) {
      next(err)
    }
  })

  // 拆书产物复用：转写法资产
  router.post('/:novelId/analysis/:analysisId/to-style', (req, res, next) => {
    try {
      const novelId = Number(req.params.novelId)
      const analysisId = Number(req.params.analysisId)
      const row = db
        .prepare('SELECT depth, result_json FROM book_analysis WHERE id = ? AND novel_id = ?')
        .get(analysisId, novelId) as { depth: string; result_json: string } | undefined
      if (!row) {
        res.status(404).json({ error: 'analysis not found' })
        return
      }
      const result = JSON.parse(row.result_json) as Record<string, unknown>
      // v0.17.0（审查 M9）：产出正确 StyleFeature 形状（此前 {feature,value} 与 StyleFeature 不兼容 → 永不编译为规则）
      const stamp = Date.now()
      const styleAsset = db
        .prepare(
          "INSERT INTO style_asset (novel_id, name, features_json, rules_json, samples_json, anti_ai_rules_json) VALUES (?, ?, ?, ?, ?, ?)"
        )
        .run(
          novelId,
          `拆书转写法-${analysisId}`,
          JSON.stringify([
            { id: `fs${stamp}-1`, name: '题材定位', description: dimText(result.genre), enabled: true, category: 'other' },
            { id: `fs${stamp}-2`, name: '写法技法', description: dimText(result.style), enabled: true, category: 'other' }
          ]),
          JSON.stringify({ source: '拆书', depth: row.depth }),
          '[]',
          '[]'
        )
      res.status(201).json({ styleAssetId: Number(styleAsset.lastInsertRowid) })
    } catch (err) {
      next(err)
    }
  })

  // 拆书产物复用：角色升格（角色档案写入 character profile 后确认入册）
  router.post('/:novelId/analysis/promote-character', (req, res, next) => {
    try {
      const novelId = Number(req.params.novelId)
      const input = z.object({ characterId: z.number().int().positive() }).parse(req.body)
      const row = db
        .prepare('SELECT id FROM character WHERE id = ? AND novel_id = ?')
        .get(input.characterId, novelId) as { id: number } | undefined
      if (!row) {
        res.status(404).json({ error: 'character not found' })
        return
      }
      db.prepare("UPDATE character SET status = 'roster', updated_at = datetime('now') WHERE id = ?").run(
        input.characterId
      )
      res.json({ ok: true })
    } catch (err) {
      next(err)
    }
  })

  return router
}
