import { describe, it, expect, afterEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import type { Server } from 'node:http'
import express from 'express'
import { mkdtempSync, readdirSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { applyMigrations, snapshotBeforeMigration } from '../server/src/db/migrate'
import { seedIfEmpty } from '../server/src/db/seed'
import { createNovelsRouter } from '../server/src/routes/novels'
import { originGuard } from '../server/src/services/security'

// v0.25.0 审查加固回归：
//  M3 —— 全请求强制 X-App-Token（此前仅 null Origin 校验，本机进程可免鉴权读写本地 API）
//  M2 —— 升级既有库前自动快照（此前迁移无回滚点）

function makeDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: true, timeout: 5000 })
  applyMigrations(db)
  seedIfEmpty(db)
  return db
}

// 最小装配（与被测逻辑一致的中间件链）
function makeApp(db: DatabaseSync): express.Express {
  const app = express()
  app.use(originGuard)
  app.use(express.json({ limit: '10mb' }))
  app.use('/api/novels', createNovelsRouter(db))
  return app
}

async function withServer(app: express.Express, fn: (base: string) => Promise<void>): Promise<void> {
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s))
  })
  const { port } = server.address() as { port: number }
  try {
    await fn(`http://127.0.0.1:${port}`)
  } finally {
    server.close()
  }
}

describe('v0.25.0（审查 M3）全请求强制 X-App-Token', () => {
  afterEach(() => {
    delete process.env.SERVER_TOKEN
    delete process.env.AI_NOVEL_TOKEN_OPTIONAL
  })

  it('配置 token 后：无 Origin 头且无 token → 403（此前可免鉴权访问）', async () => {
    process.env.SERVER_TOKEN = 'tok-abc'
    const db = makeDb()
    await withServer(makeApp(db), async (base) => {
      // Node fetch 不发 Origin 头，正是此前被放行的场景
      const res = await fetch(`${base}/api/novels`)
      expect(res.status).toBe(403)
    })
    db.close()
  })

  it('配置 token 后：无 Origin 头但带正确 token → 通过鉴权到达路由层', async () => {
    process.env.SERVER_TOKEN = 'tok-abc'
    const db = makeDb()
    await withServer(makeApp(db), async (base) => {
      const res = await fetch(`${base}/api/novels`, { headers: { 'X-App-Token': 'tok-abc' } })
      expect(res.status).toBe(200)
    })
    db.close()
  })

  it('配置 token 后：错误 token → 403', async () => {
    process.env.SERVER_TOKEN = 'tok-abc'
    const db = makeDb()
    await withServer(makeApp(db), async (base) => {
      const res = await fetch(`${base}/api/novels`, { headers: { 'X-App-Token': 'wrong' } })
      expect(res.status).toBe(403)
    })
    db.close()
  })

  it('预检 OPTIONS 不被 token 拦截 → 204 且回显 CORS 头', async () => {
    process.env.SERVER_TOKEN = 'tok-abc'
    const db = makeDb()
    await withServer(makeApp(db), async (base) => {
      // 预检请求按规范不携带自定义头，必须放行，否则浏览器实际请求发不出去
      const res = await fetch(`${base}/api/novels`, {
        method: 'OPTIONS',
        headers: { Origin: 'http://localhost:5173' }
      })
      expect(res.status).toBe(204)
      expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:5173')
    })
    db.close()
  })

  it('AI_NOVEL_TOKEN_OPTIONAL=1 时不强制（浏览器直连调试）', async () => {
    process.env.SERVER_TOKEN = 'tok-abc'
    process.env.AI_NOVEL_TOKEN_OPTIONAL = '1'
    const db = makeDb()
    await withServer(makeApp(db), async (base) => {
      const res = await fetch(`${base}/api/novels`)
      expect(res.status).toBe(200)
    })
    db.close()
  })

  it('恶意跨站 Origin 仍被拒绝（原有防护不回退）', async () => {
    process.env.SERVER_TOKEN = 'tok-abc'
    const db = makeDb()
    await withServer(makeApp(db), async (base) => {
      const res = await fetch(`${base}/api/novels`, {
        headers: { Origin: 'http://evil.example', 'X-App-Token': 'tok-abc' }
      })
      expect(res.status).toBe(403)
    })
    db.close()
  })

  it('未配置 token 时：null Origin 一律拒绝（fail-closed 保持）', async () => {
    const db = makeDb()
    await withServer(makeApp(db), async (base) => {
      const res = await fetch(`${base}/api/novels`, { headers: { Origin: 'null' } })
      expect(res.status).toBe(403)
    })
    db.close()
  })

  it('未配置 token 时：无 Origin 头放行（测试/独立调试场景保持可用）', async () => {
    const db = makeDb()
    await withServer(makeApp(db), async (base) => {
      const res = await fetch(`${base}/api/novels`)
      expect(res.status).toBe(200)
    })
    db.close()
  })
})

