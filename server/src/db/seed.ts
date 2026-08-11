import { DatabaseSync } from 'node:sqlite'
import * as PROMPTS from '../prompts/index.ts'

export const TASK_TYPES = [
  'prose',
  'planning',
  'review',
  'analysis',
  'summary',
  'extraction',
  'director',
  'chat',
  'embedding'
] as const

export type TaskType = (typeof TASK_TYPES)[number]

export const DEEPSEEK_BASE_URL = 'https://api.deepseek.com'
export const DEEPSEEK_DEFAULT_MODEL = 'deepseek-v4-flash'
export const DEEPSEEK_PRO_MODEL = 'deepseek-v4-pro'

export function seedIfEmpty(db: DatabaseSync): void {
  seedSystemPrompts(db) // P17-5A?????????????
  const providerCount = (
    db.prepare('SELECT COUNT(*) AS c FROM provider').get() as { c: number }
  ).c

  if (providerCount > 0) return

  db.exec('BEGIN')
  try {
    db.prepare(
      'INSERT INTO provider (name, base_url, api_key_encrypted, is_custom) VALUES (?, ?, ?, ?)'
    ).run('DeepSeek', DEEPSEEK_BASE_URL, '', 0)

    const providerId = (db.prepare('SELECT id FROM provider WHERE name = ?').get('DeepSeek') as {
      id: number
    }).id

    const routes: Array<{
      task: TaskType
      model: string
      thinking: boolean
      effort: 'low' | 'high' | 'max'
      temperature: number | null
      maxTokens: number
      // P2.2 🟡7：planning/review/analysis/summary/director/embedding 为预留路由
      //（当前实现统一走 extraction/prose/chat，P3/P4 拆书/写法引擎启用时消费）
      reserved?: boolean
    }> = [
      { task: 'prose', model: DEEPSEEK_DEFAULT_MODEL, thinking: false, effort: 'high', temperature: 0.9, maxTokens: 8192 },
      { task: 'planning', model: DEEPSEEK_DEFAULT_MODEL, thinking: true, effort: 'high', temperature: null, maxTokens: 8192, reserved: true },
      { task: 'review', model: DEEPSEEK_DEFAULT_MODEL, thinking: true, effort: 'max', temperature: null, maxTokens: 8192, reserved: true },
      { task: 'analysis', model: DEEPSEEK_DEFAULT_MODEL, thinking: true, effort: 'max', temperature: null, maxTokens: 8192, reserved: true },
      { task: 'summary', model: DEEPSEEK_DEFAULT_MODEL, thinking: false, effort: 'high', temperature: 0.3, maxTokens: 4096, reserved: true },
      { task: 'extraction', model: DEEPSEEK_DEFAULT_MODEL, thinking: false, effort: 'high', temperature: 0.2, maxTokens: 4096 },
      { task: 'director', model: DEEPSEEK_DEFAULT_MODEL, thinking: true, effort: 'high', temperature: null, maxTokens: 8192, reserved: true },
      { task: 'chat', model: DEEPSEEK_DEFAULT_MODEL, thinking: false, effort: 'high', temperature: 0.7, maxTokens: 8192 },
      { task: 'embedding', model: DEEPSEEK_DEFAULT_MODEL, thinking: false, effort: 'high', temperature: null, maxTokens: 1024, reserved: true }
    ]

    const insertRoute = db.prepare(
      `INSERT INTO model_route
       (task_type, provider_id, model, thinking_enabled, reasoning_effort, temperature, max_tokens, fallback_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )

    for (const r of routes) {
      // fallback: 主模型同款（同 provider），预留 pro 升级位由用户/校准实验刷新
      const fallback = JSON.stringify([
        { providerId, model: r.model },
        { providerId, model: DEEPSEEK_PRO_MODEL }
      ])
      insertRoute.run(
        r.task,
        providerId,
        r.model,
        r.thinking ? 1 : 0,
        r.effort,
        r.temperature,
        r.maxTokens,
        fallback
      )
    }

    seedGenrePresets(db)
    seedAntiAiRules(db)
    seedSystemPrompts(db)
    seedAgents(db)
    seedSolutionTemplates(db)

    db.exec('COMMIT')
    console.log('[seed] provider + model routes + genre presets + anti-AI rules + solution templates seeded')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}

function seedGenrePresets(db: DatabaseSync): void {
  const insert = db.prepare(
    `INSERT INTO genre_asset (name, genre_type, propulsion_json, payoff_json, conflict_json, beat_templates_json)
     VALUES (?, ?, ?, ?, ?, ?)`
  )

  const presets: Array<{
    name: string
    genreType: string
    propulsion: string[]
    payoff: string[]
    conflict: string[]
    beats: string[]
  }> = [
    {
      name: '都市',
      genreType: '都市',
      propulsion: ['职场升级', '资产积累', '身份揭示'],
      payoff: ['打脸反转', '身份震惊', '实力碾压'],
      conflict: ['同行竞争', '家族争斗', '商业围猎'],
      beats: ['黄金三章：开局冲突→金手指/优势→首个打脸兑现', '断章钩子：新威胁上门/身份疑点抛出']
    },
    {
      name: '玄幻',
      genreType: '玄幻',
      propulsion: ['境界突破', '机缘争夺', '势力扩张'],
      payoff: ['越级碾压', '秘境得宝', '宗门震撼'],
      conflict: ['资源争夺', '宗门仇恨', '天道大劫'],
      beats: ['黄金三章：废材/绝境开局→觉醒/机缘→初战立威', '断章钩子：强敌将至/遗迹开启']
    },
    {
      name: '仙侠',
      genreType: '仙侠',
      propulsion: ['筑基炼气', '因果轮回', '大道领悟'],
      payoff: ['顿悟突破', '恩怨了结', '天道显化'],
      conflict: ['正邪之争', '师门恩怨', '红尘劫难'],
      beats: ['黄金三章：身世悬念→拜师/得法→首劫降临', '断章钩子：旧敌重现/心魔暗生']
    },
    {
      name: '科幻',
      genreType: '科幻',
      propulsion: ['技术解密', '文明接触', '危机升级'],
      payoff: ['技术震撼', '真相揭示', '绝地翻盘'],
      conflict: ['人与AI', '星际战争', '资源枯竭'],
      beats: ['黄金三章：异常事件→线索浮现→危机确认', '断章钩子：更大的异常/系统警告']
    },
    {
      name: '悬疑',
      genreType: '悬疑',
      propulsion: ['线索收集', '嫌疑人筛除', '案件串联'],
      payoff: ['反转揭晓', '真相大白', '连环案归并'],
      conflict: ['凶手对抗', '伪证误导', '时间压力'],
      beats: ['黄金三章：命案开场→第一线索→嫌疑人登场', '断章钩子：新线索推翻旧结论/下一个目标预告']
    },
    {
      name: '言情',
      genreType: '言情',
      propulsion: ['误会发酵', '身份交错', '感情升温'],
      payoff: ['心意揭晓', '误会解除', '破镜重圆'],
      conflict: ['家庭阻力', '第三者介入', '事业爱情两难'],
      beats: ['黄金三章：相遇冲突→心动瞬间→阻碍浮现', '断章钩子：意外之吻/旧情再现']
    }
  ]

  for (const p of presets) {
    insert.run(
      p.name,
      p.genreType,
      JSON.stringify(p.propulsion),
      JSON.stringify(p.payoff),
      JSON.stringify(p.conflict),
      JSON.stringify(p.beats)
    )
  }
}

function seedAntiAiRules(db: DatabaseSync): void {
  const existing = (db.prepare('SELECT COUNT(*) AS c FROM prompt_asset').get() as { c: number }).c
  if (existing > 0) return

  const insert = db.prepare(
    'INSERT INTO prompt_asset (name, task_type, template, slots_json, notes) VALUES (?, ?, ?, ?, ?)'
  )
  insert.run(
    '反AI规则-DeepSeek高频腔词',
    'anti_ai_lexicon',
    JSON.stringify([
      '仿佛', '眼底闪过', '缓缓', '不由得', '刹那间', '微微一怔', '深邃', '喃喃自语',
      '眼神一凛', '嘴角勾起', '周身气势', '一股寒意', '心中暗道', '定睛一看', '若有所思',
      '轻叹一声', '沉默片刻', '空气仿佛凝固', '瞳孔猛地一缩'
    ]),
    '{}',
    'DeepSeek V4 系模型高频 AI 腔词（审查修订 #9 / P4 反 AI 规则预置）'
  )
  insert.run(
    '反AI规则-通用模板句',
    'anti_ai_template',
    JSON.stringify([
      '在接下来的日子里', '就这样，时间一天天过去', '让我们把目光转向', '总而言之',
      '值得一提的是', '不难发现', '众所周知', '仿佛在诉说着什么'
    ]),
    '{}',
    '通用 AI 模板句/解释腔/空泛表达'
  )
}

// P5-2 + P29 C：五内置 Agent 资产化（description/body_md 结构化——对齐 Feelfish 风格）
function seedAgents(db: DatabaseSync): void {
  const existing = (db.prepare('SELECT COUNT(*) AS c FROM agent').get() as { c: number }).c
  if (existing > 0) return
  const insert = db.prepare(
    'INSERT INTO agent (name, role, system_prompt, description, body_md, tools_json, enabled) VALUES (?, ?, ?, ?, ?, ?, 1)'
  )
  const agents: Array<{ name: string; role: string; prompt: string; desc: string; body: string }> = [
    {
      name: '主编',
      role: 'editor',
      prompt: '你是本书的主编。负责把控剧情节奏、爽点安排、章节衔接与整体走向。给出创作约束时聚焦：本章推进、钩子、与前文衔接。',
      desc: '剧情节奏、爽点安排、章节衔接与整体走向的把关者',
      body: [
        '## 核心职责',
        '1. 把控剧情节奏（推进/铺垫/高潮的分配）',
        '2. 设计爽点与钩子，保证章节结尾有读下去的动力',
        '3. 确保章节衔接顺畅，与前文回灌状态一致',
        '',
        '## 质量标准',
        '- 每章必须有明确推进与至少一个钩子',
        '- 爽点符合本书流派模板（兑现方式）',
        '- 不给与目标无关的支线建议',
        '',
        '## 创作原则',
        '- 约束要具体可执行（60-120 字）',
        '- 优先指出"应该做什么"，而非泛泛点评'
      ].join('\n')
    },
    {
      name: '审校',
      role: 'reviewer',
      prompt: '你是本书的审校编辑。负责剧情逻辑、时间线、伏笔系统与文字质量的审核。输出问题清单时标注严重度（high/medium/low）、章节位置、具体问题与修改建议。',
      desc: '剧情逻辑、时间线、伏笔系统与文字质量的审核者',
      body: [
        '## 核心职责',
        '1. 审核剧情逻辑与行为动机合理性',
        '2. 核对时间线、事实一致性',
        '3. 检查伏笔埋设与回收',
        '4. 文字质量与反 AI 腔',
        '',
        '## 质量标准',
        '- 问题按 high/medium/low 标注严重度',
        '- 每个问题给出定位（章节/位置）与修改建议',
        '- 无问题时如实输出（不凑数）'
      ].join('\n')
    },
    {
      name: '角色顾问',
      role: 'character_advisor',
      prompt: '你是本书的角色顾问。负责角色人设与行为一致性（不 OOC）、角色成长弧与关系网的合理性。',
      desc: '人设一致性（不 OOC）、成长弧与关系网',
      body: [
        '## 核心职责',
        '1. 检测角色行为是否脱离人设（OOC）',
        '2. 评估角色成长弧是否合理推进',
        '3. 核对关系网与角色账本当前状态',
        '',
        '## 质量标准',
        '- 结合角色账本的当前状态判断',
        '- 指出与既设档案的矛盾点',
        '- 无 OOC 时输出空数组（不硬造问题）'
      ].join('\n')
    },
    {
      name: '世界观顾问',
      role: 'world_advisor',
      prompt: '你是本书的世界观顾问。负责力量体系、地理、势力规则的自我一致性，防止设定矛盾。',
      desc: '力量体系、地理、势力规则的一致性守护者',
      body: [
        '## 核心职责',
        '1. 核对力量体系/规则使用是否与手册一致',
        '2. 检查地理、势力边界与时间线的矛盾',
        '3. 防止设定被临时推翻',
        '',
        '## 质量标准',
        '- 对照世界手册与势力图谱逐条核查',
        '- 矛盾点标注出处（本章 vs 手册）',
        '- 无矛盾时输出空数组'
      ].join('\n')
    },
    {
      name: '文风顾问',
      role: 'style_advisor',
      prompt: '你是本书的文风顾问。负责写法风格一致性、反 AI 腔词检测、句法节奏的把控。',
      desc: '写法一致性、反 AI 腔词检测、句法节奏',
      body: [
        '## 核心职责',
        '1. 检查写法是否匹配本书绑定风格',
        '2. 检测反 AI 腔词（仿佛/眼底闪过/缓缓等）',
        '3. 句法节奏建议（长短句搭配）',
        '',
        '## 质量标准',
        '- 命中词标注次数与位置',
        '- 风格偏差给出具体改写示范',
        '- 未命中反 AI 词时如实说明'
      ].join('\n')
    }
  ]
  for (const a of agents) {
    insert.run(a.name, a.role, a.prompt, a.desc, a.body, JSON.stringify([]))
  }
  console.log('[seed] 5 built-in agents seeded (assetized)')
}
// P17-5A：系统提示词资产化（14 条，task_type='sys_<key>'；可在提示词工作台编辑）
function seedSystemPrompts(db: DatabaseSync): void {
  const existing = (db.prepare("SELECT COUNT(*) AS c FROM prompt_asset WHERE task_type LIKE 'sys_%'").get() as { c: number }).c
  if (existing > 0) return
  const insert = db.prepare('INSERT INTO prompt_asset (name, task_type, template, slots_json, notes) VALUES (?, ?, ?, ?, ?)')
  const texts = {
    prose: PROMPTS.SYSTEM_PROSE,
    direction: PROMPTS.SYSTEM_DIRECTION,
    titles: PROMPTS.SYSTEM_TITLES,
    world: PROMPTS.SYSTEM_WORLD,
    characters: PROMPTS.SYSTEM_CHARACTERS,
    volumes: PROMPTS.SYSTEM_VOLUMES,
    beats: PROMPTS.SYSTEM_BEATS,
    chapters: PROMPTS.SYSTEM_CHAPTERS,
    review: PROMPTS.SYSTEM_REVIEW,
    fix: PROMPTS.SYSTEM_FIX,
    patch: PROMPTS.SYSTEM_PATCH,
    backfill: PROMPTS.SYSTEM_BACKFILL,
    planning: PROMPTS.SYSTEM_PLANNING,
    macro: PROMPTS.SYSTEM_MACRO
  }
  const keys: Array<keyof typeof texts> = ['prose','direction','titles','world','characters','volumes','beats','chapters','review','fix','patch','backfill','planning','macro']
  for (const key of keys) {
    insert.run('系统提示-' + key, 'sys_' + key, texts[key], '{}', 'P17-5A 提示词资产化（可在提示词工作台编辑）')
  }
  console.log('[seed] system prompts (14) seeded')
}

// P21-1：内置方案模板（对齐内置 5 智能体；依赖 seedAgents 已跑）
function seedSolutionTemplates(db: DatabaseSync): void {
  const existing = (db.prepare('SELECT COUNT(*) AS c FROM solution').get() as { c: number }).c
  if (existing > 0) return
  const roleToAgent = new Map<string, number>()
  const rows = db.prepare('SELECT id, role FROM agent').all() as Array<{ id: number; role: string }>
  for (const r of rows) roleToAgent.set(r.role, r.id)
  const aid = (role: string): number | null => roleToAgent.get(role) ?? null
  const insert = db.prepare(
    'INSERT INTO solution (name, description, primary_agent_id, steps_json, version, enabled) VALUES (?, ?, ?, ?, 1, 1)'
  )
  const templates: Array<{ name: string; description: string; primaryRole: string; steps: Array<{ role: string; stage: 'post_generate' | 'review'; stepRole: string; maxTokens: number }> }> = [
    {
      name: '标准章节复核',
      description: '正文生成后自动复核：主编节奏把关 → 审校问题清单 → 文风顾问反 AI 检查。与内置审核互补。',
      primaryRole: 'editor',
      steps: [
        { role: 'editor', stage: 'post_generate', stepRole: '节奏复核', maxTokens: 1024 },
        { role: 'reviewer', stage: 'review', stepRole: '问题清单', maxTokens: 2048 },
        { role: 'style_advisor', stage: 'post_generate', stepRole: '文风检查', maxTokens: 1024 }
      ]
    },
    {
      name: '世界观一致性审校',
      description: '专查设定矛盾：世界观顾问核对力量体系与地理 → 角色顾问核对人设与关系网。适合设定密集的书。',
      primaryRole: 'world_advisor',
      steps: [
        { role: 'world_advisor', stage: 'review', stepRole: '设定一致性', maxTokens: 2048 },
        { role: 'character_advisor', stage: 'review', stepRole: '人设核对', maxTokens: 2048 }
      ]
    },
    {
      name: '短篇冲刺',
      description: '快速成文流：主编出结构 → 审校查逻辑 → 文风统一。适合短篇/章节快速产出。',
      primaryRole: 'editor',
      steps: [
        { role: 'editor', stage: 'post_generate', stepRole: '结构把关', maxTokens: 1024 },
        { role: 'reviewer', stage: 'review', stepRole: '逻辑检查', maxTokens: 2048 },
        { role: 'style_advisor', stage: 'post_generate', stepRole: '文风统一', maxTokens: 1024 }
      ]
    }
  ]
  for (const t of templates) {
    insert.run(
      t.name,
      t.description,
      aid(t.primaryRole),
      JSON.stringify(
        t.steps.map((s) => ({ agentId: aid(s.role), role: s.stepRole, stage: s.stage, maxTokens: s.maxTokens, if: null }))
      )
    )
  }
  console.log(`[seed] solution templates (${templates.length}) seeded`)
}
