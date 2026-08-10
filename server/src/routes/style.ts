import { Router } from 'express'
import type { DatabaseSync } from 'node:sqlite'
import { z } from 'zod'
import {
  extractStyleFeatures,
  getBoundStyleRules,
  detectAntiAiHits,
  trialWrite,
  type StyleFeature
} from '../services/styleEngine'

export function createStyleRouter(db: DatabaseSync): Router {
  const router = Router()

  // 提取特征（示例文本 → 特征池）
  router.post('/:novelId/style/extract', async (req, res, next) => {
    try {
      const novelId = Number(req.params.novelId)
      const input = z.object({ sample: z.string().min(200), name: z.string().min(1) }).parse(req.body)
      const features = await extractStyleFeatures(db, novelId, input.sample, input.name)
      res.status(201).json({ features })
    } catch (err) {
      next(err)
    }
  })

  // 特征池（启停/组合）
  router.get('/:novelId/style', (req, res) => {
    const novelId = Number(req.params.novelId)
    const rows = db
      .prepare('SELECT id, name, features_json, anti_ai_rules_json, created_at FROM style_asset WHERE novel_id = ? ORDER BY id DESC')
      .all(novelId) as Array<Record<string, unknown>>
    res.json({
      assets: rows.map((r) => ({
        id: r.id,
        name: r.name,
        features: JSON.parse(String(r.features_json ?? '[]')) as StyleFeature[],
        antiAiWords: JSON.parse(String(r.anti_ai_rules_json ?? '[]')) as string[],
        createdAt: r.created_at
      }))
    })
  })

  // 更新特征启停
  router.patch('/:novelId/style/:assetId', (req, res, next) => {
    try {
      const novelId = Number(req.params.novelId)
      const assetId = Number(req.params.assetId)
      const input = z
        .object({
          features: z.array(
            z.object({ id: z.string(), name: z.string(), description: z.string(), enabled: z.boolean(), category: z.string() })
          ).optional()
        })
        .parse(req.body)
      const existing = db
        .prepare('SELECT * FROM style_asset WHERE id = ? AND novel_id = ?')
        .get(assetId, novelId) as Record<string, unknown> | undefined
      if (!existing) {
        res.status(404).json({ error: 'style asset not found' })
        return
      }
      if (input.features) {
        db.prepare('UPDATE style_asset SET features_json = ? WHERE id = ?').run(
          JSON.stringify(input.features),
          assetId
        )
      }
      res.json({ ok: true })
    } catch (err) {
      next(err)
    }
  })

  // 编译规则（查看效果）
  router.get('/:novelId/style/:assetId/compiled', (req, res) => {
    const compiled = getBoundStyleRules(db, Number(req.params.novelId))
    res.json({ compiled })
  })

  // 反 AI 检测
  router.post('/:novelId/style/anti-ai-check', (req, res, next) => {
    try {
      const input = z.object({ text: z.string() }).parse(req.body)
      const bound = getBoundStyleRules(db, Number(req.params.novelId))
      const antiAiWords = bound ? extractAntiAiWords(bound.antiAiRules) : []
      const hits = detectAntiAiHits(input.text, antiAiWords)
      res.json({ hits, total: hits.reduce((a, h) => a + h.count, 0) })
    } catch (err) {
      next(err)
    }
  })

  // 试写对比
  router.post('/:novelId/style/trial', async (req, res, next) => {
    try {
      const novelId = Number(req.params.novelId)
      const input = z.object({ task: z.string().min(10) }).parse(req.body)
      const result = await trialWrite(db, novelId, input.task)
      res.json(result)
    } catch (err) {
      next(err)
    }
  })

  // 外部资料直塞（P4：替代 RAG 的低成本方案）
  router.post('/:novelId/style/external', (req, res, next) => {
    try {
      const novelId = Number(req.params.novelId)
      const input = z.object({ title: z.string().min(1), content: z.string().min(50) }).parse(req.body)
      // 写入 kb_doc（供直塞注入读取）
      const kb = db
        .prepare(
          "INSERT INTO kb_doc (novel_id, title, source, content, status) VALUES (?, ?, '外部资料', ?, 'direct')"
        )
        .run(novelId, input.title, input.content)
      res.status(201).json({ kbDocId: Number(kb.lastInsertRowid) })
    } catch (err) {
      next(err)
    }
  })

  // P17-1：全局写法资产（novel_id=0 表示全局，零迁移；供 /style-engine 全局页）
  router.get('/:novelId/style/global', (_req, res) => {
    const rows = db
      .prepare(
        `SELECT a.id, a.novel_id, a.name, a.features_json,
                n.title AS novel_title
         FROM style_asset a LEFT JOIN novel n ON n.id = a.novel_id
         ORDER BY a.novel_id IS NOT NULL, a.novel_id, a.id`
      )
      .all() as Array<{
      id: number
      novel_id: number
      name: string
      features_json: string
      novel_title: string | null
    }>
    res.json({
      assets: rows.map((r) => ({
        id: r.id,
        novelId: r.novel_id,
        name: r.name,
        global: r.novel_id === 0,
        novelTitle: r.novel_title ?? '',
        features: JSON.parse(r.features_json || '[]')
      }))
    })
  })

  // 创建全局写法资产（示例文本 → 特征）
  router.post('/:novelId/style/global', async (req, res, next) => {
    try {
      const input = z.object({ sample: z.string().min(200), name: z.string().min(1) }).parse(req.body)
      const features = await extractStyleFeatures(db, 0, input.sample, input.name)
      res.status(201).json({ features })
    } catch (err) {
      next(err)
    }
  })

  // 导入全局写法到书（复制到 novel_id）
  router.post('/:novelId/style/global/:assetId/import', (req, res, next) => {
    try {
      const novelId = Number(req.params.novelId)
      const assetId = Number(req.params.assetId)
      if (!novelId) {
        res.status(400).json({ error: 'novelId 必填' })
        return
      }
      const src = db
        .prepare('SELECT name, features_json, rules_json, samples_json, anti_ai_rules_json FROM style_asset WHERE id = ? AND novel_id = 0')
        .get(assetId) as
        | { name: string; features_json: string; rules_json: string; samples_json: string; anti_ai_rules_json: string }
        | undefined
      if (!src) {
        res.status(404).json({ error: '全局写法资产不存在' })
        return
      }
      const dup = db
        .prepare('SELECT id FROM style_asset WHERE novel_id = ? AND name = ?')
        .get(novelId, src.name) as { id: number } | undefined
      if (dup) {
        res.status(409).json({ error: `该书已存在同名写法「${src.name}」` })
        return
      }
      const r = db
        .prepare(
          'INSERT INTO style_asset (novel_id, name, features_json, rules_json, samples_json, anti_ai_rules_json) VALUES (?, ?, ?, ?, ?, ?)'
        )
        .run(novelId, src.name, src.features_json, src.rules_json, src.samples_json, src.anti_ai_rules_json)
      res.status(201).json({ id: Number(r.lastInsertRowid) })
    } catch (err) {
      next(err)
    }
  })

  // P16 P1：反 AI 词库管理（prompt_asset 的 anti_ai_lexicon / anti_ai_template）
  router.get('/:novelId/style/anti-ai/lexicon', (_req, res) => {    const rows = db
      .prepare(
        "SELECT id, name, task_type, template FROM prompt_asset WHERE task_type IN ('anti_ai_lexicon','anti_ai_template') ORDER BY id"
      )
      .all() as Array<{ id: number; name: string; task_type: string; template: string }>
    res.json({
      assets: rows.map((r) => ({
        id: r.id,
        name: r.name,
        type: r.task_type,
        words: JSON.parse(r.template || '[]') as string[]
      }))
    })
  })

  router.patch('/:novelId/style/anti-ai/lexicon/:id', (req, res, next) => {
    try {
      const id = Number(req.params.id)
      const input = z.object({ words: z.array(z.string().min(1)) }).parse(req.body)
      db.prepare('UPDATE prompt_asset SET template = ? WHERE id = ? AND task_type LIKE ?').run(
        JSON.stringify(input.words),
        id,
        'anti_ai_%'
      )
      res.json({ ok: true })
    } catch (err) {
      next(err)
    }
  })

  return router
}

function extractAntiAiWords(rules: string[]): string[] {
  const words: string[] = []
  for (const rule of rules) {
    const m = rule.match(/严禁出现以下词汇\/句式：(.+)/)
    if (m) {
      for (const w of m[1].split(/[、，,]/)) words.push(w.trim())
    }
  }
  return words.filter(Boolean)
}
