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
import { startJobScheduler as startScheduler, stopJobScheduler as stopScheduler } from './services/jobs/scheduler'
import { refreshAutoRate } from './services/currency'
import { originGuard } from './services/security'
import { handleUtilityCommand } from './services/utilityCommands'
import { validateRestoreDatabase } from './services/restoreValidation'

// v0.9.0（审查 #9）：错误中间件独立模块（createApp 使用 + 测试可挂载；index 模块加载有副作用，不可被测试导入）
import { apiErrorMiddleware } from './services/apiError'

export function createApp(db: DatabaseSync, isPaused: () => boolean = () => false): express.Express {
  const app = express()
  // P2.2 修复 #1：CORS 白名单 + Origin 校验（替代全开 cors()）
  app.use(originGuard)
  app.use(express.json({ limit: '10mb' }))
  app.use((req, res, next) => {
    if (isPaused() && req.path !== '/api/health') { res.status(503).json({ error: '数据恢复确认中，请稍后重试' }); return }
    next()
  })

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
  // v0.25.0（审查 M2）：传入库路径——存在待应用迁移时先做迁移前快照
  applyMigrations(db, join(userData, 'ai-novel-studio.db'))
  seedIfEmpty(db)
  initPromptDb(db)
  let paused = process.env.AI_NOVEL_RESTORE_PAUSED === '1'
  if (!paused) startScheduler(db)
  // v0.16.0：汇率启动自动获取（免 key，失败静默降级保留现值；fire-and-forget 不阻塞启动）
  if (!paused) void refreshAutoRate(db)
  const app = createApp(db, () => paused)

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

  if (isUtilityProcess()) {
    process.parentPort.on('message', (event: unknown) => {
      const command = (event as { data?: { type?: string; id?: string } })?.data
      if (command?.type === 'activate-restored' && typeof command.id === 'string') {
        if (paused) { paused = false; startScheduler(db); void refreshAutoRate(db) }
        const address = server.address()
        if (address && typeof address === 'object') process.parentPort.postMessage({ type: 'activated', id: command.id, port: address.port })
        return
      }
      handleUtilityCommand(event, db, (message) => process.parentPort.postMessage(message), () => {
        try {
          stopScheduler()
          const exitClosed = (): void => {
            try {
              db.close()
              process.exit(0)
            } catch (error) {
              console.error('[server] database close failed:', String(error))
              process.exit(1)
            }
          }
          server.close(exitClosed)
          setTimeout(exitClosed, 3000).unref()
        } catch {
          process.exit(0)
        }
      })
    })
  }
}

if (isUtilityProcess() && process.env.AI_NOVEL_RESTORE_SOURCE) {
  try {
    validateRestoreDatabase(process.env.AI_NOVEL_RESTORE_SOURCE, process.env.AI_NOVEL_RESTORE_OUTPUT ?? '')
    process.parentPort.postMessage({ type: 'restore-validated' })
    process.exit(0)
  } catch { process.exit(1) }
} else if (isUtilityProcess()) {
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
