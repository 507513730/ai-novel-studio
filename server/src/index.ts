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
import { initPromptDb } from './prompts/promptAsset'
import { startScheduler } from './services/scheduler'
import { originGuard } from './services/security'
import { ZodError } from 'zod'

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
  // 任务中心（全局挂载）
  app.use('/api', createJobsRouter(db))

  app.use(
    (
      err: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction
    ) => {
      // P2.2 🟡9：错误码语义化
      if (err instanceof ZodError) {
        res.status(400).json({ error: '参数校验失败', issues: err.issues })
        return
      }
      const message = err instanceof Error ? err.message : String(err)
      // SQLite 约束/冲突 → 409
      if (/FOREIGN KEY constraint|UNIQUE constraint|NOT NULL constraint/i.test(message)) {
        res.status(409).json({ error: message })
        return
      }
      console.error('[api] error:', message)
      res.status(500).json({ error: message })
    }
  )

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

export { openDatabase }
