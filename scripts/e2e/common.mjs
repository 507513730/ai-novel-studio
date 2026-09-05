// P14 D：e2e 测试公共库（API 客户端 + 断言 + 报告）
import { appendFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

export const BASE = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3000/api'

// v0.23.1（批次 B4）：报告路径改为仓库相对（此前硬编码本机绝对路径——他机/CI 必写坏路径）；
// v0.24.3（文档治理）：默认写入 release/（gitignored——详情轮次不是仓库资产）；
// 发布级汇总用 E2E_REPORT=docs/test-report.md 覆盖
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
export const REPORT = process.env.E2E_REPORT ?? join(REPO_ROOT, 'release', 'e2e-report.md')

let pass = 0
let fail = 0
const failures = []
const suiteResults = []
let currentTitle = ''

export function ok(cond, name, detail = '') {
  if (cond) {
    pass++
    console.log(`  ✓ ${name}`)
  } else {
    fail++
    failures.push(`${name}${detail ? ' — ' + detail : ''}`)
    console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`)
    if (process.env.E2E_FAIL_FAST === '1') {
      const partial = { id: currentTitle.split(' ')[0], title: currentTitle, pass, fail, completed: false, failures: [...failures] }
      if (process.env.E2E_SUITE_RESULTS) writeFileSync(process.env.E2E_SUITE_RESULTS, JSON.stringify([...suiteResults, partial]), 'utf8')
      throw new Error('E2E 断言失败：' + name)
    }
  }
}

export async function apiRaw(path, init) {
  return fetch(BASE + path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(process.env.E2E_APP_TOKEN ? { 'X-App-Token': process.env.E2E_APP_TOKEN } : {}),
      ...init?.headers
    }
  })
}

export async function api(path, init) {
  const res = await apiRaw(path, init)
  const body = await res.json().catch(() => null)
  if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`)
  return body
}

export async function apiTry(path, init) {
  try {
    return { ok: true, body: await api(path, init) }
  } catch (e) {
    return { ok: false, error: e.message }
  }
}

export function startRound(title) {
  currentTitle = title
  pass = 0
  fail = 0
  failures.length = 0
  console.log(`\n== ${title} ==`)
}

export function finishRound(title, extra = '') {
  const line = `| ${title} | ${pass} | ${fail} | ${failures.join('; ').slice(0, 300)} | ${extra} |`
  appendFileSync(REPORT, line + '\n')
  if (fail > 0) process.exitCode = 1
  const result = { completed: true, id: title.split(' ')[0], title, pass, fail, failures: [...failures], extra }
  suiteResults.push(result)
  if (process.env.E2E_SUITE_RESULTS) writeFileSync(process.env.E2E_SUITE_RESULTS, JSON.stringify(suiteResults), 'utf8')
  return result
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

// v0.23.1（批次 D）：job 轮询等待——refine-range/solution-chapter 迁 job 队列后 e2e 用
export async function waitJob(jobId, timeoutMs = 10 * 60 * 1000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const d = await api('/jobs')
    const job = d.jobs.find((x) => x.id === jobId)
    if (job && ['done', 'failed', 'cancelled'].includes(job.status)) return job
    if (Date.now() > deadline) throw new Error(`job ${jobId} 等待超时`)
    await sleep(2000)
  }
}
