// 重构计划 R5：统一错误模型 → HTTP 状态映射契约。
// ZodError→400 / ConfigurationError(含 ConfigError)→400 带可操作指引 /
// CancellationError→499（取消语义不伪装成 500）/ TransientProviderError→503 /
// OutputValidationError→502 / SQLite 约束→409 / chapter not found→404 / 其余→500 固定文案。
import { describe, expect, it } from 'vitest'
import express from 'express'
import type { Server } from 'node:http'
import { ZodError, z } from 'zod'
import { apiErrorMiddleware } from '../server/src/services/apiError'
import { ConfigurationError, CancellationError, TransientProviderError, OutputValidationError } from '../server/src/services/shared/errors'
import { ConfigError } from '../server/src/services/llm/errors'

function makeApp(): express.Express {
  const app = express()
  app.use(express.json())
  const cases: Array<[string, () => never]> = [
    ['/zod', () => { throw new ZodError([]) }],
    ['/config', () => { throw new ConfigurationError('prose 路由未配置 API Key——请在 设置 → 供应商 保存后重试') }],
    ['/config-compat', () => { throw new ConfigError('key 解密失败') }],
    ['/cancel', () => { throw new CancellationError() }],
    ['/transient', () => { throw new TransientProviderError('upstream timeout') }],
    ['/output', () => { throw new OutputValidationError('生成被 max_tokens 截断') }],
    ['/constraint', () => { throw new Error('UNIQUE constraint failed: novel.title') }],
    ['/notfound', () => { throw new Error('chapter not found') }],
    ['/generic', () => { throw new TypeError('cannot read property x of y') }]
  ]
  for (const [path, thrower] of cases) {
    app.get(path, (_req, res, next) => {
      try {
        thrower()
      } catch (err) {
        next(err)
      }
    })
  }
  // 校验 zod 解析路径（真实路由经 z.safeParse → next(ZodError)）
  app.post('/validate', (req, res, next) => {
    try {
      z.object({ n: z.number() }).parse(req.body)
      res.json({ ok: true })
    } catch (err) {
      next(err)
    }
  })
  app.use(apiErrorMiddleware)
  return app
}

async function withServer(fn: (base: string) => Promise<void>): Promise<void> {
  const server: Server = await new Promise((resolve) => {
    const s = makeApp().listen(0, () => resolve(s))
  })
  const { port } = server.address() as { port: number }
  try {
    await fn(`http://127.0.0.1:${port}`)
  } finally {
    server.close()
  }
}

describe('apiErrorMiddleware 错误映射契约（R5）', () => {
  it('ZodError → 400 参数校验失败（含 issues）', async () => {
    await withServer(async (base) => {
      const res = await fetch(`${base}/validate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ n: 'not-a-number' })
      })
      expect(res.status).toBe(400)
      const body = (await res.json()) as { error: string; issues: unknown[] }
      expect(body.error).toBe('参数校验失败')
      expect(Array.isArray(body.issues)).toBe(true)
    })
  })

  it('ConfigurationError 与兼容 ConfigError → 400 且消息为可操作指引', async () => {
    await withServer(async (base) => {
      // 消息透传：配置类错误消息本身即用户可操作指引（或诊断信息），不再被 'internal error' 吞掉
      const expectations: Array<[string, string]> = [
        ['/config', 'prose 路由未配置 API Key——请在 设置 → 供应商 保存后重试'],
        ['/config-compat', 'key 解密失败']
      ]
      for (const [path, expected] of expectations) {
        const res = await fetch(`${base}${path}`)
        expect(res.status).toBe(400)
        const body = (await res.json()) as { error: string }
        expect(body.error).toBe(expected)
      }
    })
  })

  it('CancellationError → 499（取消语义不伪装成 500）', async () => {
    await withServer(async (base) => {
      const res = await fetch(`${base}/cancel`)
      expect(res.status).toBe(499)
      const body = (await res.json()) as { error: string }
      expect(body.error).toBe('操作已取消')
    })
  })

  it('TransientProviderError → 503 固定文案；OutputValidationError → 502 固定文案', async () => {
    await withServer(async (base) => {
      const transient = await fetch(`${base}/transient`)
      expect(transient.status).toBe(503)
      expect(((await transient.json()) as { error: string }).error).toBe('上游服务暂时不可用，请稍后重试')

      const output = await fetch(`${base}/output`)
      expect(output.status).toBe(502)
      expect(((await output.json()) as { error: string }).error).toBe('模型输出校验失败，请重试或调整参数')
    })
  })

  it('既有映射保持不变：约束→409 / chapter not found→404 / 其余→500 固定文案', async () => {
    await withServer(async (base) => {
      const conflict = await fetch(`${base}/constraint`)
      expect(conflict.status).toBe(409)
      expect(((await conflict.json()) as { error: string }).error).toBe('数据冲突（约束不满足）')

      const notFound = await fetch(`${base}/notfound`)
      expect(notFound.status).toBe(404)
      expect(((await notFound.json()) as { error: string }).error).toBe('chapter not found')

      const generic = await fetch(`${base}/generic`)
      expect(generic.status).toBe(500)
      const body = (await generic.json()) as { error: string }
      expect(body.error).toBe('internal error')
      expect(body.error).not.toContain('TypeError') // 防内部信息泄露
    })
  })

  it('ConfigError instanceof 兼容：ConfigurationError 与 ConfigError 双向成立', () => {
    const err = new ConfigError('x')
    expect(err).toBeInstanceOf(ConfigurationError)
    expect(err).toBeInstanceOf(ConfigError)
    expect(err.name).toBe('ConfigError')
  })
})
