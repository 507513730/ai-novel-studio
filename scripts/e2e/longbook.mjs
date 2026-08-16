// P17-4：flash 长书深度测试（真实灵感 → 自动导演 → 12 章 → 审核/连续性/反 AI/成本）
// 用法：node scripts/e2e/longbook.mjs <roundNo>
import { appendFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { api, apiTry, ok, startRound, finishRound, sleep } from './common.mjs'

const round = Number(process.argv[2] ?? 1)
const tag = `LB${round}`
// v0.23.1（批次 B4）：报告路径改为仓库相对（E2E_LB_REPORT 可覆盖）
const report = process.env.E2E_LB_REPORT ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'docs', 'longbook-report.md')
const append = (line) => appendFileSync(report, line + '\n')

const INSPIRATION = `失业程序员林默偶然获得"物忆"异能：触碰任何旧物即可读取其残留的情感记忆。他在临江古玩街开了一家修复工作室，却卷入三十年前一场伪造国宝的惊天调包案——真品下落不明，师父的遗言指向五个看似无关的器物。随着记忆碎片拼合，他发现自己触碰的不仅是器物，还有死者临死前的真相，而凶手也拥有类似的能力，正在猎杀所有知情者。`

// 章节生成总轮询上限（12 章 × 90s ≈ 18 分钟 + 余量）
const PRODUCE_TIMEOUT_MS = 30 * 60 * 1000

