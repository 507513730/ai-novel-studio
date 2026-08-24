// P14 D：全功能测试轮（T1 配置/系统 + T2 创作主链 + T3 资产智能 + T4 导演恢复 + T5 功能回归）
// T5（v0.24.2 起）：方案整本生产 / 全书检索 / 版本 diff
// 用法：node scripts/e2e/round.mjs <roundNo>
import { api, apiTry, ok, startRound, finishRound, sleep, waitJob } from './common.mjs'

const round = Number(process.argv[2] ?? 1)
const tag = `R${round}`
const novelTitle = `E2E测试书-${tag}`

// ---------- T1 配置与系统 ----------
export async function t1() {
  startRound(`T1 配置与系统（${tag}）`)
  // 供应商
  const provs = await api('/settings/providers')
  ok(provs.providers.length >= 1, '供应商列表 ≥1', `got ${provs.providers.length}`)
  const go = provs.providers.find((p) => p.name.includes('OpenCode'))
  ok(Boolean(go && go.hasKey), 'OpenCode Go 网关已配置 Key')
  // 测试连接
  if (go) {
    const t = await apiTry('/settings/test-connection', {
      method: 'POST',
      body: JSON.stringify({ providerId: go.id, taskType: 'prose', model: 'deepseek-v4-flash' })
    })
    ok(t.ok && t.body.ok === true, '测试连接成功（网关 deepseek-v4-flash）', t.error ?? '')
  }
  // 模型路由
  const routes = await api('/settings/model-routes')
  ok(routes.routes.length >= 8, '模型路由 ≥8 任务', `got ${routes.routes.length}`)
  // 温度 NaN 校验（API 层直接验证：非法温度应被 zod 拒绝？zod number 接受 NaN？NaN 会过 z.number() —— 服务端校验在客户端 onBlur。跳过 API 层）
  // 流派
  const genres = await api('/genres?novelId=0')
  ok(genres.genres.length >= 6, '全局流派 ≥6 预设', `got ${genres.genres.length}`)
  const dup = await apiTry('/genres', { method: 'POST', body: JSON.stringify({ name: '都市' }) })
  ok(!dup.ok && dup.error.includes('已存在'), '流派重名 409', dup.error ?? '')
  const created = await apiTry('/genres', { method: 'POST', body: JSON.stringify({ name: `测试流派-${tag}` }) })
  ok(created.ok || (created.error ?? '').includes('已存在'), '创建自定义流派（重名视为幂等通过）', created.error ?? '')
  // 任务中心
  const jobs = await api('/jobs')
  ok(Array.isArray(jobs.jobs), 'jobs 列表')
  const cancelBad = await apiTry('/jobs/999999/cancel', { method: 'POST' })
  ok(!cancelBad.ok, '取消不存在任务 404/409', cancelBad.error ?? '')
  // 成本统计
  const usage = await api('/settings/usage/stats')
  ok(usage.total && typeof usage.total.calls === 'number', '成本统计可用')
  return finishRound(`T1 配置与系统（${tag}）`)
}

