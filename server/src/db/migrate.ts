import { DatabaseSync } from 'node:sqlite'
import { copyFileSync, mkdirSync, readdirSync, rmSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

const MIGRATIONS: Array<{ version: number; statements: string[] }> = [
  {
    version: 1,
    statements: [
      `CREATE TABLE IF NOT EXISTS novel (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL DEFAULT '',
        inspiration TEXT NOT NULL DEFAULT '',
        direction_json TEXT NOT NULL DEFAULT '[]',
        title_group_json TEXT NOT NULL DEFAULT '[]',
        framing_json TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'draft',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
      `CREATE TABLE IF NOT EXISTS world (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        novel_id INTEGER NOT NULL UNIQUE REFERENCES novel(id) ON DELETE CASCADE,
        manual_json TEXT NOT NULL DEFAULT '{}',
        factions_json TEXT NOT NULL DEFAULT '[]',
        map_json TEXT NOT NULL DEFAULT '{}',
        timeline_json TEXT NOT NULL DEFAULT '[]',
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
      `CREATE TABLE IF NOT EXISTS character (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        novel_id INTEGER NOT NULL REFERENCES novel(id) ON DELETE CASCADE,
        name TEXT NOT NULL DEFAULT '',
        profile_json TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'pending',
        ledger_json TEXT NOT NULL DEFAULT '{}',
        image_path TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
      `CREATE TABLE IF NOT EXISTS volume (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        novel_id INTEGER NOT NULL REFERENCES novel(id) ON DELETE CASCADE,
        title TEXT NOT NULL DEFAULT '',
        strategy_json TEXT NOT NULL DEFAULT '{}',
        skeleton_json TEXT NOT NULL DEFAULT '{}',
        order_index INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
      `CREATE TABLE IF NOT EXISTS beat (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        volume_id INTEGER NOT NULL REFERENCES volume(id) ON DELETE CASCADE,
        title TEXT NOT NULL DEFAULT '',
        summary TEXT NOT NULL DEFAULT '',
        order_index INTEGER NOT NULL DEFAULT 0
      )`,
      `CREATE TABLE IF NOT EXISTS chapter (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        novel_id INTEGER NOT NULL REFERENCES novel(id) ON DELETE CASCADE,
        volume_id INTEGER REFERENCES volume(id) ON DELETE SET NULL,
        beat_id INTEGER REFERENCES beat(id) ON DELETE SET NULL,
        title TEXT NOT NULL DEFAULT '',
        summary TEXT NOT NULL DEFAULT '',
        goal_json TEXT NOT NULL DEFAULT '{}',
        content TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'planned',
        review_json TEXT NOT NULL DEFAULT '{}',
        fix_history_json TEXT NOT NULL DEFAULT '[]',
        word_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
      `CREATE TABLE IF NOT EXISTS chapter_version (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chapter_id INTEGER NOT NULL REFERENCES chapter(id) ON DELETE CASCADE,
        content TEXT NOT NULL DEFAULT '',
        note TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
      `CREATE TABLE IF NOT EXISTS foreshadow (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        novel_id INTEGER NOT NULL REFERENCES novel(id) ON DELETE CASCADE,
        chapter_id INTEGER REFERENCES chapter(id) ON DELETE SET NULL,
        content TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'laid'
      )`,
      `CREATE TABLE IF NOT EXISTS fact (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        novel_id INTEGER NOT NULL REFERENCES novel(id) ON DELETE CASCADE,
        chapter_id INTEGER REFERENCES chapter(id) ON DELETE SET NULL,
        content TEXT NOT NULL DEFAULT '',
        confirmed INTEGER NOT NULL DEFAULT 0
      )`,
      `CREATE TABLE IF NOT EXISTS timeline_event (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        novel_id INTEGER NOT NULL REFERENCES novel(id) ON DELETE CASCADE,
        chapter_id INTEGER REFERENCES chapter(id) ON DELETE SET NULL,
        title TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL DEFAULT '',
        time_ref TEXT NOT NULL DEFAULT ''
      )`,
      `CREATE TABLE IF NOT EXISTS style_asset (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        novel_id INTEGER REFERENCES novel(id) ON DELETE CASCADE,
        name TEXT NOT NULL DEFAULT '',
        features_json TEXT NOT NULL DEFAULT '[]',
        rules_json TEXT NOT NULL DEFAULT '{}',
        samples_json TEXT NOT NULL DEFAULT '[]',
        anti_ai_rules_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
      `CREATE TABLE IF NOT EXISTS genre_asset (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        novel_id INTEGER REFERENCES novel(id) ON DELETE CASCADE,
        name TEXT NOT NULL DEFAULT '',
        genre_type TEXT NOT NULL DEFAULT '',
        propulsion_json TEXT NOT NULL DEFAULT '[]',
        payoff_json TEXT NOT NULL DEFAULT '[]',
        conflict_json TEXT NOT NULL DEFAULT '[]',
        beat_templates_json TEXT NOT NULL DEFAULT '[]'
      )`,
      `CREATE TABLE IF NOT EXISTS book_analysis (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        novel_id INTEGER NOT NULL REFERENCES novel(id) ON DELETE CASCADE,
        depth TEXT NOT NULL DEFAULT 'standard',
        result_json TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
      `CREATE TABLE IF NOT EXISTS kb_doc (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        novel_id INTEGER NOT NULL REFERENCES novel(id) ON DELETE CASCADE,
        title TEXT NOT NULL DEFAULT '',
        source TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'raw',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
      `CREATE TABLE IF NOT EXISTS kb_chunk (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        doc_id INTEGER NOT NULL REFERENCES kb_doc(id) ON DELETE CASCADE,
        content TEXT NOT NULL DEFAULT '',
        hash TEXT NOT NULL UNIQUE,
        embedding_json TEXT NOT NULL DEFAULT '[]'
      )`,
      `CREATE TABLE IF NOT EXISTS prompt_asset (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL DEFAULT '',
        task_type TEXT NOT NULL DEFAULT '',
        template TEXT NOT NULL DEFAULT '',
        slots_json TEXT NOT NULL DEFAULT '{}',
        notes TEXT NOT NULL DEFAULT ''
      )`,
      `CREATE TABLE IF NOT EXISTS provider (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        base_url TEXT NOT NULL DEFAULT '',
        api_key_encrypted TEXT NOT NULL DEFAULT '',
        is_custom INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
      `CREATE TABLE IF NOT EXISTS model_route (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_type TEXT NOT NULL UNIQUE,
        provider_id INTEGER NOT NULL REFERENCES provider(id) ON DELETE CASCADE,
        model TEXT NOT NULL DEFAULT '',
        thinking_enabled INTEGER NOT NULL DEFAULT 0,
        reasoning_effort TEXT NOT NULL DEFAULT 'high',
        temperature REAL,
        max_tokens INTEGER NOT NULL DEFAULT 8192,
        fallback_json TEXT NOT NULL DEFAULT '[]',
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
      `CREATE TABLE IF NOT EXISTS quality_debt (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chapter_id INTEGER NOT NULL REFERENCES chapter(id) ON DELETE CASCADE,
        issue TEXT NOT NULL DEFAULT '',
        severity TEXT NOT NULL DEFAULT 'medium',
        resolved INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
      `CREATE TABLE IF NOT EXISTS job (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'queued',
        progress REAL NOT NULL DEFAULT 0,
        payload_json TEXT NOT NULL DEFAULT '{}',
        result_json TEXT NOT NULL DEFAULT '{}',
        error TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
      `CREATE TABLE IF NOT EXISTS agent (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL DEFAULT '',
        role TEXT NOT NULL DEFAULT '',
        system_prompt TEXT NOT NULL DEFAULT '',
        model_route_id INTEGER REFERENCES model_route(id) ON DELETE SET NULL,
        tools_json TEXT NOT NULL DEFAULT '[]',
        enabled INTEGER NOT NULL DEFAULT 1
      )`,
      `CREATE TABLE IF NOT EXISTS agent_session (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id INTEGER NOT NULL REFERENCES agent(id) ON DELETE CASCADE,
        novel_id INTEGER REFERENCES novel(id) ON DELETE CASCADE,
        messages_json TEXT NOT NULL DEFAULT '[]',
        context_json TEXT NOT NULL DEFAULT '{}',
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
      `CREATE TABLE IF NOT EXISTS director_followup (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        novel_id INTEGER NOT NULL REFERENCES novel(id) ON DELETE CASCADE,
        stage TEXT NOT NULL DEFAULT '',
        checkpoint_json TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'running',
        model_route_id INTEGER REFERENCES model_route(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
      `CREATE TABLE IF NOT EXISTS usage_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        novel_id INTEGER REFERENCES novel(id) ON DELETE SET NULL,
        task_type TEXT NOT NULL DEFAULT '',
        provider TEXT NOT NULL DEFAULT '',
        model TEXT NOT NULL DEFAULT '',
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        cache_hit INTEGER NOT NULL DEFAULT 0,
        cache_miss INTEGER NOT NULL DEFAULT 0,
        cost_estimate REAL NOT NULL DEFAULT 0,
        degraded INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
      `CREATE INDEX IF NOT EXISTS idx_character_novel ON character(novel_id)`,
      `CREATE INDEX IF NOT EXISTS idx_volume_novel ON volume(novel_id)`,
      `CREATE INDEX IF NOT EXISTS idx_beat_volume ON beat(volume_id)`,
      `CREATE INDEX IF NOT EXISTS idx_chapter_novel_status ON chapter(novel_id, status)`,
      `CREATE INDEX IF NOT EXISTS idx_chapter_volume ON chapter(volume_id)`,
      `CREATE INDEX IF NOT EXISTS idx_chapter_version_chapter ON chapter_version(chapter_id)`,
      `CREATE INDEX IF NOT EXISTS idx_foreshadow_novel ON foreshadow(novel_id)`,
      `CREATE INDEX IF NOT EXISTS idx_fact_novel ON fact(novel_id)`,
      `CREATE INDEX IF NOT EXISTS idx_kb_doc_novel ON kb_doc(novel_id)`,
      `CREATE INDEX IF NOT EXISTS idx_kb_chunk_doc ON kb_chunk(doc_id)`,
      `CREATE INDEX IF NOT EXISTS idx_usage_created ON usage_log(created_at)`,
      `CREATE INDEX IF NOT EXISTS idx_usage_novel ON usage_log(novel_id)`
    ]
  },
  {
    version: 2,
    statements: [
      `ALTER TABLE novel ADD COLUMN genre TEXT NOT NULL DEFAULT ''`
    ]
  },
  {
    version: 3,
    statements: [
      // agent_session.agent_id 改可空（Creative Hub 会话可不绑定 agent）
      `ALTER TABLE agent_session RENAME TO agent_session_old`,
      `CREATE TABLE agent_session (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id INTEGER REFERENCES agent(id) ON DELETE CASCADE,
        novel_id INTEGER REFERENCES novel(id) ON DELETE CASCADE,
        messages_json TEXT NOT NULL DEFAULT '[]',
        context_json TEXT NOT NULL DEFAULT '{}',
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
      `INSERT INTO agent_session (id, agent_id, novel_id, messages_json, context_json, updated_at)
       SELECT id, agent_id, novel_id, messages_json, context_json, updated_at FROM agent_session_old`,
      `DROP TABLE agent_session_old`
    ]
  },
  {
    // P17-2：推进模式库（升级流/日常流等节奏模板）+ 世界样本库
    version: 4,
    statements: [
      `CREATE TABLE IF NOT EXISTS story_mode (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        description TEXT NOT NULL DEFAULT '',
        pattern_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
      `CREATE TABLE IF NOT EXISTS world_template (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        manual_json TEXT NOT NULL DEFAULT '{}',
        factions_json TEXT NOT NULL DEFAULT '[]',
        map_json TEXT NOT NULL DEFAULT '{}',
        timeline_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`
    ]
  },
  {
    // P18 D1：基础角色模板库（跨书角色模板）
    version: 5,
    statements: [
      `CREATE TABLE IF NOT EXISTS base_character (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        profile_json TEXT NOT NULL DEFAULT '{}',
        ledger_json TEXT NOT NULL DEFAULT '{}',
        source_novel_id INTEGER REFERENCES novel(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`
    ]
  },
  {
    // P19 ①：书级创作引导（两级引导：书级持久化 + 单次随请求）
    version: 6,
    statements: [
      `ALTER TABLE novel ADD COLUMN guidance TEXT NOT NULL DEFAULT ''`
    ]
  },
  {
    // P19 ②⑤：写作偏好设置（语言 / 格式 / 写作模式），应用级
    version: 7,
    statements: [
      `CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL DEFAULT ''
      )`,
      `INSERT OR IGNORE INTO app_settings (key, value) VALUES
        ('lang', 'simplified'),
        ('format', 'paragraph'),
        ('writingMode', 'standard')`
    ]
  },
  {
    // P20：看门狗字段 + 质量债可消费 + 高频 WHERE 列索引
    version: 8,
    statements: [
      `ALTER TABLE job ADD COLUMN started_at TEXT`,
      `ALTER TABLE quality_debt ADD COLUMN resolved INTEGER NOT NULL DEFAULT 0`,
      `CREATE INDEX IF NOT EXISTS idx_job_status ON job (status)`,
      `CREATE INDEX IF NOT EXISTS idx_style_asset_novel ON style_asset (novel_id)`,
      `CREATE INDEX IF NOT EXISTS idx_genre_asset_novel ON genre_asset (novel_id)`,
      `CREATE INDEX IF NOT EXISTS idx_book_analysis_novel ON book_analysis (novel_id)`,
      `CREATE INDEX IF NOT EXISTS idx_agent_session_novel ON agent_session (novel_id)`,
      `CREATE INDEX IF NOT EXISTS idx_director_followup_novel ON director_followup (novel_id)`,
      `CREATE INDEX IF NOT EXISTS idx_quality_debt_chapter ON quality_debt (chapter_id)`,
      `CREATE INDEX IF NOT EXISTS idx_quality_debt_resolved ON quality_debt (resolved)`,
      `CREATE INDEX IF NOT EXISTS idx_timeline_event_novel ON timeline_event (novel_id)`,
      `CREATE INDEX IF NOT EXISTS idx_usage_log_created ON usage_log (created_at)`
    ]
  },
  {
    // P21-1：智能体资产化 + 技能体系 + 创作方案（创造工坊地基）
    version: 9,
    statements: [
      `ALTER TABLE agent ADD COLUMN description TEXT NOT NULL DEFAULT ''`,
      `ALTER TABLE agent ADD COLUMN skills_json TEXT NOT NULL DEFAULT '[]'`,
      `ALTER TABLE agent ADD COLUMN body_md TEXT NOT NULL DEFAULT ''`,
      `ALTER TABLE agent ADD COLUMN is_custom INTEGER NOT NULL DEFAULT 0`,
      `CREATE TABLE IF NOT EXISTS skill (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        body_md TEXT NOT NULL DEFAULT '',
        novel_id INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
      `CREATE INDEX IF NOT EXISTS idx_skill_novel ON skill (novel_id)`,
      `CREATE TABLE IF NOT EXISTS agent_skill (
        agent_id INTEGER NOT NULL REFERENCES agent(id) ON DELETE CASCADE,
        skill_id INTEGER NOT NULL REFERENCES skill(id) ON DELETE CASCADE,
        PRIMARY KEY (agent_id, skill_id)
      )`,
      `CREATE TABLE IF NOT EXISTS solution (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        primary_agent_id INTEGER REFERENCES agent(id) ON DELETE SET NULL,
        steps_json TEXT NOT NULL DEFAULT '[]',
        version INTEGER NOT NULL DEFAULT 1,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
      `CREATE INDEX IF NOT EXISTS idx_solution_enabled ON solution (enabled)`,
      `CREATE TABLE IF NOT EXISTS solution_version (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        solution_id INTEGER NOT NULL REFERENCES solution(id) ON DELETE CASCADE,
        steps_json TEXT NOT NULL DEFAULT '[]',
        note TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`
    ]
  },
  {
    // P23 批2：外部书容器（拆书导入——不参与导演/生产链）
    version: 10,
    statements: [
      `ALTER TABLE novel ADD COLUMN is_external INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE novel ADD COLUMN source_file TEXT NOT NULL DEFAULT ''`
    ]
  },
  {
    // P23 批3（N8）：提示词出厂模板（还原用）
    version: 11,
    statements: [
      `ALTER TABLE prompt_asset ADD COLUMN original_template TEXT NOT NULL DEFAULT ''`
    ]
  },
  {
    // P27 1-3：最近使用（小说列表排序）
    version: 12,
    statements: [
      `ALTER TABLE novel ADD COLUMN last_opened_at TEXT`
    ]
  },
  {
    // P30：书级生产方案绑定（production pipeline 逐章走流水线）
    // v0.9.0（审查 #13）：列定义加 REFERENCES（新库生效）；已有库由路由层绑定校验兜底（404/409）
    version: 13,
    statements: [
      `ALTER TABLE novel ADD COLUMN current_solution_id INTEGER REFERENCES solution(id) ON DELETE SET NULL`
    ]
  },
  {
    // v0.10.0（批B）：成本预警月度阈值 / 质量债自动修复开关（默认值；复用 v7 的 app_settings 表）
    version: 14,
    statements: [
      `INSERT OR IGNORE INTO app_settings (key, value) VALUES
        ('cost_monthly_budget', '0'),
        ('auto_fix_debts', '1')`
    ]
  },
  {
    // 写书修复（2026-08-12）：全局知识库占位书（novel_id=0）——/knowledge 端点写死 0，
    // 但 novel 表无 id=0 行导致 FK 409（知识库新建功能实际不可用）；全局文档对所有书可见
    version: 15,
    statements: [
      `INSERT OR IGNORE INTO novel (id, title, inspiration, status) VALUES (0, '__global__', '', 'draft')`
    ]
  },
  {
    // v0.15.0：用户创作约束机制——主角名/叙事红线等硬约束独立存储（不受导演 framing 覆盖影响）
    version: 16,
    statements: [
      `ALTER TABLE novel ADD COLUMN constraints_json TEXT NOT NULL DEFAULT '[]'`
    ]
  },
  {
    // v0.16.0：汇率设置（USD→CNY：默认 7.2；source=auto 时启动自动联网更新，manual 时手动覆盖优先）
    // v0.21.0（审查 P3 LOW：迁移数组物理排序）——此前 17 块位于 14/15 之间，与 version 升序不符
    version: 17,
    statements: [
      `INSERT OR IGNORE INTO app_settings (key, value) VALUES
        ('cny_usd_rate', '7.2'),
        ('cny_usd_rate_source', 'auto'),
        ('cny_usd_rate_at', '')`
    ]
  },
  {
    // v0.17.0（审查 M10）：reserved 落库——预留路由（未消费）此前仅 seed 数组标记，DB 无法区分死配置
    version: 18,
    statements: [
      `ALTER TABLE model_route ADD COLUMN reserved INTEGER NOT NULL DEFAULT 0`,
      `UPDATE model_route SET reserved = 1 WHERE task_type IN ('planning', 'review', 'analysis', 'summary', 'director', 'embedding')`
    ]
  },
  {
    // v0.18.0：联网查找开关（默认关闭；启用后知识库联网搜索 + 世界观生成可选注入，零 key Wikipedia）
    version: 19,
    statements: [
      `INSERT OR IGNORE INTO app_settings (key, value) VALUES ('web_search_enabled', '0')`
    ]
  },
  {
    // v0.19.0：人类/AI 字数分离统计（编辑器按来源累计，保存时 delta 上报）
    version: 20,
    statements: [
      `ALTER TABLE chapter ADD COLUMN ai_words INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE chapter ADD COLUMN human_words INTEGER NOT NULL DEFAULT 0`
    ]
  },
  {
    // 重构计划 R2：job.claim_token——scheduler 原子抢占身份。
    // 迟到协程（旧 token）的进度/收尾写入因 id+claim_token+status='running' 不匹配被拒绝（changes=0）；
    // 每次 claim 重新生成，重排队（retry/重启恢复）置 NULL。向前兼容：旧数据默认 NULL。
    version: 21,
    statements: [`ALTER TABLE job ADD COLUMN claim_token TEXT`]
  },
  {
    // 重构计划 R4.1：chapter.generation_token——章节级生成身份（与 job claim token 不同源不同生命周期）。
    // 新一轮抢占覆盖 token 后，旧生成协程的落库/失败处理因 id+novel_id+generation_token+status='generating'
    // 不匹配被拒；重启恢复（generating→planned）一并清空。
    version: 22,
    statements: [`ALTER TABLE chapter ADD COLUMN generation_token TEXT`]
  }
]

export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version

// v0.25.0（审查 M2）：迁移前快照保留份数
const PRE_MIGRATE_KEEP = 3

/**
 * v0.25.0（审查 M2）：迁移前自动快照。
 * 此前 applyMigrations 直接改库且无任何回滚点；自动备份在启动 5 分钟后才首次执行，
 * 而迁移在启动时同步执行——升级过程中一旦迁移异常（或引入破坏性迁移）无快照可回。
 * 快照失败不阻断迁移（宁可无备份，也不能让应用起不来）。
 */
export function snapshotBeforeMigration(db: DatabaseSync, dbPath: string, from: number, to: number): void {
  try {
    if (!existsSync(dbPath)) return
    const dir = join(dirname(dbPath), 'backups')
    mkdirSync(dir, { recursive: true })
    // WAL 落主库后再复制；内存库 / 非 WAL 模式不支持该 pragma，忽略即可
    try {
      db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    } catch {
      /* ignore */
    }
    const now = new Date()
    const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`
    const target = join(dir, `pre-migrate-v${from}-to-v${to}-${stamp}.db`)
    copyFileSync(dbPath, target)
    // 轮转：只保留最近 PRE_MIGRATE_KEEP 份迁移前快照
    const olds = readdirSync(dir)
      .filter((f) => f.startsWith('pre-migrate-') && f.endsWith('.db'))
      .sort()
    while (olds.length > PRE_MIGRATE_KEEP) {
      rmSync(join(dir, olds.shift()!), { force: true })
    }
    console.log(`[migrate] 迁移前快照已保存: ${target}`)
  } catch (err) {
    console.error('[migrate] 迁移前快照失败（不阻断迁移）:', String(err))
  }
}

export function applyMigrations(db: DatabaseSync, dbPath?: string): void {
  db.exec(`CREATE TABLE IF NOT EXISTS _migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`)

  const applied = new Set(
    (db.prepare('SELECT version FROM _migrations').all() as Array<{ version: number }>).map(
      (r) => r.version
    )
  )

  // v0.25.0（审查 M2）：升级既有库（current > 0）且有待应用迁移时先快照。
  // 全新库（current === 0）无数据可保，跳过——避免首次安装产生无意义备份。
  const pending = MIGRATIONS.filter((m) => !applied.has(m.version))
  const current = getSchemaVersion(db)
  if (pending.length > 0 && dbPath && current > 0) {
    snapshotBeforeMigration(db, dbPath, current, pending[pending.length - 1].version)
  }

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) continue
    db.exec('BEGIN')
    try {
      for (const stmt of migration.statements) {
        try {
          db.exec(stmt)
        } catch (err) {
          // P20（S4）：ALTER 迁移幂等——旧备份恢复到新应用时列已存在（_migrations 缺失），
          // 跳过 duplicate column name，其余错误照常抛出
          if (stmt.trim().toUpperCase().startsWith('ALTER TABLE') && /duplicate column name/i.test(String(err))) {
            console.log(`[migrate] skip ${stmt.trim().split('\n')[0]} (column already exists)`)
            continue
          }
          throw err
        }
      }
      db.prepare('INSERT INTO _migrations (version) VALUES (?)').run(migration.version)
      db.exec('COMMIT')
      console.log(`[migrate] applied v${migration.version}`)
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
  }
}

export function getSchemaVersion(db: DatabaseSync): number {
  const row = db.prepare('SELECT COALESCE(MAX(version), 0) AS v FROM _migrations').get() as {
    v: number
  }
  return row.v
}
