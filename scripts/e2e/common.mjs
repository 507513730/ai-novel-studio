// P14 D：e2e 测试公共库（API 客户端 + 断言 + 报告）
import { readFileSync, appendFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const BASE = 'http://127.0.0.1:3000/api'

export const REPORT = 'D:/OpenCode/projects/ai-novel-studio/docs/test-report.md'

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

export function ensureReportHeader() {
  mkdirSync('D:/OpenCode/projects/ai-novel-studio/docs', { recursive: true })
  const head = readFileSync(REPORT, 'utf8').length === 0 ? '' : ''
  if (head === '') {
    // 已有内容则不动
  }
}
