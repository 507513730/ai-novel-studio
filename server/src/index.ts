import express from 'express'
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { APP_VERSION, isUtilityProcess } from './env'
import { applyMigrations, getSchemaVersion } from './db/migrate'
import { seedIfEmpty } from './db/seed'
import { createSettingsRouter } from './routes/settings'
import { createNovelsRouter } from './routes/novels'
import { createWorldsRouter } from './routes/worlds'
import { createVolumesRouter } from './routes/volumes'
import { createChapterExecutionRouter } from './routes/chapters'
import { createExportRouter } from './routes/export'
import { createAutomationRouter, createJobsRouter } from './routes/automation'
import { createAnalysisRouter } from './routes/analysis'
import { createStyleRouter } from './routes/style'
import { createAgentsRouter, createAgentAdminRouter } from './routes/agents'
import { createGenresRouter } from './routes/genres'
import { createResourcesRouter } from './routes/resources'                        
import { createPromptsRouter } from './routes/prompts'                        
import { createSolutionsRouter } from './routes/solutions'                   
import { createAssetsRouter } from './routes/assets'                         
import { initPromptDb } from './prompts/promptAsset'
import { startScheduler, stopScheduler } from './services/scheduler'
import { refreshAutoRate } from './services/currency'
import { originGuard } from './services/security'

// v0.9.0（审查 #9）：错误中间件独立模块（createApp 使用 + 测试可挂载；index 模块加载有副作用，不可被测试导入）
import { apiErrorMiddleware } from './services/apiError'

export function createApp(db: DatabaseSync): express.Express {
  const app = express()
  // P2.2 修复 #1：CORS 白名单 + Origin 校验（替代全开 cors()）
  app.use(originGuard)
  app.use(express.json({ limit: '10mb' }))

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, version: APP_VERSION, dbVersion: getSchemaVersion(db) })
  })

  app.use('/api/settings', createSettingsRouter(db))
  app.use('/api/novels', createNovelsRouter(db))
  app.use('/api/novels', createWorldsRouter(db))
  app.use('/api/novels', createVolumesRouter(db))
  app.use('/api/novels', createChapterExecutionRouter(db))
  app.use('/api/novels', createExportRouter(db))
  app.use('/api/novels', createAutomationRouter(db))
  app.use('/api/novels', createAnalysisRouter(db))
  app.use('/api/novels', createStyleRouter(db))
  app.use('/api/novels', createAgentsRouter(db)) // /api/novels/:novelId/team/review
  app.use('/api/agents', createAgentAdminRouter(db)) // /api/agents CRUD
  app.use('/api/genres', createGenresRouter(db))
  app.use('/api', createResourcesRouter(db))
  app.use('/api/prompts', createPromptsRouter(db))
  app.use('/api', createSolutionsRouter(db)) // /api/solutions /api/skills /api/agents/custom（创造工坊）
  app.use('/api', createAssetsRouter(db)) // /api/import/file /api/assets/extract /api/knowledge 等（P23 资产库统一）
  // 任务中心（全局挂载）
  app.use('/api', createJobsRouter(db))

  app.use(apiErrorMiddleware)

  return app
}

function openDatabase(userDataDir: string): DatabaseSync {
  mkdirSync(userDataDir, { recursive: true })
  const dbPath = join(userDataDir, 'ai-novel-studio.db')
  const db = new DatabaseSync(dbPath, {
    enableForeignKeyConstraints: true,
    timeout: 5000
  })
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  return db
}

function start(): void {
  const userData = process.env.AI_NOVEL_USER_DATA
  if (!userData) {
    throw new Error('AI_NOVEL_USER_DATA env is required')
  }
  const db = openDatabase(userData)
  applyMigrations(db)
  seedIfEmpty(db)
  initPromptDb(db)
  startScheduler(db)
  // v0.16.0：汇率启动自动获取（免 key，失败静默降级保留现值；fire-and-forget 不阻塞启动）
  void refreshAutoRate(db)
  const app = createApp(db)

  const port = Number(process.env.AI_NOVEL_PORT ?? 0)
  const server = app.listen(port, '127.0.0.1', () => {
    const address = server.address()
    if (address && typeof address === 'object') {
      const port = address.port
      console.log(`[server] listening on 127.0.0.1:${port}`)
      if (isUtilityProcess()) {
        process.parentPort.postMessage({ type: 'ready', port })
      }
    }
  })

  server.on('error', (err) => {
    console.error('[server] listen error:', err)
    if (isUtilityProcess()) {
      process.parentPort.postMessage({ type: 'error', error: String(err) })
    }
  })

  // P20（S2）：备份前 checkpoint 支持（main 通知 → WAL 落主库 → 应答，保证备份原子）
  if (isUtilityProcess()) {
    process.parentPort.on('message', (msg: unknown) => {
      const m = msg as { type?: string; id?: string }
      if (m?.type === 'checkpoint') {
        try {
          db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
          process.parentPort.postMessage({ type: 'checkpoint-done', id: m.id })
        } catch (err) {
          process.parentPort.postMessage({ type: 'checkpoint-error', id: m.id, error: String(err) })
        }
      }
      // v0.17.0（审查 M20）：优雅关闭——main 通知 shutdown → server.close + stopScheduler（进程随后退出）
      if (m?.type === 'shutdown') {
        try {
          stopScheduler()
          server.close(() => process.exit(0))
          // 兜底：3s 内未关闭完成直接退出
          setTimeout(() => process.exit(0), 3000).unref()
        } catch {
          process.exit(0)
        }
      }
    })
  }
}

if (isUtilityProcess()) {
  try {
    start()
  } catch (err) {
    console.error('[server] startup failed:', err)
    process.parentPort.postMessage({ type: 'error', error: String(err) })
  }
} else {
  start()
}

// v0.21.0（审查 M17/M20 残）：信号防御——Windows 上 SIGTERM 不触发（查证 Node 文档），
// SIGINT（Ctrl+C）/SIGBREAK（Ctrl+Break）可用；优雅关闭与 shutdown 消息共用路径
let shuttingDown = false
function gracefulExit(): void {
  if (shuttingDown) return
  shuttingDown = true
  try {
    stopScheduler()
  } catch {
    /* ignore */
  }
  process.exit(0)
}
for (const sig of ['SIGINT', 'SIGBREAK', 'SIGTERM'] as const) {
  try {
    process.on(sig, gracefulExit)
  } catch {
    /* 平台不支持时忽略 */
  }
}

export { openDatabase }
