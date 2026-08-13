import { Router } from 'express'
import type { DatabaseSync } from 'node:sqlite'
import { z } from 'zod'
import { getAppSetting, setAppSetting, getMonthlyCost } from '../services/appSettings'
import { getExchangeRate, getRateSource, getRateUpdatedAt, setRateManual, clearRateManual, refreshAutoRate } from '../services/currency'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { encryptSecret, decryptSecret } from '../services/keyCrypto'
import { TASK_TYPES } from '../db/seed'
import OpenAI from 'openai'

export const OPENCODE_GO_BASE_URL = 'https://opencode.ai/zen/go/v1'
export const OPENCODE_GO_NAME = 'OpenCode Go 网关'

const providerSchema = z.object({
  name: z.string().min(1),
  baseUrl: z.string().url().or(z.literal('')),
  apiKey: z.string().optional().default(''),
  isCustom: z.boolean().optional().default(false)
})

const routeSchema = z.object({
  taskType: z.enum(TASK_TYPES),
  providerId: z.number().int().positive(),
  model: z.string().min(1),
  thinkingEnabled: z.boolean().default(false),
  reasoningEffort: z.enum(['low', 'high', 'max']).default('high'),
  temperature: z.number().min(0).max(2).nullable().default(null),
  maxTokens: z.number().int().positive().default(8192),
  fallback: z.array(z.object({ providerId: z.number(), model: z.string() })).default([])
})

