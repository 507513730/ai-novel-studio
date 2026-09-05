import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'

const common = pathToFileURL(join(process.cwd(), 'scripts/e2e/common.mjs')).href

describe('E2E 发布门禁', () => {
  it('首个失败保存 partial 并阻止后续付费步骤', () => {
    const dir = mkdtempSync(join(tmpdir(), 'novel-e2e-failfast-'))
    const suiteFile = join(dir, 'suites.json')
    const script = `const { startRound, ok, finishRound } = await import(${JSON.stringify(common)});
      startRound('T1 配置'); ok(true, '通过'); finishRound('T1 配置');
      startRound('T2 创作'); ok(false, '故障注入'); console.log('SHOULD_NOT_RUN');`
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      encoding: 'utf8', env: { ...process.env, E2E_REPORT: join(dir, 'report.md'), E2E_SUITE_RESULTS: suiteFile, E2E_FAIL_FAST: '1' }
    })
    expect(result.status).toBe(1)
    expect(result.stdout).not.toContain('SHOULD_NOT_RUN')
    const suites = JSON.parse(readFileSync(suiteFile, 'utf8'))
    expect(suites).toHaveLength(2)
    expect(suites[0].completed).toBe(true)
    expect(suites[1]).toMatchObject({ id: 'T2', completed: false, fail: 1 })
  })

  it('SSE 和导出也必须通过统一隔离客户端', () => {
    const round = readFileSync(join(process.cwd(), 'scripts/e2e/round.mjs'), 'utf8')
    expect(round).not.toContain('127.0.0.1:3000')
    expect(round).not.toMatch(/\bfetch\s*\(/)
    expect(round).toContain('apiRaw(')
  })

  it('使用显式测试地址与 token，保留调用方请求头', () => {
    const script = `const { api } = await import(${JSON.stringify(common)});
      globalThis.fetch = async (url, init) => {
        console.log(JSON.stringify({ url, headers: init.headers, method: init.method }));
        return { ok: true, json: async () => ({ ok: true }) };
      };
      await api('/health', { method: 'GET', headers: { 'X-Test': 'yes' } });`
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      encoding: 'utf8', env: { ...process.env, E2E_BASE_URL: 'http://127.0.0.1:43210/api', E2E_APP_TOKEN: 'test-only' }
    })
    expect(result.status).toBe(0)
    const sent = JSON.parse(result.stdout)
    expect(sent.url).toBe('http://127.0.0.1:43210/api/health')
    expect(sent.headers['X-App-Token']).toBe('test-only')
    expect(sent.headers['X-Test']).toBe('yes')
  })

  it('失败退出非零，后续轮次不清除失败证据', () => {
    const dir = mkdtempSync(join(tmpdir(), 'novel-e2e-contract-'))
    const report = join(dir, 'report.md')
    const script = `const { startRound, ok, finishRound } = await import(${JSON.stringify(common)});
      startRound('失败轮'); ok(false, '故障注入'); const first = finishRound('失败轮');
      startRound('成功轮'); ok(true, '通过'); finishRound('成功轮');
      console.log(JSON.stringify(first));`
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      encoding: 'utf8', env: { ...process.env, E2E_REPORT: report }
    })
    expect(result.status).toBe(1)
    expect(result.stdout).toContain('"failures":["故障注入"]')
    expect(readFileSync(report, 'utf8')).toContain('故障注入')
  })
})