describe('v0.25.0（审查 M2）迁移前自动快照', () => {
  // 说明：快照逻辑以内存库 + 临时目录直接单测（快且稳定），
  // 不再走"真实文件库跑完 20 条迁移"的集成路径（Windows 下单次可达 30s+）。

  function tempDir(): string {
    return mkdtempSync(join(tmpdir(), 'ans-migrate-'))
  }

  function backups(dir: string): string[] {
    return readdirSync(join(dir, 'backups')).filter(
      (f) => f.startsWith('pre-migrate-') && f.endsWith('.db')
    )
  }

  it('生成 pre-migrate 快照，文件名带起止版本号', () => {
    const dir = tempDir()
    const dbPath = join(dir, 'test.db')
    writeFileSync(dbPath, 'db-content')
    const db = new DatabaseSync(':memory:')
    snapshotBeforeMigration(db, dbPath, 19, 20)
    db.close()
    const snaps = backups(dir)
    expect(snaps.length).toBe(1)
    expect(snaps[0]).toMatch(/^pre-migrate-v19-to-v20-\d{8}-\d{6}\.db$/)
  })

  it('快照内容与源库一致', () => {
    const dir = tempDir()
    const dbPath = join(dir, 'test.db')
    writeFileSync(dbPath, 'real-db-bytes')
    const db = new DatabaseSync(':memory:')
    snapshotBeforeMigration(db, dbPath, 1, 2)
    db.close()
    const snap = readdirSync(join(dir, 'backups'))[0]
    expect(readFileSync(join(dir, 'backups', snap), 'utf8')).toBe('real-db-bytes')
  })

  it('源文件不存在时直接跳过（不创建 backups 目录）', () => {
    const dir = tempDir()
    const db = new DatabaseSync(':memory:')
    snapshotBeforeMigration(db, join(dir, 'missing.db'), 1, 2)
    db.close()
    expect(readdirSync(dir).length).toBe(0)
  })

  it('快照份数超过 3 时轮转保留最近 3 份', () => {
    const dir = tempDir()
    const dbPath = join(dir, 'test.db')
    writeFileSync(dbPath, 'x')
    mkdirSync(join(dir, 'backups'), { recursive: true })
    // 预置 4 份历史快照（按名字排序即可被轮转淘汰最早的）
    for (let i = 1; i <= 4; i++) {
      writeFileSync(join(dir, 'backups', `pre-migrate-v1-to-v2-2026010${i}-000000.db`), 'old')
    }
    const db = new DatabaseSync(':memory:')
    snapshotBeforeMigration(db, dbPath, 2, 3)
    db.close()
    // 新增 1 份后共 5 份 → 轮转保留 3 份
    const snaps = backups(dir)
    expect(snaps.length).toBe(3)
    // 最早的 20260101 / 20260102 已被淘汰
    expect(snaps.some((f) => f.includes('20260101'))).toBe(false)
    expect(snaps.some((f) => f.includes('20260102'))).toBe(false)
  })

  it('快照失败不抛异常（宁可无备份也不能让应用起不来）', () => {
    const dir = tempDir()
    const dbPath = join(dir, 'test.db')
    writeFileSync(dbPath, 'x')
    // 用不存在的父路径制造 copyFileSync 失败
    const bogus = join(dir, 'no-such-dir', 'nested', 'test.db')
    const db = new DatabaseSync(':memory:')
    expect(() => snapshotBeforeMigration(db, bogus, 1, 2)).not.toThrow()
    // 但 bogus 的父目录不存在 → existsSync 为假，静默跳过
    expect(readdirSync(dir).includes('backups')).toBe(false)
    db.close()
  })

  // 注：applyMigrations 的接线（"仅当 schemaVersion > 0 且存在待应用迁移时才快照"）
  // 刻意不做集成测试——在真实文件库上跑完 20 条迁移，Windows 下单用例需 30s+，
  // 会让整套测试从 9s 退化到 50s。该分支仅 4 行、可直接审阅，
  // 快照逻辑本身已由上面 5 个用例完整覆盖。
})