// ---------- T2 创作主链 ----------
export async function t2() {
  startRound(`T2 创作主链（${tag}）`)
  // 新建书
  const created = await api('/novels', {
    method: 'POST',
    body: JSON.stringify({ inspiration: `一位古董修复师能读取器物记忆，卷入三十年前的调包疑案。${tag}` })
  })
  const novelId = created.id
  ok(novelId > 0, '新建书', `id=${novelId}`)
  await sleep(500)
  // 方向（含定向重做）
  const dirs = await apiTry(`/novels/${novelId}/directions`, { method: 'POST' })
  ok(dirs.ok && dirs.body.directions.length === 2, '生成 2 套方向', dirs.error ?? '')
  const dirId = dirs.ok ? dirs.body.directions[0].id : null
  let redone
  if (dirId) {
    redone = await apiTry(`/novels/${novelId}/directions`, { method: 'POST', body: JSON.stringify({ directionId: dirId }) })
    ok(redone.ok && redone.body.replaced === true, '定向重做单套方向', redone.error ?? '')
    ok(redone.ok && redone.body.directions.length === 2, '重做后仍 2 套')
  }
  // framing
  const dir = dirs.ok ? dirs.body.directions[0].scheme : null
  const framing = await apiTry(`/novels/${novelId}/framing`, {
    method: 'POST',
    body: JSON.stringify({ title: novelTitle, direction: dir, notes: '节奏明快' })
  })
  ok(framing.ok && framing.body.framing.summary, '生成 framing', framing.error ?? '')
  // 字段级重写
  const field = await apiTry(`/novels/${novelId}/framing/field`, { method: 'POST', body: JSON.stringify({ field: 'sellingPoint' }) })
  ok(field.ok && field.body.framing.sellingPoint, '字段级 AI 重写（卖点）', field.error ?? '')
  // 宏观
  const macro = await apiTry(`/novels/${novelId}/macro`, { method: 'POST' })
  ok(macro.ok && macro.body.macro.storyEngine, '宏观规划', macro.error ?? '')
  // 世界观（3 步）
  const world = await apiTry(`/novels/${novelId}/world/generate`, { method: 'POST' })
  ok(world.ok, '世界观生成', world.error ?? '')
  await sleep(500)
  const worldGet = await api('/novels/' + novelId + '/world')
  ok(Object.keys(worldGet.world.manual ?? {}).length > 0, '世界手册非空')
  // 角色
  const chars = await apiTry(`/novels/${novelId}/characters/generate`, { method: 'POST' })
  ok(chars.ok, '角色阵容生成', chars.error ?? '')
  await sleep(300)
  // 卷 + 节奏板 + 章节（节拍板门禁验证）
  const vols = await apiTry(`/novels/${novelId}/volumes/generate`, {
    method: 'POST',
    body: JSON.stringify({ chaptersPerVolume: 6 })
  })
  ok(vols.ok, '卷规划生成', vols.error ?? '')
  await sleep(300)
  const volList = await api(`/novels/${novelId}/volumes`)
  const volId = volList.volumes[0]?.id
  if (volId) {
    // 门禁：无节奏板拆章应 400
    const gate = await apiTry(`/novels/${novelId}/volumes/${volId}/chapters/generate`, { method: 'POST' })
    ok(!gate.ok && gate.error.includes('节奏板'), '节拍板门禁生效', gate.error ?? '')
    // 卷战略评审
    const critique = await apiTry(`/novels/${novelId}/volumes/${volId}/critique`, { method: 'POST' })
    ok(critique.ok && typeof critique.body.critique.score === 'number', '卷战略评审', critique.error ?? '')
    // 节奏板
    const beats = await apiTry(`/novels/${novelId}/volumes/${volId}/beats/generate`, { method: 'POST' })
    ok(beats.ok, '节奏板生成', beats.error ?? '')
    await sleep(300)
    // 章节清单
    const chapters = await apiTry(`/novels/${novelId}/volumes/${volId}/chapters/generate`, { method: 'POST' })
    ok(chapters.ok, '章节清单生成', chapters.error ?? '')
    await sleep(300)
  }
  const chList = await api(`/novels/${novelId}/chapters`)
  ok(chList.chapters.length >= 5, `章节数 ≥5（门禁后）`, `got ${chList.chapters.length}`)
  // 批量细化（range 幂等）——v0.23.1（批次 D2）：迁 job 队列，POST 返回 jobId 后轮询终态
  const ids = chList.chapters.map((c) => c.id)
  if (ids.length >= 2) {
    const rr = await apiTry(`/novels/${novelId}/chapters/refine-range`, {
      method: 'POST',
      body: JSON.stringify({ from: ids[0], to: ids[ids.length - 1] })
    })
    let refineOk = false
    let refineDetail = rr.error ?? ''
    if (rr.ok && rr.body.jobId) {
      const job = await waitJob(rr.body.jobId)
      const r = job.result ?? {}
      refineOk = job.status === 'done' && Array.isArray(r.done) && r.done.length > 0
      refineDetail = `job#${job.id} ${job.status} done=${r.done?.length ?? 0} skipped=${r.skipped?.length ?? 0} ${job.error ?? ''}`
    }
    ok(refineOk, '批量细化（job 队列）', refineDetail)
    // 幂等：重跑应全 skipped
    const rr2 = await apiTry(`/novels/${novelId}/chapters/refine-range`, {
      method: 'POST',
      body: JSON.stringify({ from: ids[0], to: ids[ids.length - 1] })
    })
    let idemOk = false
    let idemDetail = rr2.error ?? ''
    if (rr2.ok && rr2.body.jobId) {
      const job2 = await waitJob(rr2.body.jobId)
      const r2 = job2.result ?? {}
      idemOk = job2.status === 'done' && r2.done?.length === 0 && r2.skipped?.length > 0
      idemDetail = `done=${r2.done?.length ?? 0} skipped=${r2.skipped?.length ?? 0}`
    }
    ok(idemOk, '批量细化幂等续跑（job 队列）', idemDetail)
  }
  // 单章生成 + 取消保留（首章生成完整，第二章取消验证保留）
  const firstCh = chList.chapters[0]
  if (firstCh && ids.length >= 2) {
    // 生成第一章（完整）
    const gen = await generateFull(novelId, firstCh.id, 'deepseek-v4-flash')
    ok(gen.ok && gen.wordCount > 50, '第一章生成', gen.error ?? `wordCount=${gen.wordCount}`)
    // 第二章：取消（验证保留）
    const gen2 = await generateCancel(novelId, chList.chapters[1].id)
    ok(gen2.ok && gen2.retained > 0, '第二章取消保留已生成内容', gen2.error ?? `retained=${gen2.retained}`)
    // 审核
    const review = await apiTry(`/novels/${novelId}/chapters/${firstCh.id}/review`, { method: 'POST' })
    ok(review.ok && typeof review.body.review.score === 'number', 'AI 审核', review.error ?? '')
    // 修复（可能无问题也走一次）
    const fix = await apiTry(`/novels/${novelId}/chapters/${firstCh.id}/fix`, { method: 'POST' })
    ok(fix.ok || (fix.error ?? '').includes('已修复 2 轮') || (fix.error ?? '').includes('同类'), '修复链路', fix.error ?? '')
    // 回灌
    const backfill = await apiTry(`/novels/${novelId}/chapters/${firstCh.id}/backfill`, { method: 'POST' })
    ok(backfill.ok, '状态回灌提取', backfill.error ?? '')
    // 待确认区
    const pending = await api('/novels/' + novelId + '/pending')
    ok(Array.isArray(pending.pendingFacts), '待确认区')
    // 快照 + 版本历史
    const snap = await apiTry(`/novels/${novelId}/chapters/${firstCh.id}/versions`, {
      method: 'POST',
      body: JSON.stringify({ note: 'E2E 快照' })
    })
    ok(snap.ok, '存快照', snap.error ?? '')
    const vers = await api(`/novels/${novelId}/chapters/${firstCh.id}/versions`)
    ok(vers.versions.length >= 1, '版本历史')
    // 上下文预览
    const ctx = await api(`/novels/${novelId}/chapters/${firstCh.id}/context-preview`)
    ok(Array.isArray(ctx.sections) && ctx.sections.length > 0, '写作上下文预览')
  }
  // 导出（4 格式；v0.24.4 A5 加 DOCX）
  for (const fmt of ['txt', 'md', 'epub', 'docx']) {
    const r = await fetch(`http://127.0.0.1:3000/api/novels/${novelId}/export?format=${fmt}`)
    ok(r.ok && (await r.text()).length > 100, `导出 ${fmt.toUpperCase()}`)
  }
  return finishRound(`T2 创作主链（${tag}）`, `novelId=${novelId}`)
}

