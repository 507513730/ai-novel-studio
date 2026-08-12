// P30 验收：Feelfish mc-good2.0 真机试跑（导入 → 映射生产类型 → 流水线生成一章）
import { readFileSync, readdirSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { mkdirSync, rmSync } from 'node:fs'

const ROOT = 'D:/OpenCode/projects/ai-novel-studio'
const BASE = 'http://127.0.0.1:3000/api'
const FF_DIR = 'D:/FeelFish/\u8272/.feelfish'

// 产出类型映射（对齐 Feelfish AGENTS.md 的 10 步顺序）
const OUTPUT_MAP = [
  'outline',  // 情节规划师
  'draft',    // 人物设计大师
  'draft',    // 世界观架构师
  'scene',    // 场景描写师
  'dialogue', // 对话编剧师
  'draft',    // 小编C
  'review',   // 可行性评审专家
  'review',   // 审校编辑
  'review',   // 读者
  'final'     // 统筹审核
]

async function api(path, init) {
  const res = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json' },
    ...init
  })
  const body = await res.json().catch(() => null)
  if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`)
  return body
}

// 1) 启动临时 server
const userData = join(ROOT, 'release', '.p30-e2e')
rmSync(userData, { recursive: true, force: true })
mkdirSync(userData, { recursive: true })
const server = spawn(process.execPath, [join(ROOT, 'out', 'main', 'server.js')], {
  env: { ...process.env, AI_NOVEL_USER_DATA: userData, AI_NOVEL_PORT: '3000' },
  stdio: 'ignore'
})
let ready = false
for (let i = 0; i < 30; i++) {
  try {
    const r = await fetch(BASE + '/health')
    if (r.ok) { ready = true; break }
  } catch {}
  await new Promise((r) => setTimeout(r, 500))
}
if (!ready) { console.error('server 未就绪'); process.exit(1) }
console.log('✓ server ready')

try {
  // 2) 导入 OpenCode Go provider + 把全部任务路由切到它（flash）
  await api('/settings/import-opencode', { method: 'POST', body: JSON.stringify({ provider: 'opencode-go' }) })
  console.log('✓ provider imported')
  for (const task of ['prose', 'planning', 'review', 'analysis', 'summary', 'extraction', 'director', 'chat']) {
    await api(`/settings/model-routes/${task}`, {
      method: 'PUT',
      body: JSON.stringify({ providerId: 2, model: 'deepseek-v4-flash', maxTokens: 8192 })
    })
  }
  console.log('✓ 全部任务路由 → OpenCode Go (deepseek-v4-flash)')

  const agentsDir = join(FF_DIR, 'agents')
  const agentFiles = readdirSync(agentsDir).filter((f) => f.endsWith('.md'))
  const agentsText = agentFiles.map((f) => ({ filename: f, content: readFileSync(join(agentsDir, f), 'utf8') }))
  const sol = JSON.parse(readFileSync(join(FF_DIR, 'solutions', 'mc-good-two.json'), 'utf8'))
  const imported = await api('/solutions/import-feelfish', {
    method: 'POST',
    body: JSON.stringify({
      agents: agentsText,
      solution: { name: 'mc-good2.0-P30', description: sol.description, agents: sol.agents }
    })
  })
  console.log('✓ mc-good2.0 导入:', JSON.stringify(imported))

  // 3) 映射 steps 为生产模式（stage=whole_book + output）
  const detail = await api(`/solutions/${imported.id}`)
  const steps = detail.solution.steps.map((s, i) => ({
    ...s,
    stage: 'whole_book',
    production: { output: OUTPUT_MAP[i] ?? 'draft', reviewRounds: 1 }
  }))
  await api(`/solutions/${imported.id}`, { method: 'PATCH', body: JSON.stringify({ steps }) })
  console.log('✓ 步骤映射为生产模式（10 步）')

  // 4) 建测试小说 + 空章节
  const novel = await api('/novels', { method: 'POST', body: JSON.stringify({ inspiration: 'P30 验收：都市夜行者，黑市情报贩子意外卷入千年恩怨' }) })
  const novelId = novel.id
  await api(`/novels/${novelId}/world`, { method: 'PATCH', body: JSON.stringify({ manual: { 力量体系: '灵气复苏，低武', 社会结构: '现代都市+地下世界', 地理: '滨海市', 历史脉络: '百年前灵气觉醒' } }) })
  const ch = await api(`/novels/${novelId}/chapters`, { method: 'POST', body: JSON.stringify({ title: '第一章 夜巷交易' }) })
  console.log('✓ 书 #' + novelId + ' 章节 #' + ch.id)

  // 5) 绑定方案 + 生产
  await api(`/novels/${novelId}`, { method: 'PATCH', body: JSON.stringify({ currentSolutionId: imported.id }) })
  const t0 = Date.now()
  const result = await api(`/solutions/${imported.id}/produce-chapter`, {
    method: 'POST',
    body: JSON.stringify({ novelId, chapterId: ch.id })
  })
  const elapsed = ((Date.now() - t0) / 1000).toFixed(0)
  console.log(`\n✓ 流水线完成（${elapsed}s）: ${result.wordCount} 字 | 标题: ${result.title ?? '(沿用)'} | 降级: ${result.degraded}`)
  console.log('  步骤:', result.outputs.map((o, i) => `${i + 1}.${o.role}${o.ok ? '' : '✗'}`).join(' '))
  if (result.degradedReasons?.length) {
    console.log('\n降级原因：')
    result.degradedReasons.forEach((r) => console.log(' -', r.slice(0, 200)))
  }

  // 6) 验证正文
  const detailCh = await api(`/novels/${novelId}/chapters/${ch.id}`)
  const content = detailCh.chapter.content
  const cjk = (content.match(/[\u4e00-\u9fff]/g) ?? []).length
  console.log(`\n正文抽查（前 300 字）：\n${content.slice(0, 300)}`)
  console.log(`\n字数: ${cjk} | 结论: ${cjk >= 200 ? 'PASS' : 'FAIL(字数不足)'}`)
  console.log(`\n[P30-e2e] 用时 ${elapsed}s, 10 步方案, 产出 ${cjk} 字`)
} catch (e) {
  console.error('✗ 失败:', e.message)
} finally {
  server.kill()
  await new Promise((r) => setTimeout(r, 1000))
  try { rmSync(userData, { recursive: true, force: true }) } catch {}
  process.exit(0)
}
