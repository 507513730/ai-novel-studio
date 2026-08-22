// P14 D：e2e 测试公共库（API 客户端 + 断言 + 报告）
import { appendFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

export const BASE = 'http://127.0.0.1:3000/api'

// v0.23.1（批次 B4）：报告路径改为仓库相对（此前硬编码本机绝对路径——他机/CI 必写坏路径）；
// v0.24.3（文档治理）：默认写入 release/（gitignored——详情轮次不是仓库资产）；
// 发布级汇总用 E2E_REPORT=docs/test-report.md 覆盖
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
export const REPORT = process.env.E2E_REPORT ?? join(REPO_ROOT, 'release', 'e2e-report.md')

let pass = 0
let fail = 0
const failures = []

export function ok(cond, name, detail = '') {
  if (cond) {
    pass++
    console.log(`  ✓ ${name}`)
  } else {
    fail++
    failures.push(`${name}${detail ? ' — ' + detail : ''}`)
    console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`)
  }
}

export async function api(path, init) {
  const res = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json' },
    ...init
  })
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
  pass = 0
  fail = 0
  failures.length = 0
  console.log(`\n== ${title} ==`)
}

export function finishRound(title, extra = '') {
  const line = `| ${title} | ${pass} | ${fail} | ${failures.join('; ').slice(0, 300)} | ${extra} |`
  appendFileSync(REPORT, line + '\n')
  return { pass, fail, failures, extra }
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