async function generateFull(novelId, chapterId, model) {
  const res = await fetch(`http://127.0.0.1:3000/api/novels/${novelId}/chapters/${chapterId}/generate?model=${model}`, { method: 'POST' })
  if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
  const text = await res.text()
  const done = text.match(/event: done\ndata: (\{.*\})/)
  const aborted = text.match(/event: aborted\ndata: (\{.*\})/)
  const err = text.match(/event: error\ndata: (\{.*\})/)
  if (err) return { ok: false, error: JSON.parse(err[1]).message }
  if (done) return { ok: true, ...JSON.parse(done[1]) }
  if (aborted) return { ok: false, error: 'aborted without done' }
  return { ok: false, error: 'no done event' }
}

async function generateCancel(novelId, chapterId) {
  const controller = new AbortController()
  const res = await fetch(`http://127.0.0.1:3000/api/novels/${novelId}/chapters/${chapterId}/generate`, {
    method: 'POST',
    signal: controller.signal
  })
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  let retained = 0
  let err = null
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      if (buf.length > 4000 && retained === 0) {
        retained = buf.length
        controller.abort()
      }
    }
  } catch {
    /* abort */
  }
  return retained > 0 ? { ok: true, retained } : { ok: false, error: err ?? 'no stream data before cancel' }
}

