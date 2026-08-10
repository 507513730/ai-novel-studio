import { Router } from 'express'
import type { DatabaseSync } from 'node:sqlite'
import { z } from 'zod'

// P17-2：资源页端点（推进模式库 / 世界样本库 / 知识库页）
export function createResourcesRouter(db: DatabaseSync): Router {
  const router = Router()

  // ---------- 推进模式库（story_mode） ----------
  router.get('/story-modes', (_req, res) => {
    const rows = db
      .prepare('SELECT id, name, description, pattern_json, created_at FROM story_mode ORDER BY id')
      .all() as Array<{ id: number; name: string; description: string; pattern_json: string; created_at: string }>
    res.json({
      modes: rows.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        pattern: JSON.parse(r.pattern_json || '{}'),
        createdAt: r.created_at
      }))
    })
  })

  router.post('/story-modes', (req, res, next) => {
    try {
      const input = z.object({ name: z.string().min(1).max(30), description: z.string().max(300).default(''), pattern: z.unknown().default({}) }).parse(req.body)
      const r = db
        .prepare('INSERT INTO story_mode (name, description, pattern_json) VALUES (?, ?, ?)')
        .run(input.name.trim(), input.description, JSON.stringify(input.pattern))
      res.status(201).json({ id: Number(r.lastInsertRowid) })
    } catch (err) {
      next(err)
    }
  })

  router.delete('/story-modes/:id', (req, res) => {
    db.prepare('DELETE FROM story_mode WHERE id = ?').run(Number(req.params.id))
    res.json({ ok: true })
  })

  // ---------- 世界样本库（world_template） ----------
  router.get('/world-templates', (_req, res) => {
    const rows = db
      .prepare('SELECT id, name, manual_json, factions_json, map_json, timeline_json, created_at FROM world_template ORDER BY id')
      .all() as Array<{ id: number; name: string; manual_json: string; factions_json: string; map_json: string; timeline_json: string; created_at: string }>
    res.json({
      templates: rows.map((r) => ({
        id: r.id,
        name: r.name,
        manual: JSON.parse(r.manual_json || '{}'),
        factions: JSON.parse(r.factions_json || '[]'),
        map: JSON.parse(r.map_json || '{}'),
        timeline: JSON.parse(r.timeline_json || '[]'),
        createdAt: r.created_at
      }))
    })
  })

  // 从书保存为样本
  router.post('/world-templates/from-novel/:novelId', (req, res, next) => {
    try {
      const novelId = Number(req.params.novelId)
      const input = z.object({ name: z.string().min(1).max(40) }).parse(req.body)
      const world = db
        .prepare('SELECT manual_json, factions_json, map_json, timeline_json FROM world WHERE novel_id = ?')
        .get(novelId) as
        | { manual_json: string; factions_json: string; map_json: string; timeline_json: string }
        | undefined
      if (!world) {
        res.status(404).json({ error: '该书世界观不存在' })
        return
      }
      const r = db
        .prepare('INSERT INTO world_template (name, manual_json, factions_json, map_json, timeline_json) VALUES (?, ?, ?, ?, ?)')
        .run(input.name.trim(), world.manual_json, world.factions_json, world.map_json, world.timeline_json)
      res.status(201).json({ id: Number(r.lastInsertRowid) })
    } catch (err) {
      next(err)
    }
  })

  // 应用样本到书（覆盖该书世界）
  router.post('/world-templates/:id/apply/:novelId', (req, res, next) => {
    try {
      const templateId = Number(req.params.id)
      const novelId = Number(req.params.novelId)
      const t = db.prepare('SELECT manual_json, factions_json, map_json, timeline_json FROM world_template WHERE id = ?').get(templateId) as
        | { manual_json: string; factions_json: string; map_json: string; timeline_json: string }
        | undefined
      if (!t) {
        res.status(404).json({ error: '样本不存在' })
        return
      }
      db.prepare(
        "UPDATE world SET manual_json = ?, factions_json = ?, map_json = ?, timeline_json = ?, updated_at = datetime('now') WHERE novel_id = ?"
      ).run(t.manual_json, t.factions_json, t.map_json, t.timeline_json, novelId)
      res.json({ ok: true })
    } catch (err) {
      next(err)
    }
  })

  router.delete('/world-templates/:id', (req, res) => {
    db.prepare('DELETE FROM world_template WHERE id = ?').run(Number(req.params.id))
    res.json({ ok: true })
  })

  // ---------- 知识库页（kb_doc 总览） ----------
  router.get('/knowledge', (_req, res) => {
    const rows = db
      .prepare(
        `SELECT k.id, k.novel_id, k.title, k.source, k.status, k.created_at, n.title AS novel_title
         FROM kb_doc k LEFT JOIN novel n ON n.id = k.novel_id
         ORDER BY k.id DESC LIMIT 100`
      )
      .all() as Array<{ id: number; novel_id: number; title: string; source: string; status: string; created_at: string; novel_title: string | null }>
    res.json({
      docs: rows.map((r) => ({
        id: r.id,
        novelId: r.novel_id,
        title: r.title,
        source: r.source,
        status: r.status,
        novelTitle: r.novel_title ?? '',
        createdAt: r.created_at
      }))
    })
  })

  router.delete('/knowledge/:id', (req, res) => {
    db.prepare('DELETE FROM kb_doc WHERE id = ?').run(Number(req.params.id))
    res.json({ ok: true })
  })

  // ---------- 基础角色模板库（P18 D1） ----------
  router.get('/base-characters', (_req, res) => {
    const rows = db
      .prepare(
        `SELECT b.id, b.name, b.profile_json, b.source_novel_id, b.created_at, n.title AS source_title
         FROM base_character b LEFT JOIN novel n ON n.id = b.source_novel_id
         ORDER BY b.id`
      )
      .all() as Array<{ id: number; name: string; profile_json: string; source_novel_id: number | null; created_at: string; source_title: string | null }>
    res.json({
      templates: rows.map((r) => ({
        id: r.id,
        name: r.name,
        profile: JSON.parse(r.profile_json || '{}'),
        sourceNovelId: r.source_novel_id,
        sourceTitle: r.source_title ?? '',
        createdAt: r.created_at
      }))
    })
  })

  // 从书角色另存为模板
  router.post('/base-characters/from-character', (req, res, next) => {
    try {
      const input = z
        .object({ novelId: z.number().int().positive(), characterId: z.number().int().positive() })
        .parse(req.body)
      const ch = db
        .prepare('SELECT name, profile_json, ledger_json FROM character WHERE id = ? AND novel_id = ?')
        .get(input.characterId, input.novelId) as
        | { name: string; profile_json: string; ledger_json: string }
        | undefined
      if (!ch) {
        res.status(404).json({ error: '角色不存在' })
        return
      }
      const dup = db.prepare('SELECT id FROM base_character WHERE name = ?').get(ch.name) as { id: number } | undefined
      if (dup) {
        res.status(409).json({ error: `模板「${ch.name}」已存在` })
        return
      }
      const r = db
        .prepare('INSERT INTO base_character (name, profile_json, ledger_json, source_novel_id) VALUES (?, ?, ?, ?)')
        .run(ch.name, ch.profile_json, ch.ledger_json, input.novelId)
      res.status(201).json({ id: Number(r.lastInsertRowid) })
    } catch (err) {
      next(err)
    }
  })

  // 应用模板到书（INSERT character, status=roster）
  router.post('/base-characters/:id/apply', (req, res, next) => {
    try {
      const templateId = Number(req.params.id)
      const input = z.object({ novelId: z.number().int().positive() }).parse(req.body)
      const t = db.prepare('SELECT name, profile_json, ledger_json FROM base_character WHERE id = ?').get(templateId) as
        | { name: string; profile_json: string; ledger_json: string }
        | undefined
      if (!t) {
        res.status(404).json({ error: '模板不存在' })
        return
      }
      const dup = db
        .prepare('SELECT id FROM character WHERE novel_id = ? AND name = ?')
        .get(input.novelId, t.name) as { id: number } | undefined
      if (dup) {
        res.status(409).json({ error: `该书已有同名角色「${t.name}」` })
        return
      }
      const r = db
        .prepare("INSERT INTO character (novel_id, name, profile_json, ledger_json, status) VALUES (?, ?, ?, ?, 'roster')")
        .run(input.novelId, t.name, t.profile_json, t.ledger_json)
      res.status(201).json({ id: Number(r.lastInsertRowid) })
    } catch (err) {
      next(err)
    }
  })

  router.delete('/base-characters/:id', (req, res) => {
    db.prepare('DELETE FROM base_character WHERE id = ?').run(Number(req.params.id))
    res.json({ ok: true })
  })

  return router
}