export function createSettingsRouter(db: DatabaseSync): Router {
  const router = Router()

  // ---------- import from opencode auth.json ----------
  router.post('/import-opencode', async (req, res, next) => {
    try {
      const input = z
        .object({
          provider: z.enum(['opencode-go', 'deepseek']).default('opencode-go'),
          baseUrl: z.string().url().optional()
        })
        .parse(req.body)

      const authPath = join(homedir(), '.local', 'share', 'opencode', 'auth.json')
      if (!existsSync(authPath)) {
        // v0.9.0（审查 #9）：路径只进日志，不随响应回显
        console.error('[import-opencode] auth.json not found at:', authPath)
        res.status(404).json({ error: 'opencode auth.json not found（详见服务端日志）' })
        return
      }
      const auth = JSON.parse(readFileSync(authPath, 'utf-8')) as Record<
        string,
        { type?: string; key?: string }
      >
      const cred = auth[input.provider]
      if (!cred?.key) {
        res.status(404).json({ error: `provider '${input.provider}' not found in opencode auth.json` })
        return
      }

      const name =
        input.provider === 'opencode-go' ? OPENCODE_GO_NAME : 'DeepSeek（opencode 导入）'
      const baseUrl = input.baseUrl ?? (input.provider === 'opencode-go' ? OPENCODE_GO_BASE_URL : 'https://api.deepseek.com')
      const encrypted = await encryptSecret(cred.key)

      const existing = db.prepare('SELECT id FROM provider WHERE name = ?').get(name) as
        | { id: number }
        | undefined
      if (existing) {
        db.prepare('UPDATE provider SET base_url = ?, api_key_encrypted = ? WHERE id = ?').run(
          baseUrl,
          encrypted,
          existing.id
        )
        res.json({ ok: true, id: existing.id, name, imported: true })
      } else {
        const result = db
          .prepare(
            'INSERT INTO provider (name, base_url, api_key_encrypted, is_custom) VALUES (?, ?, ?, ?)'
          )
          .run(name, baseUrl, encrypted, 1)
        res.status(201).json({ ok: true, id: Number(result.lastInsertRowid), name, imported: false })
      }
    } catch (err) {
      next(err)
    }
  })

  // ---------- providers ----------
  router.get('/providers', (_req, res) => {
    const rows = db
      .prepare(
        'SELECT id, name, base_url, is_custom, api_key_encrypted != \'\' AS has_key FROM provider ORDER BY id'
      )
      .all() as Array<{
      id: number
      name: string
      base_url: string
      is_custom: number
      has_key: number
    }>
    res.json({
      providers: rows.map((r) => ({
        id: r.id,
        name: r.name,
        baseUrl: r.base_url,
        isCustom: r.is_custom === 1,
        hasKey: r.has_key === 1
      }))
    })
  })

  router.post('/providers', async (req, res, next) => {
    try {
      const input = providerSchema.parse(req.body)
      const encrypted = await encryptSecret(input.apiKey)
      const result = db
        .prepare('INSERT INTO provider (name, base_url, api_key_encrypted, is_custom) VALUES (?, ?, ?, ?)')
        .run(input.name, input.baseUrl, encrypted, input.isCustom ? 1 : 0)
      res.status(201).json({ id: Number(result.lastInsertRowid) })
    } catch (err) {
      next(err)
    }
  })

  router.patch('/providers/:id', async (req, res, next) => {
    try {
      const id = Number(req.params.id)
      const input = providerSchema.partial().parse(req.body)
      const current = db.prepare('SELECT * FROM provider WHERE id = ?').get(id) as
        | { api_key_encrypted: string; name: string; base_url: string; is_custom: number }
        | undefined
      if (!current) {
        res.status(404).json({ error: 'provider not found' })
        return
      }
      const encrypted =
        input.apiKey !== undefined && input.apiKey !== ''
          ? await encryptSecret(input.apiKey)
          : current.api_key_encrypted
      db.prepare(
        'UPDATE provider SET name = ?, base_url = ?, api_key_encrypted = ?, is_custom = ? WHERE id = ?'
      ).run(
        // v0.9.0（审查 #17）：缺省保留当前值（此前 name/baseUrl 用额外查询取，isCustom 缺省硬编码重置为 1 覆盖内置标记）
        input.name ?? current.name,
        input.baseUrl ?? current.base_url,
        encrypted,
        input.isCustom !== undefined ? (input.isCustom ? 1 : 0) : current.is_custom,
        id
      )
      res.json({ ok: true })
    } catch (err) {
      next(err)
    }
  })

  router.delete('/providers/:id', (req, res) => {
    const id = Number(req.params.id)
    const used = db.prepare('SELECT COUNT(*) AS c FROM model_route WHERE provider_id = ?').get(id) as { c: number }
    if (used.c > 0) {
      res.status(409).json({ error: 'provider is referenced by model routes' })
      return
    }
    db.prepare('DELETE FROM provider WHERE id = ?').run(id)
    res.json({ ok: true })
  })

  // ---------- model routes ----------
  router.get('/model-routes', (_req, res) => {
    const rows = db
      .prepare(
        `SELECT mr.id, mr.task_type, mr.model, mr.thinking_enabled, mr.reasoning_effort,
                mr.temperature, mr.max_tokens, mr.fallback_json,
                p.id AS provider_id, p.name AS provider_name
         FROM model_route mr JOIN provider p ON p.id = mr.provider_id ORDER BY mr.id`
      )
      .all() as Array<{
      id: number
      task_type: string
      model: string
      thinking_enabled: number
      reasoning_effort: string
      temperature: number | null
      max_tokens: number
      fallback_json: string
      provider_id: number
      provider_name: string
    }>
    res.json({
      routes: rows.map((r) => ({
        id: r.id,
        taskType: r.task_type,
        providerId: r.provider_id,
        providerName: r.provider_name,
        model: r.model,
        thinkingEnabled: r.thinking_enabled === 1,
        reasoningEffort: r.reasoning_effort as 'low' | 'high' | 'max',
        temperature: r.temperature,
        maxTokens: r.max_tokens,
        fallback: JSON.parse(r.fallback_json) as Array<{ providerId: number; model: string }>
      }))
    })
  })

  router.put('/model-routes/:taskType', (req, res, next) => {
    try {
      const input = routeSchema.parse({ ...req.body, taskType: req.params.taskType })
      db.prepare(
        `INSERT INTO model_route
         (task_type, provider_id, model, thinking_enabled, reasoning_effort, temperature, max_tokens, fallback_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(task_type) DO UPDATE SET
           provider_id = excluded.provider_id,
           model = excluded.model,
           thinking_enabled = excluded.thinking_enabled,
           reasoning_effort = excluded.reasoning_effort,
           temperature = excluded.temperature,
           max_tokens = excluded.max_tokens,
           fallback_json = excluded.fallback_json,
           updated_at = datetime('now')`
      ).run(
        input.taskType,
        input.providerId,
        input.model,
        input.thinkingEnabled ? 1 : 0,
        input.reasoningEffort,
        input.temperature,
        input.maxTokens,
        JSON.stringify(input.fallback)
      )
      res.json({ ok: true })
    } catch (err) {
      next(err)
    }
  })

  // ---------- connectivity test ----------
  router.post('/test-connection', async (req, res, next) => {
    try {
      const input = z
        .object({
          providerId: z.number().int().positive(),
          taskType: z.enum(TASK_TYPES).default('prose'),
          model: z.string().min(1).optional()
        })
        .parse(req.body)
      const providerRow = db
        .prepare('SELECT id, name, base_url, api_key_encrypted FROM provider WHERE id = ?')
        .get(input.providerId) as
        | { id: number; name: string; base_url: string; api_key_encrypted: string }
        | undefined
      if (!providerRow) {
        res.status(404).json({ error: '供应商不存在' })
        return
      }
      if (!providerRow.api_key_encrypted) {
        res.status(400).json({ error: '该供应商未配置 API Key' })
        return
      }
      const apiKey = await decryptSecret(providerRow.api_key_encrypted)
      const client = new OpenAI({
        baseURL: providerRow.base_url || undefined,
        apiKey,
        timeout: 60_000
      })
      const model = input.model ?? 'deepseek-v4-flash'
      const response = await client.chat.completions.create({
        model,
        messages: [{ role: 'user', content: '只回复两个字：连通' }],
        max_tokens: 16
      })
      res.json({
        ok: true,
        model: response.model ?? model,
        provider: providerRow.name,
        reply: response.choices[0]?.message?.content ?? ''
      })
    } catch (err) {
      next(err)
    }
  })

  // ---------- usage stats ----------
  router.get('/usage/stats', (req, res) => {
    const novelId = req.query.novel ? Number(req.query.novel) : null
    const task = req.query.task ? String(req.query.task) : null
    const from = req.query.from ? String(req.query.from) : null
    const to = req.query.to ? String(req.query.to) : null

    let sql = `SELECT task_type, provider, model, COUNT(*) AS calls,
                      SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens,
                      SUM(cache_hit) AS cache_hit, SUM(cache_miss) AS cache_miss,
                      SUM(cost_estimate) AS cost, SUM(degraded) AS degraded
               FROM usage_log WHERE 1=1`
    const params: Array<number | string> = []
    if (novelId) {
      sql += ' AND novel_id = ?'
      params.push(novelId)
    }
    if (task) {
      sql += ' AND task_type = ?'
      params.push(task)
    }
    if (from) {
      sql += ' AND created_at >= ?'
      params.push(from)
    }
    if (to) {
      sql += ' AND created_at <= ?'
      params.push(to)
    }
    sql += ' GROUP BY task_type, provider, model ORDER BY cost DESC'

    // v0.16.0：成本统一人民币显示（内部 USD，按汇率换算输出 CNY）
    const rate = getExchangeRate(db)
    const groups = (db.prepare(sql).all(...params) as Array<Record<string, number>>).map((g) => ({
      ...g,
      cost: Number(((Number(g.cost) || 0) * rate).toFixed(4))
    }))
    const total = db
      .prepare(
        `SELECT COUNT(*) AS calls,
                COALESCE(SUM(input_tokens),0) AS input_tokens,
                COALESCE(SUM(output_tokens),0) AS output_tokens,
                COALESCE(SUM(cache_hit),0) AS cache_hit,
                COALESCE(SUM(cache_miss),0) AS cache_miss,
                COALESCE(SUM(cost_estimate),0) AS cost
         FROM usage_log`
      )
      .get() as Record<string, number>
    total.cost = Number(((Number(total.cost) || 0) * rate).toFixed(4))
    res.json({ total, groups })
  })

  // ---------- v0.10.0（批B）：成本预警 + 质量债自动修复开关；v0.16.0：汇率 ----------
  router.get('/app', (_req, res) => {
    const budget = Number(getAppSetting(db, 'cost_monthly_budget')) || 0
    res.json({
      costMonthlyBudget: budget,
      autoFixDebts: getAppSetting(db, 'auto_fix_debts') === '1',
      // v0.16.0：月度成本统一人民币（内部 USD × 汇率）
      monthlyCost: Number((getMonthlyCost(db) * getExchangeRate(db)).toFixed(2)),
      cnyUsdRate: getExchangeRate(db),
      cnyUsdRateSource: getRateSource(db),
      cnyUsdRateAt: getRateUpdatedAt(db)
    })
  })

  router.patch('/app', (req, res, next) => {
    try {
      const input = z
        .object({
          costMonthlyBudget: z.number().min(0).max(100000).optional(),
          autoFixDebts: z.boolean().optional(),
          // v0.16.0：手动设置汇率（>0 生效）或恢复自动获取
          cnyUsdRate: z.number().min(0.5).max(50).optional(),
          cnyUsdRateReset: z.boolean().optional()
        })
        .parse(req.body)
      if (input.costMonthlyBudget !== undefined) {
        setAppSetting(db, 'cost_monthly_budget', String(Math.round(input.costMonthlyBudget * 100) / 100))
      }
      if (input.autoFixDebts !== undefined) {
        setAppSetting(db, 'auto_fix_debts', input.autoFixDebts ? '1' : '0')
      }
      if (input.cnyUsdRate !== undefined && input.cnyUsdRate > 0) {
        setRateManual(db, input.cnyUsdRate)
      }
      if (input.cnyUsdRateReset) {
        clearRateManual(db)
        // 恢复自动：立即联网拉取一次（失败静默，下次启动重试）
        void refreshAutoRate(db)
      }
      res.json({ ok: true })
    } catch (err) {
      next(err)
    }
  })


  // ---------- P19：写作偏好（语言 / 格式 / 写作模式） ----------
  router.get('/writing', (_req, res) => {
    const rows = db.prepare('SELECT key, value FROM app_settings').all() as Array<{ key: string; value: string }>
    const map = new Map(rows.map((r) => [r.key, r.value]))
    res.json({
      lang: map.get('lang') ?? 'simplified',
      format: map.get('format') ?? 'paragraph',
      writingMode: map.get('writingMode') ?? 'standard'
    })
  })

  router.patch('/writing', (req, res, next) => {
    try {
      const input = z
        .object({
          lang: z.enum(['simplified', 'traditional']).optional(),
          format: z.enum(['paragraph', 'longSentence']).optional(),
          writingMode: z.enum(['focused', 'standard', 'free']).optional()
        })
        .parse(req.body ?? {})
      const upsert = db.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      if (input.lang !== undefined) upsert.run('lang', input.lang)
      if (input.format !== undefined) upsert.run('format', input.format)
      if (input.writingMode !== undefined) upsert.run('writingMode', input.writingMode)
      res.json({ ok: true })
    } catch (err) {
      next(err)
    }
  })

  // ---------- P20（C7）：质量债聚合（按书，可消费） ----------
  router.get('/quality-debts', (_req, res) => {
    const rows = db
      .prepare(
        `SELECT c.novel_id AS novel_id, n.title,
                SUM(CASE WHEN q.severity = 'high' THEN 1 ELSE 0 END) AS high_count,
                SUM(CASE WHEN q.severity = 'medium' THEN 1 ELSE 0 END) AS medium_count,
                SUM(CASE WHEN q.resolved = 1 THEN 1 ELSE 0 END) AS resolved_count
         FROM quality_debt q
         JOIN chapter c ON c.id = q.chapter_id
         JOIN novel n ON n.id = c.novel_id
         GROUP BY c.novel_id ORDER BY high_count DESC`
      )
      .all() as Array<Record<string, number | string>>
    // v0.15.0：约束遵守统计（违反记录 → 遵守率 = 1 - 违反/产出章节数）
    for (const r of rows) {
      const novelId = Number(r.novel_id)
      const viol = db
        .prepare("SELECT COUNT(*) AS c FROM quality_debt q JOIN chapter c ON c.id = q.chapter_id WHERE c.novel_id = ? AND q.issue LIKE '[约束违反]%'")
        .get(novelId) as { c: number }
      const chapters = db.prepare("SELECT COUNT(*) AS c FROM chapter WHERE novel_id = ? AND status = 'written'").get(novelId) as { c: number }
      r.constraintViolations = viol.c
      r.constraintAdherence = chapters.c > 0 ? Math.max(0, Math.round((1 - viol.c / chapters.c) * 100)) : 100
    }
    res.json({ debts: rows })
  })

  // ---------- P20（T3）：历史清理（usage_log >90 天、失败/取消 job >30 天） ----------
  router.post('/cleanup', (_req, res) => {
    const usage = db
      .prepare("DELETE FROM usage_log WHERE created_at < datetime('now', '-90 days')")
      .run()
    const jobs = db
      .prepare(
        "DELETE FROM job WHERE status IN ('failed', 'cancelled') AND updated_at < datetime('now', '-30 days')"
      )
      .run()
    res.json({ usageDeleted: usage.changes, jobsDeleted: jobs.changes })
  })

  // ---------- settings bootstrap (first-run detection) ----------
  router.get('/bootstrap', (_req, res) => {
    const providers = db.prepare('SELECT COUNT(*) AS c FROM provider').get() as { c: number }
    const hasKey = db.prepare("SELECT COUNT(*) AS c FROM provider WHERE api_key_encrypted != ''").get() as {
      c: number
    }
    res.json({
      firstRun: providers.c === 0,
      providersConfigured: providers.c > 0,
      hasApiKey: hasKey.c > 0,
      schemaVersion: (db.prepare('SELECT MAX(version) AS v FROM _migrations').get() as { v: number }).v
    })
  })

  return router
}
