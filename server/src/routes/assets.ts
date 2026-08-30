import { Router } from 'express'
import type { DatabaseSync } from 'node:sqlite'
import { z } from 'zod'
import { extractAsset, splitChapters, parseEpub, type AssetType } from '../services/assetExtractor'
import { callLlmJson } from '../services/jsonSafe'
import {
  deriveVolumeStructure,
  backfillChapterSummaries,
  deriveDirectionAndFraming,
  activateAsWorkingBook
} from '../services/bookConversion'
import { JSON_FORMAT } from '../prompts'

// ============================================================
// P23 批1：统一资产创建 API
//  /api/import/file       上传文件解析（TXT/MD/EPUB base64）
//  /api/assets/extract    文本 → AI 草稿（任意资产类型）
//  /api/knowledge         知识库保存（全局）
//  /api/world-templates   世界样本创建
//  /api/genres/:id        流派模板字段补齐
//  /api/anti-ai/assets    反 AI 词库新建
//  /api/titles/generate   自由输入生成标题
//  /api/base-characters   基础角色模板创建（N5）
// ============================================================

const ASSET_TYPES = ['knowledge', 'world', 'mode', 'style', 'genre', 'base-character', 'title', 'anti-ai'] as const

export function createAssetsRouter(db: DatabaseSync): Router {
  const router = Router()

  // ---------- v0.24.4（B4 网文要素生成器）：人名/地名/门派/功法/宝物/金手指 批量生成 ----------
  router.post('/forge/generate', async (req, res, next) => {
    try {
      const input = z
        .object({
          genre: z.string().min(1).max(30),
          categories: z.array(z.enum(['人名', '地名', '门派', '功法', '宝物', '金手指', '桥段'])).min(1).max(7),
          count: z.number().int().min(3).max(15).default(8),
          style: z.string().max(200).default('')
        })
        .parse(req.body ?? {})
      const prompt = [
        `你是网文设定要素生成器。为「${input.genre}」题材批量生成${input.categories.join('、')}，每类 ${input.count} 个。`,
        input.style ? `风格要求：${input.style}` : '',
        '要素要成体系：人名与姓氏/身份呼应，门派与功法风格一致，宝物与金手指有等级感，桥段给出触发方式与兑现点。',
        `请输出 JSON：{"items":[{"category":"人名","list":[{"name":"..","desc":"20 字以内的定位/背景"}]}]}`
      ].join('\n')
      const r = await callLlmJson<{ items: Array<{ category: string; list: Array<{ name: string; desc: string }> }> }>(
        db,
        'extraction',
        {
          novelId: 0,
          messages: [{ role: 'user', content: prompt }],
          maxTokens: 4096
        },
        (obj) => {
          const arr = (obj as { items?: unknown }).items
          if (!Array.isArray(arr) || arr.length === 0) return null
          return {
            items: arr
              .map((x) => {
                const i = x as Record<string, unknown>
                return {
                  category: String(i.category ?? ''),
                  list: Array.isArray(i.list)
                    ? (i.list as Array<Record<string, unknown>>)
                        .map((l) => ({ name: String(l.name ?? ''), desc: String(l.desc ?? '') }))
                        .filter((l) => l.name)
                    : []
                }
              })
              .filter((i) => i.category && i.list.length > 0)
          }
        },
        'forge-generate'
      )
      res.json({ items: r.items })
    } catch (err) {
      next(err)
    }
  })

  // ---------- 文件上传解析（base64，避免 multipart 依赖） ----------
  router.post('/import/file', async (req, res, next) => {
    try {
      const input = z
        .object({
          filename: z.string().min(1).max(200),
          base64: z.string().min(10),
          asChapters: z.boolean().default(false)
        })
        .parse(req.body ?? {})
      const name = input.filename.toLowerCase()
      let text = ''
      if (name.endsWith('.epub')) {
        text = await parseEpub(Buffer.from(input.base64, 'base64'))
      } else if (name.endsWith('.txt') || name.endsWith('.md') || name.endsWith('.markdown')) {
        text = Buffer.from(input.base64, 'base64').toString('utf8')
      } else {
        res.status(400).json({ error: '仅支持 TXT / MD / EPUB 文件' })
        return
      }
      if (text.length < 50) {
        res.status(400).json({ error: '文件内容过少（<50 字符）' })
        return
      }
      const truncated = text.length > 2_000_000
      const clipped = text.slice(0, 2_000_000)
      // v0.9.0（审查 D）：只解析一次（此前 splitChapters 被调用两次：chapters 与 chapterCount 各一次）
      const parsedChapters = input.asChapters ? splitChapters(clipped) : undefined
      res.json({
        title: input.filename.replace(/\.(txt|md|markdown|epub)$/i, ''),
        text: clipped,
        // v0.9.0：静默截断改为显式提示（此前 2MB 截断无任何告知）
        truncated: truncated || undefined,
        chapters: parsedChapters,
        chapterCount: parsedChapters?.length
      })
    } catch (err) {
      next(err)
    }
  })

  // ---------- AI 提取草稿 ----------
  router.post('/assets/extract', async (req, res, next) => {
    try {
      const input = z
        .object({
          type: z.enum(ASSET_TYPES),
          text: z.string().min(10).max(2_000_000),
          title: z.string().max(200).optional()
        })
        .parse(req.body ?? {})
      const result = await extractAsset(db, input.type as AssetType, input.text, input.title)
      res.json(result)
    } catch (err) {
      next(err)
    }
  })

  // ---------- 知识库保存（全局，novel_id=0） ----------
  router.post('/knowledge', (req, res, next) => {
    try {
      const input = z
        .object({
          title: z.string().min(1).max(100),
          content: z.string().min(10).max(50_000),
          status: z.enum(['direct', 'indexed', 'draft']).default('indexed'),
          // B1（D124）：触发词（逗号分隔）——内容命中即注入该词条设定
          keywords: z.string().max(200).optional().default('')
        })
        .parse(req.body ?? {})
      // v0.22.0（kb_doc 标题 ? 前缀事故防再犯）：标题清洗——trim + 去除首部孤立 ? 序列
      // （历史事故：6 篇全局文档标题带字面 ????? 前缀，0x3F 有损不可恢复，已由 fix-kb-titles.mjs 修复）
      const title = input.title.trim().replace(/^\?+/, '').trim()
      if (!title) {
        res.status(400).json({ error: '标题无效（含首部问号序列时请提供有效标题）' })
        return
      }
      const rid = db
        .prepare('INSERT INTO kb_doc (novel_id, title, content, source, status, keywords) VALUES (0, ?, ?, ?, ?, ?)')
        .run(title, input.content, 'imported', input.status, input.keywords)
      res.status(201).json({ id: Number(rid.lastInsertRowid) })
    } catch (err) {
      next(err)
    }
  })

  // ---------- 世界样本创建（N 补） ----------
  router.post('/world-templates', (req, res, next) => {
    try {
      const input = z
        .object({
          name: z.string().min(1).max(60),
          manual: z.record(z.string(), z.string()).default({}),
          factions: z.array(z.string()).default([]),
          map: z.record(z.string(), z.string()).default({}),
          timeline: z.array(z.string()).default([])
        })
        .parse(req.body ?? {})
      const rid = db
        .prepare(
          'INSERT INTO world_template (name, manual_json, factions_json, map_json, timeline_json) VALUES (?, ?, ?, ?, ?)'
        )
        .run(
          input.name,
          JSON.stringify(input.manual),
          JSON.stringify(input.factions),
          JSON.stringify(input.map),
          JSON.stringify(input.timeline)
        )
      res.status(201).json({ id: Number(rid.lastInsertRowid) })
    } catch (err) {
      next(err)
    }
  })

  // ---------- 流派模板字段补齐（PATCH /genres/:id） ----------
  router.patch('/genres/:id', (req, res, next) => {
    try {
      const id = Number(req.params.id)
      const input = z
        .object({
          genreType: z.string().max(30).optional(),
          propulsion: z.array(z.string()).optional(),
          payoff: z.array(z.string()).optional(),
          conflict: z.array(z.string()).optional(),
          beats: z.array(z.string()).optional()
        })
        .parse(req.body ?? {})
      const row = db.prepare('SELECT genre_type, propulsion_json, payoff_json, conflict_json, beat_templates_json FROM genre_asset WHERE id = ?').get(id) as
        | { genre_type: string; propulsion_json: string; payoff_json: string; conflict_json: string; beat_templates_json: string }
        | undefined
      if (!row) {
        res.status(404).json({ error: 'genre not found' })
        return
      }
      db.prepare(
        'UPDATE genre_asset SET genre_type = ?, propulsion_json = ?, payoff_json = ?, conflict_json = ?, beat_templates_json = ? WHERE id = ?'
      ).run(
        input.genreType ?? row.genre_type,
        JSON.stringify(input.propulsion ?? JSON.parse(row.propulsion_json || '[]')),
        JSON.stringify(input.payoff ?? JSON.parse(row.payoff_json || '[]')),
        JSON.stringify(input.conflict ?? JSON.parse(row.conflict_json || '[]')),
        JSON.stringify(input.beats ?? JSON.parse(row.beat_templates_json || '[]')),
        id
      )
      res.json({ ok: true })
    } catch (err) {
      next(err)
    }
  })

  // ---------- 反 AI 词库新建 ----------
  router.post('/anti-ai/assets', (req, res, next) => {
    try {
      const input = z
        .object({
          name: z.string().min(1).max(40),
          words: z.array(z.string().min(1)).min(1).max(200)
        })
        .parse(req.body ?? {})
      const rid = db
        .prepare("INSERT INTO prompt_asset (name, task_type, template, slots_json, notes) VALUES (?, 'anti_ai_lexicon', ?, '{}', 'P23 用户创建')")
        .run(input.name, JSON.stringify(input.words))
      res.status(201).json({ id: Number(rid.lastInsertRowid) })
    } catch (err) {
      next(err)
    }
  })

  // ---------- 自由输入生成标题 ----------
  router.post('/titles/generate', async (req, res, next) => {
    try {
      const input = z
        .object({
          description: z.string().min(4).max(1000),
          style: z.string().max(100).optional()
        })
        .parse(req.body ?? {})
      const result = await callLlmJson<{ titles: Array<{ title: string; reason: string }> }>(
        db,
        'extraction',
        {
          novelId: null as unknown as number,
          messages: [
            {
              role: 'user',
              content: `你是书名策划师。基于以下描述与风格偏好生成 10 个书名候选（风格多样：悬念/爽感/文艺/直白）。\n${JSON_FORMAT}\n\n描述：${input.description}${input.style ? `\n风格偏好：${input.style}` : ''}\n\n请输出 {"titles": [{"title": "书名（≤15字）", "reason": "理由（≤20字）"}]}`
            }
          ],
          maxTokens: 2048
        },
        (obj) => {
          const r = obj as Record<string, unknown>
          if (!Array.isArray(r.titles) || r.titles.length === 0) return null
          const titles = r.titles
            .map((t) => {
              const x = t as Record<string, unknown>
              if (typeof x.title !== 'string' || !x.title.trim()) return null
              return { title: String(x.title).slice(0, 15), reason: String(x.reason ?? '').slice(0, 20) }
            })
            .filter((t): t is { title: string; reason: string } => t !== null)
          return titles.length > 0 ? { titles } : null
        },
        'titles-generate'
      )
      res.json(result)
    } catch (err) {
      next(err)
    }
  })

  // ---------- 拆书外部书容器（P23 批2：导入建书，现有拆书零改动） ----------
  router.post('/import/book', (req, res, next) => {
    try {
      const input = z
        .object({
          title: z.string().min(1).max(100),
          chapters: z
            .array(z.object({ title: z.string().max(200).default(''), content: z.string().min(1).max(50_000) }))
            .min(1)
            .max(300)
        })
        .parse(req.body ?? {})
      const existing = db.prepare('SELECT id FROM novel WHERE title = ? AND is_external = 1').get(input.title) as
        | { id: number }
        | undefined
      if (existing) {
        res.status(409).json({ error: `外部书「${input.title}」已存在（可删除后重新导入）`, id: existing.id })
        return
      }
      db.exec('BEGIN')
      try {
        const rid = db
          .prepare(
            "INSERT INTO novel (title, inspiration, status, is_external, source_file) VALUES (?, '外部导入', 'imported', 1, ?)"
          )
          .run(input.title, 'file-import')
        const novelId = Number(rid.lastInsertRowid)
        const insertChapter = db.prepare(
          "INSERT INTO chapter (novel_id, title, summary, goal_json, content, status, word_count) VALUES (?, ?, '', '{}', ?, 'imported', ?)"
        )
        for (let i = 0; i < input.chapters.length; i++) {
          const ch = input.chapters[i]
          insertChapter.run(
            novelId,
            ch.title || `第 ${i + 1} 章`,
            ch.content,
            (ch.content.match(/[\u4e00-\u9fff]/g) ?? []).length
          )
        }
        db.exec('COMMIT')
        res.status(201).json({ id: novelId, chapterCount: input.chapters.length })
      } catch (err) {
        db.exec('ROLLBACK')
        throw err
      }
    } catch (err) {
      next(err)
    }
  })

  // ---------- B3（D125）：外部书 → 工作书转换（分步可选：卷结构+方向+激活；world/characters/style 由工作区面板按需补） ----------
  router.post('/import/book/:id/convert', async (req, res, next) => {
    try {
      const novelId = Number(req.params.id)
      const input = z
        .object({ steps: z.array(z.enum(['volume', 'direction', 'activate'])).min(1) })
        .parse(req.body ?? {})
      // 仅允许转换外部书（is_external=1），防止误转普通书
      const novel = db.prepare('SELECT id, is_external FROM novel WHERE id = ?').get(novelId) as
        | { id: number; is_external: number }
        | undefined
      if (!novel) {
        res.status(404).json({ error: 'novel not found' })
        return
      }
      if (Number(novel.is_external) !== 1) {
        res.status(400).json({ error: '仅外部导入书可转为工作书' })
        return
      }

      const result: Record<string, number | string> = {}
      for (const step of input.steps) {
        if (step === 'volume') result.volumes = await deriveVolumeStructure(db, novelId)
        if (step === 'direction') await deriveDirectionAndFraming(db, novelId)
        if (step === 'activate') {
          activateAsWorkingBook(db, novelId)
          result.summariesFilled = backfillChapterSummaries(db, novelId)
        }
      }
      res.json({ ok: true, steps: input.steps, ...result })
    } catch (err) {
      next(err)
    }
  })

  // ---------- 写法资产草稿保存（全局，P23 批1） ----------
  router.post('/style-assets', (req, res, next) => {
    try {
      const input = z
        .object({
          name: z.string().min(1).max(40),
          features: z
            .array(z.object({ category: z.string().default('other'), name: z.string().min(1), description: z.string().default('') }))
            .min(1),
          antiAiWords: z.array(z.string()).default([]),
          sample: z.string().max(5000).default('')
        })
        .parse(req.body ?? {})
      const rid = db
        .prepare(
          'INSERT INTO style_asset (novel_id, name, features_json, anti_ai_rules_json, samples_json, rules_json) VALUES (0, ?, ?, ?, ?, ?)'
        )
        .run(
          input.name,
          JSON.stringify(input.features),
          JSON.stringify(input.antiAiWords),
          JSON.stringify(input.sample ? [input.sample] : []),
          '[]'
        )
      res.status(201).json({ id: Number(rid.lastInsertRowid) })
    } catch (err) {
      next(err)
    }
  })

  // ---------- 基础角色模板创建（N5） ----------
  router.post('/base-characters', (req, res, next) => {
    try {
      const input = z
        .object({
          name: z.string().min(1).max(40),
          profile: z.record(z.string(), z.string()).default({})
        })
        .parse(req.body ?? {})
      const existing = db.prepare('SELECT id FROM base_character WHERE name = ?').get(input.name) as { id: number } | undefined
      if (existing) {
        res.status(409).json({ error: '模板已存在' })
        return
      }
      const rid = db
        .prepare('INSERT INTO base_character (name, profile_json) VALUES (?, ?)')
        .run(input.name, JSON.stringify(input.profile))
      res.status(201).json({ id: Number(rid.lastInsertRowid) })
    } catch (err) {
      next(err)
    }
  })

  return router
}
