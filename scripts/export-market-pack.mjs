// v0.11.0（批C）：生成市场方案包（solution-pack）到 solutions/<id>/
// 用法：FF_DIR=<feelfish 目录> node scripts/export-market-pack.mjs
//   流程：起临时 server → 导入 Feelfish 方案 → 建书 + 方案生产 1 章（样例快照）→ 导出包
//   → 写 solutions/mc-good2.0/solution-pack.json（随后跑 publish-solution.mjs 更新 index）
// 无 FF_DIR 时从运行中的本地库导出（参数：SOLUTION_ID SAMPLE_NOVEL_ID）
import { readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const FF_DIR = process.env.FF_DIR ?? ''
const BASE = 'http://127.0.0.1:39998/api'

async function api(path, init) {
  const res = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json' },
    ...init
  })
  const body = await res.json().catch(() => null)
  if (!res.ok) throw new Error(`${path}: ${JSON.stringify(body ?? {}).slice(0, 200)}`)
  return body
}

// 1) 起临时 server
const userData = join(ROOT, 'release', '.pack-gen')
rmSync(userData, { recursive: true, force: true })
mkdirSync(userData, { recursive: true })
const server = spawn(process.execPath, [join(ROOT, 'out', 'main', 'server.js')], {
  env: { ...process.env, AI_NOVEL_USER_DATA: userData, AI_NOVEL_PORT: '39998' },
  stdio: ['ignore', 'pipe', 'pipe']
})
let errLog = ''
server.stderr.on('data', (d) => { errLog += d.toString() })
let ready = false
for (let i = 0; i < 30; i++) {
  try {
    const r = await fetch(BASE + '/health')
    if (r.ok) { ready = true; break }
  } catch { /* not ready */ }
  await new Promise((r) => setTimeout(r, 500))
}
if (!ready) {
  console.error('server 未就绪')
  server.kill()
  process.exit(1)
}

const shutdown = () => { server.kill() }
process.on('exit', shutdown)

try {
  let solutionId = Number(process.env.SOLUTION_ID ?? 0)
  let sampleNovelId = Number(process.env.SAMPLE_NOVEL_ID ?? 0)

  // 模型路由 → OpenCode Go flash（新临时库默认指向 DeepSeek 无 key）
  await api('/settings/import-opencode', { method: 'POST', body: JSON.stringify({ provider: 'opencode-go' }) })
  for (const task of ['prose', 'planning', 'review', 'analysis', 'summary', 'extraction', 'director', 'chat']) {
    await api(`/settings/model-routes/${task}`, {
      method: 'PUT',
      body: JSON.stringify({ providerId: 2, model: 'deepseek-v4-flash', maxTokens: 8192 })
    })
  }

  if (FF_DIR && !solutionId) {
    // 导入 Feelfish mc-good2.0
    const agentsDir = join(FF_DIR, 'agents')
    const agentFiles = readdirSync(agentsDir).filter((f) => f.endsWith('.md'))
    const agentsText = agentFiles.map((f) => ({ filename: f, content: readFileSync(join(agentsDir, f), 'utf8') }))
    const sol = JSON.parse(readFileSync(join(FF_DIR, 'solutions', 'mc-good-two.json'), 'utf8'))
    const imported = await api('/solutions/import-feelfish', {
      method: 'POST',
      body: JSON.stringify({
        agents: agentsText,
        solution: { name: 'mc-good2.0', description: sol.description, agents: sol.agents }
      })
    })
    solutionId = imported.id
    console.log('✓ 导入 mc-good2.0:', solutionId)
    // 映射为生产模式
    const OUTPUT_MAP = ['outline', 'draft', 'draft', 'scene', 'dialogue', 'draft', 'review', 'review', 'review', 'final']
    const detail = await api(`/solutions/${solutionId}`)
    const steps = detail.solution.steps.map((s, i) => ({
      ...s,
      stage: 'whole_book',
      production: { output: OUTPUT_MAP[i] ?? 'draft', reviewRounds: 1 }
    }))
    await api(`/solutions/${solutionId}`, { method: 'PATCH', body: JSON.stringify({ steps }) })
  }

  if (!solutionId) {
    console.error('需要 SOLUTION_ID（或 FF_DIR 导入）')
    process.exit(1)
  }

  if (!sampleNovelId) {
    // 建书 + 方案生产 1 章作为样例
    const novel = await api('/novels', { method: 'POST', body: JSON.stringify({ inspiration: '市场包样例：都市夜行者，黑市情报贩子卷入千年恩怨' }) })
    sampleNovelId = novel.id
    await api(`/novels/${sampleNovelId}/world`, {
      method: 'PATCH',
      body: JSON.stringify({ manual: { 力量体系: '现代都市', 地理: '老城区', 基调: '悬疑' }, factions: [] })
    })
    const ch = await api(`/novels/${sampleNovelId}/chapters`, { method: 'POST', body: JSON.stringify({ title: '第一章 夜巷' }) })
    await api(`/solutions/${solutionId}/produce-chapter`, {
      method: 'POST',
      body: JSON.stringify({ novelId: sampleNovelId, chapterId: ch.id })
    })
    console.log('✓ 样例章节已生成')
  }

  // 导出 pack（带样例）
  const expRes = await fetch(`${BASE}/solutions/${solutionId}/export?sampleNovelId=${sampleNovelId}`)
  const pack = await expRes.text()
  if (!expRes.ok) {
    console.error('导出失败:', pack.slice(0, 300))
    if (errLog) console.error('server stderr:', errLog.slice(-800))
    process.exit(1)
  }
  const p = JSON.parse(pack)
  const outDir = join(ROOT, 'solutions', p.id)
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, 'solution-pack.json'), pack)
  console.log(`✓ 方案包已生成: solutions/${p.id}/solution-pack.json`)
  console.log(`  ${p.name} v${p.version} | 步骤 ${p.metrics.stepCount} | 智能体 ${p.metrics.agentCount} | ${p.sampleBook ? `样例 ${p.sampleBook.chapters.length} 章` : '无样例'}`)
  console.log('  下一步：node scripts/publish-solution.mjs 更新 market index')
  process.exit(0)
} catch (e) {
  console.error('✗ 失败:', e.message)
  if (errLog) console.error('server stderr:', errLog.slice(-800))
  process.exit(1)
}
