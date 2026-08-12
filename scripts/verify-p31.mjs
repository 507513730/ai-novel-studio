// v0.12.0（批D/P31）验收：mc-good2.0 绑定 → 整本生产 3 章（卷章定位生效）
// 用法：FF_DIR=<feelfish 目录> node scripts/verify-p31.mjs
import { readFileSync, readdirSync, rmSync, mkdirSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const FF_DIR = process.env.FF_DIR ?? ''
const BASE = 'http://127.0.0.1:39997/api'

async function api(path, init) {
  const res = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json' },
    ...init
  })
  const body = await res.json().catch(() => null)
  if (!res.ok) throw new Error(`${path}: ${JSON.stringify(body ?? {}).slice(0, 200)}`)
  return body
}

const userData = join(ROOT, 'release', '.p31-verify')
rmSync(userData, { recursive: true, force: true })
mkdirSync(userData, { recursive: true })
const server = spawn(process.execPath, [join(ROOT, 'out', 'main', 'server.js')], {
  env: { ...process.env, AI_NOVEL_USER_DATA: userData, AI_NOVEL_PORT: '39997' },
  stdio: 'ignore'
})
let ready = false
for (let i = 0; i < 30; i++) {
  try {
    const r = await fetch(BASE + '/health')
    if (r.ok) { ready = true; break }
  } catch { /* not ready */ }
  await new Promise((r) => setTimeout(r, 500))
}
if (!ready) { console.error('server 未就绪'); server.kill(); process.exit(1) }

try {
  await api('/settings/import-opencode', { method: 'POST', body: JSON.stringify({ provider: 'opencode-go' }) })
  for (const task of ['prose', 'planning', 'review', 'analysis', 'summary', 'extraction', 'director', 'chat']) {
    await api(`/settings/model-routes/${task}`, { method: 'PUT', body: JSON.stringify({ providerId: 2, model: 'deepseek-v4-flash', maxTokens: 8192 }) })
  }
  // 导入 mc-good2.0 + 映射生产模式
  const agentsDir = join(FF_DIR, 'agents')
  const agentFiles = readdirSync(agentsDir).filter((f) => f.endsWith('.md'))
  const agentsText = agentFiles.map((f) => ({ filename: f, content: readFileSync(join(agentsDir, f), 'utf8') }))
  const sol = JSON.parse(readFileSync(join(FF_DIR, 'solutions', 'mc-good-two.json'), 'utf8'))
  const imported = await api('/solutions/import-feelfish', {
    method: 'POST',
    body: JSON.stringify({ agents: agentsText, solution: { name: 'mc-good2.0-P31', description: sol.description, agents: sol.agents } })
  })
  const OUTPUT_MAP = ['outline', 'draft', 'draft', 'scene', 'dialogue', 'draft', 'review', 'review', 'review', 'final']
  const detail = await api(`/solutions/${imported.id}`)
  const steps = detail.solution.steps.map((s, i) => ({ ...s, stage: 'whole_book', production: { output: OUTPUT_MAP[i] ?? 'draft', reviewRounds: 1 } }))
  await api(`/solutions/${imported.id}`, { method: 'PATCH', body: JSON.stringify({ steps }) })

  // 建书 + 卷 + 3 章（空正文；节拍可选，卷章定位基于卷+位置即可）
  const novel = await api('/novels', { method: 'POST', body: JSON.stringify({ inspiration: 'P31 验收：都市守夜人，追踪千年秘密' }) })
  const novelId = novel.id
  const volume = await api(`/novels/${novelId}/volumes`, { method: 'POST', body: JSON.stringify({ title: '第一卷 夜行' }) })
  const chapterIds = []
  for (let i = 1; i <= 3; i++) {
    const ch = await api(`/novels/${novelId}/chapters`, { method: 'POST', body: JSON.stringify({ title: `第${i}章`, volumeId: volume.id }) })
    chapterIds.push(ch.id)
  }
  // 绑定方案
  await api(`/novels/${novelId}`, { method: 'PATCH', body: JSON.stringify({ currentSolutionId: imported.id }) })

  // 整本生产
  const t0 = Date.now()
  const job = await api(`/novels/${novelId}/produce`, { method: 'POST', body: JSON.stringify({}) })
  console.log('✓ 整本生产入队:', JSON.stringify(job))
  // 轮询 job
  for (let i = 0; i < 240; i++) {
    await new Promise((r) => setTimeout(r, 3000))
    const j = await api(`/jobs/${job.jobId}`)
    if (j.job.status === 'done' || j.job.status === 'failed') {
      console.log(`  job ${j.job.status}（${Math.round((Date.now() - t0) / 1000)}s）:`, JSON.stringify(j.job.result_json ?? {}).slice(0, 200))
      if (j.job.status !== 'done') process.exit(1)
      break
    }
  }
  // 验证产出 + 字数
  const chapters = (await api(`/novels/${novelId}/chapters`)).chapters
  for (const c of chapters) {
    const detail2 = await api(`/novels/${novelId}/chapters/${c.id}`)
    const text = detail2.chapter.content ?? ''
    const cjk = (text.match(/[\u4e00-\u9fff]/g) ?? []).length
    console.log(`  ${c.title}: ${cjk} 字`)
    if (cjk < 200) { console.error(`✗ ${c.title} 字数不足`); process.exit(1) }
  }
  console.log(`\n[P31-verify] PASS：整本生产 3 章全部产出（含卷章定位注入）`)
  process.exit(0)
} catch (e) {
  console.error('✗ 失败:', e.message)
  process.exit(1)
}
