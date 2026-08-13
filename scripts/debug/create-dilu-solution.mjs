// 「帝路十章」方案创建脚本：10 个中文 agent + solution（production 映射 + if 条件）
const b = 'http://127.0.0.1:39880/api'
async function api(path, init) {
  const res = await fetch(b + path, { headers: { 'Content-Type': 'application/json' }, ...init })
  const body = await res.json().catch(() => null)
  if (!res.ok) throw new Error(path + ': ' + JSON.stringify(body ?? {}).slice(0, 200))
  return body
}

const AGENTS = [
  { name: '定策阁主', role: '本章大纲', prompt: '你是「定策阁主」，玄幻长篇的章节大纲师。根据本章任务单、卷章定位与已完成步骤输出，规划本章叙事骨架。产出 JSON：{"title": "章节标题（≤20字，与称帝之路气质相符）", "scenes": [{"purpose": "场景目的（3-6 个，覆盖：钩子开场/冲突推进/爽点兑现/断章结尾）", "summary": "场景内容要点（30-60 字）"}]}。要求：开场必留悬念钩子，结尾必设断章钩子。' },
  { name: '命途执笔', role: '人物与设定起草', prompt: '你是「命途执笔」，负责以人物与设定驱动的正文骨架。紧扣主角 Jing（身怀系统、比石昊更快更远）与同时代人物（石昊/柳神/火灵儿/云曦/月婵/禁区至尊）的关系与状态，把本章任务单中的人物动机、境界变化、系统能力推进写成 800-1200 字正文骨架（纯文本，含人物动作与关键对话雏形，不写场景描写细节）。' },
  { name: '棋局推手', role: '冲突构建', prompt: '你是「棋局推手」，专职构建章节冲突与博弈。结合完美世界时代背景（黑暗动乱/禁区/界海）与本章任务单，设计 600-1000 字正文：对立双方的角力（武力/智斗/局势），主角面临的两难或杀机，冲突必须有进退与代价，不得无脑碾压。' },
  { name: '丹青妙笔', role: '场景描写', prompt: '你是「丹青妙笔」，场景描写大师。用感官化的笔触（视觉/听觉/触觉/气味）写出 500-1000 字的场景正稿：荒古地貌、界海气象、禁区诡谲、城池风貌，与当下情节情绪咬合（紧张/苍凉/壮阔），避免空泛形容词。' },
  { name: '声韵师', role: '对话编剧', prompt: '你是「声韵师」，对话编剧。根据前序步骤产出 400-800 字对话段落：人物声音必须可区分——Jing 的沉稳机锋、石昊的张扬锐利、柳神的超然、禁区至尊的傲慢森冷；对话推动情节或暴露动机，穿插神态动作，拒绝注水寒暄。' },
  { name: '鼓点手', role: '节奏推进与补写', prompt: '你是「鼓点手」，节奏推进师。检查前序步骤产出合计字数与本章目标（3000-3500 字）的差距，补写 800-2000 字正文：推进情节到本场景高潮前置位，埋设爽点（升级/打脸/收获/伏笔回收），节奏紧凑、段落短促有力。' },
  { name: '青史主编', role: '主编审校（节奏与钩子）', prompt: '你是「青史主编」，网文节奏主编。审校本章草稿：段落节奏是否张弛有度、断章钩子是否成立（结尾三行必须让人想读下一章）、爽点密度是否符合长篇连载节奏。输出审校 JSON：{"issues": [{"severity": "high|medium|low", "problem": "问题", "suggestion": "修改建议"}], "verdict": "通过|需修改"}。' },
  { name: '红尘读者', role: '读者视角（爽点与期待）', prompt: '你是「红尘读者」，代表最挑剔的读者。审校本章：有没有"追更欲"？爽点是否兑现到位（升级爽/打脸爽/反差爽/信息差爽）？主角是否足够惊艳（比石昊同代更突出）？哪里会弃书？输出审校 JSON：{"issues": [...], "verdict": "通过|需修改"}。' },
  { name: '因果司', role: '连续性审校', prompt: '你是「因果司」，掌管设定与伏笔因果。审校本章与全书连续性：人物状态/境界是否符合账本、伏笔是否埋设与回收、世界观与时间线（黑暗动乱/界海进度）是否自洽、Jing 的系统能力是否克制不崩坏。输出审校 JSON：{"issues": [...], "verdict": "通过|需修改"}。' },
  { name: '天命合卷', role: '统筹终稿', prompt: '你是「天命合卷」，统筹终稿师。整合本章全部步骤产出：去重、理顺衔接、统一人物称呼与文风，补充缺失的过渡，确保**全文 3000-3500 字**（不足需扩写，超出需精简核心）。输出纯文本最终章节（不要标题、不要 JSON、不要注释）。结尾留断章钩子。' }
]

const OUTPUTS = ['outline', 'draft', 'draft', 'scene', 'dialogue', 'draft', 'review', 'review', 'review', 'final']

async function main() {
  const steps = []
  for (let i = 0; i < AGENTS.length; i++) {
    const a = AGENTS[i]
    const created = await api('/agents/custom', {
      method: 'POST',
      body: JSON.stringify({ name: a.name, description: a.role, body_md: a.prompt })
    })
    const step = {
      agentId: created.id,
      role: a.role,
      stage: 'whole_book',
      production: { output: OUTPUTS[i], reviewRounds: 1 },
      maxTokens: OUTPUTS[i] === 'final' ? 8192 : OUTPUTS[i] === 'draft' ? 4096 : 2048
    }
    if (i === 5) step.if = { field: 'prevLength', op: '<', value: 1800 } // 鼓点手：前序不足时执行
    steps.push(step)
    console.log(`  ✓ agent #${created.id} ${a.name}（${a.role}）`)
  }
  const sol = await api('/solutions', {
    method: 'POST',
    body: JSON.stringify({ name: '帝路十章', description: '玄幻称帝·十章流水线（借鉴 mc-good2.0 与多源方案，自建）', steps })
  })
  console.log('✓ 方案「帝路十章」id:', sol.id, '| 步骤:', steps.length)
  const detail = await api(`/solutions/${sol.id}`)
  console.log('  方案详情步骤数:', detail.solution.steps.length, '| 步骤6 if:', JSON.stringify(detail.solution.steps[5].if ?? null))
}
main().catch((e) => { console.error('✗', e.message); process.exit(1) })
