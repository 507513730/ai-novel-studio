// v0.9.2（O1）：打包态等价验收（原 v0.7.2）——模拟 file:// 页面（Origin: null + X-App-Token）调用打包版核心链路
// 验证：① 无 token 403；② 带 token 正常；③ SSE 章节生成真实跑通；④ 章节导出（TXT）可用
// 自包含：自动启动 out/main/server.js（发布后自动验收用）；亦可 BASE/TOKEN/UDATA 外部注入
import { spawn } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdirSync, rmSync } from 'node:fs'

const ROOT = dirname(fileURLToPath(import.meta.url)) + '/..'
const PORT = process.env.VERIFY_PORT ?? '39999'
const BASE = process.env.BASE ?? `http://127.0.0.1:${PORT}/api`
const TOKEN = process.env.TOKEN ?? `pack-verify-${Date.now()}`
const UDATA = process.env.UDATA ?? join(ROOT, 'release', '.verify-tmp')

rmSync(UDATA, { recursive: true, force: true })
mkdirSync(UDATA, { recursive: true })
const server = spawn(process.execPath, [join(ROOT, 'out', 'main', 'server.js')], {
  // R8 修复：非 utilityProcess 直跑需明文直通（与 release.mjs 验收一致），否则 import-opencode 存 key 被 fail-closed 拒绝
  env: { ...process.env, AI_NOVEL_USER_DATA: UDATA, AI_NOVEL_PORT: PORT, SERVER_TOKEN: TOKEN, AI_NOVEL_ALLOW_PLAINTEXT: '1' },
  stdio: 'ignore'
})
let ready = false
// R8 修复：v0.25.0 起全请求强制 X-App-Token——就绪探测必须带 token（此前 403 循环至超时误报"未就绪"）
for (let i = 0; i < 30; i++) {
  try {
    const r = await fetch(`${BASE}/health`, { headers: { Origin: 'null', 'X-App-Token': TOKEN } })
    if (r.ok) { ready = true; break }
  } catch { /* not ready yet */ }
  await new Promise((r) => setTimeout(r, 500))
}
if (!ready) {
  console.error('server 未就绪')
  server.kill()
  process.exit(1)
}
const shutdown = () => {
  server.kill()
}
process.on('exit', shutdown)

async function req(path, { method = 'GET', token = true, body, stream = false } = {}) {
  const headers = { Origin: 'null' }
  if (token) headers['X-App-Token'] = TOKEN
  if (body) headers['Content-Type'] = 'application/json'
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined })
  if (stream) return res
  return { status: res.status, json: await res.json().catch(() => null) }
}

const ok = (name, cond, extra = '') => {
  console.log(`${cond ? '✓' : '✗'} ${name}${extra ? ' | ' + extra : ''}`)
  if (!cond) process.exitCode = 1
}

const resp = async (p, init) => { const r = await fetch(`${BASE}${p}`, init); return { status: r.status, text: await r.text() } }

// ① 无 token → 403（打包态必须拦截）
const noToken = await resp('/health', { headers: { Origin: 'null' } })
ok('无 token → 403', noToken.status === 403, `status=${noToken.status}`)

// ② 带 token → 200
const health = await resp('/health', { headers: { Origin: 'null', 'X-App-Token': TOKEN } })
const healthJson = JSON.parse(health.text || '{}')
ok('带 token → 200', health.status === 200, `status=${health.status} dbVersion=${healthJson.dbVersion}`)

// ③ 导入 OpenCode Go provider（复用 e2e 用法）
await req('/settings/import-opencode', { method: 'POST', body: { provider: 'opencode-go' } })
for (const task of ['prose', 'extraction', 'summary']) {
  await req(`/settings/model-routes/${task}`, { method: 'PUT', body: { providerId: 2, model: 'deepseek-v4-flash', maxTokens: 4096 } })
}

// 建书 + 建章
const novel = await req('/novels', { method: 'POST', body: { inspiration: 'v0.7.2 打包态验收：雨夜古巷的守夜人' } })
const novelId = novel.json?.id
ok('建书', !!novelId, `novel=${novelId}`)
const chap = await req(`/novels/${novelId}/chapters`, { method: 'POST', body: { title: '第一章 守夜人' } })
const chapterId = chap.json?.id ?? chap.json?.chapterId ?? chap.json?.chapter?.id
ok('建章', !!chapterId, `chapter=${chapterId}`)

// ④ SSE 生成（打包态核心链路）—— Origin:null + token 流式读
const sseRes = await req(`/novels/${novelId}/chapters/${chapterId}/generate`, {
  method: 'POST',
  body: { guidance: '三百字，场景感强' },
  stream: true
})
console.log(`  SSE status=${sseRes.status}`)
let text = ''
let doneEvent = null
const eventLog = []
if (sseRes.status === 200 && sseRes.body) {
  const reader = sseRes.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const events = buf.split('\n\n')
    buf = events.pop() ?? ''
    for (const evt of events) {
      let type = 'message'
      let data = ''
      for (const line of evt.split('\n')) {
        if (line.startsWith('event: ')) type = line.slice(7)
        else if (line.startsWith('data: ')) data += line.slice(6)
      }
      if (!data) continue
      const payload = JSON.parse(data)
      eventLog.push(type)
      if (type === 'delta') text += payload.text ?? ''
      else if (type === 'done') doneEvent = payload
      else if (type === 'error') console.log(`  SSE error 事件: ${String(payload.message ?? '').slice(0, 120)}`)
    }
  }
} else {
  console.log(`SSE status=${sseRes.status}`)
}
console.log(`  SSE 事件序列: ${eventLog.slice(0, 8).join(',')}${eventLog.length > 8 ? `, ...共${eventLog.length}` : ''}`)
ok('SSE 生成跑通', doneEvent !== null && text.length > 100, `${text.length} 字`)

// ⑤ 章节导出 TXT（打包态核心链路）—— 路径 /novels/:id/export?format=txt
const exportRes = await req(`/novels/${novelId}/export?format=txt`, { stream: true })
console.log(`  export status=${exportRes.status}`)
const exportBody = exportRes.status === 200 ? await exportRes.text() : ''
ok('章节导出 TXT', exportRes.status === 200 && exportBody.includes('守夜人'), `bytes=${exportBody.length}`)

console.log(process.exitCode ? '\n[FAIL] 存在失败项' : '\n[PASS] 打包态等价验收全部通过')

// 强制退出（exit handler 会 kill server 子进程）——undici keep-alive 连接池句柄会让进程挂起
process.exit(process.exitCode ?? 0)