async function main() {
  // 报告头
  const fs = await import('node:fs')
  if (!fs.existsSync(report) || fs.readFileSync(report, 'utf8').trim() === '') {
    fs.writeFileSync(report, `# 长书深度测试报告（P17-4，flash · opencode-go 网关）\n\n| 轮次 | 阶段 | 结果 |\n|---|---|---|\n`, 'utf8')
  }
  startRound(`长书 ${tag}：创建 + 自动导演`)

  // 1. 创建书
  const created = await api('/novels', { method: 'POST', body: JSON.stringify({ inspiration: INSPIRATION }) })
  const novelId = created.id
  ok(novelId > 0, '创建长书', `id=${novelId}`)
  await sleep(500)

  // 2. 自动导演（auto，每卷 6 章 × 2 卷）
  const run = await apiTry(`/novels/${novelId}/director/run`, {
    method: 'POST',
    body: JSON.stringify({ mode: 'auto', chaptersPerVolume: 6 })
  })
  ok(run.ok, '自动导演 run', run.error ?? '')

  // 3. 轮询导演到 done（上限 10 分钟）
  let dirDone = false
  let dirStatus = null
  for (let i = 0; i < 200; i++) {
    await sleep(3000)
    const s = await apiTry(`/novels/${novelId}/director/status`)
    if (s.ok && ['done', 'failed', 'cancelled'].includes(s.body.status)) {
      dirStatus = s.body
      dirDone = s.body.status === 'done'
      break
    }
  }
  ok(dirDone, `导演完成（${dirStatus?.displayStatus ?? dirStatus?.status ?? 'timeout'}）`)

  // 4. 章节清点
  const chList = await api(`/novels/${novelId}/chapters`)
  const total = chList.chapters.length
  const planned = chList.chapters.filter((c) => c.status === 'planned').length
  ok(total >= 10, `章节总数 ≥10`, `got ${total}`)
  console.log(`  待生成 ${planned}/${total}`)

  // 5. 生产管线生成全部正文（30 分钟超时）
  startRound(`长书 ${tag}：批量生成 ${planned} 章`)
  const prod = await apiTry(`/novels/${novelId}/produce`, { method: 'POST', body: JSON.stringify({}) })
  ok(prod.ok, '生产管线启动', prod.error ?? '')
  const started = Date.now()
  let prodDone = false
  let prodStatus = null
  for (;;) {
    await sleep(5000)
    const jobs = await api('/jobs')
    const pj = jobs.jobs.find((j) => j.id === prod.body.jobId)
    if (pj && ['done', 'failed', 'cancelled'].includes(pj.status)) {
      prodStatus = pj
      prodDone = pj.status === 'done'
      break
    }
    if (Date.now() - started > PRODUCE_TIMEOUT_MS) {
      prodStatus = { status: 'timeout' }
      break
    }
  }
  const elapsedMin = ((Date.now() - started) / 60000).toFixed(1)
  ok(prodDone, `生产完成（${elapsedMin} 分钟，${prodStatus?.status}）`)

  // 6. 生成后清点（wordCount 或状态多条件判断）
  const chAfter = await api(`/novels/${novelId}/chapters`)
  const written = chAfter.chapters.filter((c) => c.wordCount > 0 || ['written', 'reviewed', 'done'].includes(c.status))
  console.log(`  [诊断] written=${written.length}/${total}  wordCount 样例:`, chAfter.chapters.slice(0, 3).map((c) => `${c.id}:${c.wordCount ?? 'undef'}:${c.status}`).join(' '))
  const totalWords = written.reduce((s, c) => s + (c.wordCount ?? 0), 0)
  ok(written.length >= Math.min(10, total), `已生成章节 ≥10`, `got ${written.length}/${total}，总字数 ${totalWords}`)

  // 7. 审核抽样（第 1/4/8/12 章）
  startRound(`长书 ${tag}：审核抽样 + 连续性`)
  const reviewScores = []
  for (const idx of [0, 3, 7, Math.min(11, written.length - 1)]) {
    const ch = written[idx]
    if (!ch) continue
    const r = await apiTry(`/novels/${novelId}/chapters/${ch.id}/review`, { method: 'POST' })
    if (r.ok && r.body.review && typeof r.body.review.score === 'number') {
      const score = Number(r.body.review.score)
      reviewScores.push(score)
      ok(score >= 60, `第 ${idx + 1} 章审核 ≥60 分`, `score=${score}`)
    } else {
      console.log(`  [诊断] 第 ${idx + 1} 章审核响应:`, JSON.stringify(r).slice(0, 200))
      ok(false, `第 ${idx + 1} 章审核`, r.error ?? JSON.stringify(r.body ?? {}).slice(0, 120))
    }
  }

  // 8. 连续性检查：主角名跨章出现（前 3 章 vs 后 3 章，详情接口取正文）
  const chars = await api(`/novels/${novelId}/characters`)
  const roster = chars.characters.filter((c) => c.status === 'roster').slice(0, 4).map((c) => c.name)
  const last3Ids = written.slice(Math.max(0, written.length - 3)).map((c) => c.id)
  let lastText = ''
  for (const cid of last3Ids) {
    const d = await api(`/novels/${novelId}/chapters/${cid}`)
    lastText += d.chapter.content ?? ''
  }
  const present = roster.filter((n) => lastText.includes(n))
  ok(present.length >= 1, `主角跨章持续出现（${roster.join('/')} → 末章仍有：${present.join('/') || '无'}）`)

  // 9. 反 AI 词检查（首章，详情接口取正文）
  const ch0 = written[0]
  if (ch0) {
    const d0 = await api(`/novels/${novelId}/chapters/${ch0.id}`)
    const text = d0.chapter.content ?? ''
    const anti = await apiTry(`/novels/${novelId}/style/anti-ai-check`, {
      method: 'POST',
      body: JSON.stringify({ text: text.slice(0, 2000) })
    })
    ok(anti.ok && Number(anti.body?.total ?? 0) < 5, `首章反 AI 词 <5`, `hits=${anti.body?.total ?? 'err'}`)
  }

  // 10. 成本统计
  const usage = await api(`/settings/usage/stats?novel=${novelId}`)
  const u = usage.total
  ok(u && u.calls > 0, '成本统计（该书）', JSON.stringify(u))
  const estCost = ((u?.input_tokens ?? 0) / 1e6) * 0.28 + ((u?.output_tokens ?? 0) / 1e6) * 0.42
  console.log(`  [成本] 调用 ${u?.calls ?? 0} · 输入 ${u?.input_tokens ?? 0} · 输出 ${u?.output_tokens ?? 0} · 估算 ¥${(estCost * 7.2).toFixed(2)}`)

  // 报告行
  append(`| ${tag} | 导演+生成+审核+连续性 | ${prodDone && written.length >= 10 ? '通过' : '部分'} |`)
  append(`| ${tag}-详情 | 章节 ${written.length}/${total} · 总字数 ${totalWords} · 审核分 ${reviewScores.join('/')} · 成本 ¥${(estCost * 7.2).toFixed(2)} | |`)

  finishRound(`长书 ${tag} 完成`, `novelId=${novelId}`)
  console.log(`\n长书 ${tag} 完成：${written.length} 章 / ${totalWords} 字 / 审核 ${reviewScores.join(', ')} / 估算成本 ¥${(estCost * 7.2).toFixed(2)}`)
}

main().catch((e) => {
  console.error('长书测试异常:', e.message)
  process.exit(1)
})