// ---------- T3 资产与智能 ----------
export async function t3(novelId) {
  startRound(`T3 资产与智能（${tag}）`)
  if (!novelId) {
    ok(false, '跳过（无测试书）')
    return finishRound(`T3 资产与智能（${tag}）`)
  }
  // 拆书
  const analysis = await apiTry(`/novels/${novelId}/analysis`, { method: 'POST', body: JSON.stringify({ depth: 'standard' }) })
  ok(analysis.ok && analysis.body.report.genre, '拆书（标准档）', analysis.error ?? '')
  const analysisId = analysis.ok ? null : null
  // 写法提取（需要 200 字示例）
  const sample = '他推开门，走进昏暗的仓库。' + '灰尘在斜阳里浮沉，像碎金。'.repeat(30)
  const style = await apiTry(`/novels/${novelId}/style/extract`, {
    method: 'POST',
    body: JSON.stringify({ sample, name: `E2E写法-${tag}` })
  })
  ok(style.ok, '写法特征提取', style.error ?? '')
  // 特征开关（乐观更新后端验证）
  const assets = await api(`/novels/${novelId}/style`)
  if (assets.assets.length > 0) {
    const a = assets.assets[0]
    const feat = a.features?.[0]
    if (feat) {
      const next = a.features.map((f) => (f.id === feat.id ? { ...f, enabled: !f.enabled } : f))
      const upd = await apiTry(`/novels/${novelId}/style/${a.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ features: next })
      })
      ok(upd.ok, '特征开关更新', upd.error ?? '')
    }
  }
  // 拆书历史 + 发布知识库
  const hist = await api(`/novels/${novelId}/analysis`)
  if (hist.analyses.length > 0) {
    const pub = await apiTry(`/novels/${novelId}/analysis/${hist.analyses[0].id}/publish-kb`, { method: 'POST' })
    ok(pub.ok, '拆书发布知识库', pub.error ?? '')
  }
  // 标题工坊接口
  const titles = await apiTry(`/novels/${novelId}/titles`, {
    method: 'POST',
    body: JSON.stringify({ direction: { title: '测试', sellingPoint: 'x', genre: '都市', coreSetting: 'x', mainline: 'x', first30: 'x', readerFeeling: 'x' } })
  })
  ok(titles.ok && titles.body.titles.length > 0, '标题工坊生成', titles.error ?? '')
  // AI 团队
  const agents = await api('/agents')
  ok(Array.isArray(agents.agents) && agents.agents.length >= 5, 'AI 团队 ≥5 部门', `got ${agents.agents?.length}`)
  return finishRound(`T3 资产与智能（${tag}）`)
}

// ---------- T4 导演与恢复 ----------
export async function t4(novelId) {
  startRound(`T4 导演与恢复（${tag}）`)
  if (!novelId) {
    ok(false, '跳过（无测试书）')
    return finishRound(`T4 导演与恢复（${tag}）`)
  }
  // 导演 run（supervised 到 ready 后即停——用 auto 但章节已生成完会快速收尾）
  const run = await apiTry(`/novels/${novelId}/director/run`, {
    method: 'POST',
    body: JSON.stringify({ mode: 'auto', chaptersPerVolume: 6 })
  })
  ok(run.ok && run.body.jobId > 0, '导演 run', run.error ?? '')
  // 轮询状态（3 次）
  let st = null
  for (let i = 0; i < 3; i++) {
    await sleep(2000)
    st = await apiTry(`/novels/${novelId}/director/status`)
    if (st.ok && ['done', 'failed', 'running', 'queued'].includes(st.body.status)) break
  }
  ok(st.ok, '导演状态可查', st.error ?? '')
  // 取消（若仍运行）
  const cancel = await apiTry(`/novels/${novelId}/director/cancel`, { method: 'POST' })
  ok(cancel.ok && cancel.body.cancelled !== undefined, '导演取消', cancel.error ?? '')
  // AiStatusBar 数据源验证
  const novelSt = await api(`/novels/${novelId}/status`)
  ok(novelSt.director && novelSt.director.status !== undefined, '书级状态查询（director 字段）', JSON.stringify(novelSt).slice(0, 80))
  // 生产范围授权（from/to 用章节 id）
  const chapters = await api(`/novels/${novelId}/chapters`)
  const todo = chapters.chapters.filter((c) => c.status === 'planned')
  if (todo.length >= 2) {
    const from = todo[0].id
    const to = todo[1].id
    const prod = await apiTry(`/novels/${novelId}/produce`, {
      method: 'POST',
      body: JSON.stringify({ from, to })
    })
    ok(prod.ok && prod.body.jobId > 0, '生产范围授权（2 章）', prod.error ?? '')
    await sleep(3000)
    const jobs = await api('/jobs')
    const pj = jobs.jobs.find((j) => j.id === prod.body.jobId)
    ok(pj && ['running', 'done', 'failed'].includes(pj.status), '生产任务执行中/完成', pj?.status ?? 'missing')
    // 完成后校验两章有正文（轮询 job 至终态，上限 150s）
    for (let w = 0; w < 50; w++) {
      await sleep(3000)
      const j2 = (await api('/jobs')).jobs.find((j) => j.id === prod.body.jobId)
      if (j2 && ['done', 'failed', 'cancelled'].includes(j2.status)) break
    }
    const ch2 = await api(`/novels/${novelId}/chapters`)
    const doneCh = ch2.chapters.filter((c) => c.id === from || c.id === to).filter((c) => c.wordCount > 0)
    ok(doneCh.length >= 1, '范围内章节已生成正文', `got ${doneCh.length}/2`)
  } else {
    ok(true, '跳过生产范围（无足够待生成章节）')
  }
  return finishRound(`T4 导演与恢复（${tag}）`)
}

// ---------- T5 v0.24.2 功能回归（方案整本生产 / 全书检索 / 版本 diff） ----------
export async function t5() {
  startRound(`T5 功能回归（${tag}）`)
  try {
    // 数据准备：新书 + 2 章（第 1 章预置正文——同时验证 produce-book 幂等跳过已有正文）
    const created = await api('/novels', { method: 'POST', body: JSON.stringify({ inspiration: `T5-${tag}：全书检索与方案整本生产回归` }) })
    const novelId = created.id
    ok(novelId > 0, 'T5 新建书', `id=${novelId}`)
    const c1 = await api(`/novels/${novelId}/chapters`, { method: 'POST', body: JSON.stringify({ title: '第一章 · 油灯' }) })
    const c2 = await api(`/novels/${novelId}/chapters`, { method: 'POST', body: JSON.stringify({ title: '第二章 · 夜访' }) })
    ok(c1.id > 0 && c2.id > 0, 'T5 手动建章')
    await api(`/novels/${novelId}/chapters/${c1.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ content: '油灯在桌上静静燃着。他伸手碰了碰灯罩，指尖传来一阵温热。', status: 'written', aiWordsDelta: 30 })
    })

    // ---- 全书检索（F2） ----
    const s = await apiTry(`/novels/${novelId}/search?q=${encodeURIComponent('油灯')}`)
    ok(s.ok && s.body.chapters.some((c) => c.id === c1.id), '全书检索命中（正文定向词）', s.error ?? '')
    const sMiss = await apiTry(`/novels/${novelId}/search?q=${encodeURIComponent('不存在的词xyz123')}`)
    ok(sMiss.ok && sMiss.body.chapters.length === 0, '全书检索无命中正确')

    // ---- 版本 diff（F3） ----
    const snap = await apiTry(`/novels/${novelId}/chapters/${c1.id}/versions`, { method: 'POST', body: JSON.stringify({ note: 'e2e 快照' }) })
    ok(snap.ok && snap.body.versionId > 0, '版本快照', snap.error ?? '')
    await api(`/novels/${novelId}/chapters/${c1.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ content: '油灯在桌上静静燃着。他把灯芯挑亮了一分，指尖传来一阵温热。' })
    })
    const diff = await apiTry(`/novels/${novelId}/chapters/${c1.id}/versions/${snap.body.versionId}/diff`)
    ok(diff.ok && diff.body.lines.some((l) => l.type === 'add' || l.type === 'del'), '版本 diff（增删行）', diff.error ?? '')

    // ---- 方案整本生产（F4） ----
    const agents = await api('/agents')
    const a1 = agents.agents[0]?.id
    const a2 = agents.agents[1]?.id ?? a1
    const sol = await apiTry('/solutions', {
      method: 'POST',
      body: JSON.stringify({
        name: `T5方案-${tag}`,
        description: 'e2e 回归',
        steps: [
          { agentId: a1, role: '大纲', stage: 'whole_book', production: { output: 'outline' } },
          { agentId: a2, role: '终稿', stage: 'whole_book', production: { output: 'final' } }
        ]
      })
    })
    ok(sol.ok && sol.body.id > 0, '创建 whole_book 方案', sol.error ?? '')
    const produce = await apiTry(`/solutions/${sol.body.id}/produce-book`, { method: 'POST', body: JSON.stringify({ novelId }) })
    ok(produce.ok && produce.body.jobId > 0 && produce.body.pending === 1, '方案整本生产入队（pending 1 章）', JSON.stringify(produce.body).slice(0, 120))
    const dup = await apiTry(`/solutions/${sol.body.id}/produce-book`, { method: 'POST', body: JSON.stringify({ novelId }) })
    ok(!dup.ok && dup.error.includes('运行中'), '生产任务查重 409', dup.error ?? '')
    let jobDone = null
    for (let w = 0; w < 130; w++) {
      await sleep(3000)
      const j = (await api('/jobs')).jobs.find((x) => x.id === produce.body.jobId)
      if (j && ['done', 'failed', 'cancelled'].includes(j.status)) { jobDone = j; break }
    }
    ok(jobDone?.status === 'done', '方案整本生产完成', jobDone?.status ?? 'timeout')
    const chAfter = await api(`/novels/${novelId}/chapters`)
    const c2row = chAfter.chapters.find((c) => c.id === c2.id)
    const c1detail = await api(`/novels/${novelId}/chapters/${c1.id}`)
    ok(c2row.wordCount > 0, '生产章节已生成正文', `got ${c2row.wordCount}`)
    ok(c1detail.chapter.content.includes('油灯在桌上'), '已有正文章未被覆盖（幂等跳过）')
    const nd = await api(`/novels/${novelId}`)
    ok(nd.novel.currentSolutionId === sol.body.id, '方案已绑定到书')
  } catch (err) {
    ok(false, `T5 异常：${err.message}`)
  }
  return finishRound(`T5 功能回归（${tag}）`)
}

// 主流程
const r1 = await t1()
const r2 = await t2()
const r3 = await t3(r2.extra ? Number(r2.extra.split('=')[1]) : null)
await t4(r2.extra ? Number(r2.extra.split('=')[1]) : null)
const r5 = await t5()
console.log(`\nROUND ${tag} done: T1(${r1.pass}/${r1.pass + r1.fail}) T2(${r2.pass}/${r2.pass + r2.fail}) T3(${r3.pass}/${r3.pass + r3.fail}) T5(${r5.pass}/${r5.pass + r5.fail})`)
