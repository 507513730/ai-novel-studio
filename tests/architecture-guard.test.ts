// 重构计划 R9.2：轻量架构守护——域边界用源码扫描断言固化，
// 防止路由重新直接执行重型链路、生产绕过章节域落库、scheduler 回流业务执行器。
import { describe, expect, it } from 'vitest'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8')

function routeFiles(): string[] {
  const dir = join(ROOT, 'server/src/routes')
  const out: string[] = []
  const walk = (d: string, prefix: string): void => {
    for (const f of readdirSync(d, { withFileTypes: true })) {
      if (f.isDirectory()) walk(join(d, f.name), `${prefix}${f.name}/`)
      else if (f.name.endsWith('.ts')) out.push(`server/src/routes/${prefix}${f.name}`)
    }
  }
  walk(dir, '')
  return out
}

describe('架构守护（R9.2）', () => {
  it('兼容入口已删除：services/{generate,context,llm,scheduler,director,production,jobQueue}.ts 不存在', () => {
    for (const f of ['generate', 'context', 'llm', 'scheduler', 'director', 'production', 'jobQueue']) {
      expect(existsSync(join(ROOT, `server/src/services/${f}.ts`)), `${f}.ts 应已删除`).toBe(false)
    }
  })

  it('routes 不导入重型 pipeline（导演/整本生产/scheduler 只能由 job 执行器驱动）', () => {
    for (const f of routeFiles()) {
      const s = read(f)
      expect(s.includes("director/pipeline'"), `${f} 导入了导演 pipeline`).toBe(false)
      expect(s.includes("production/pipeline'"), `${f} 导入了生产 pipeline`).toBe(false)
      expect(s.includes("jobs/scheduler'"), `${f} 导入了 scheduler`).toBe(false)
    }
  })

  it('生产域不写版本快照、不做章节抢占（正文落库唯一走章节生成域）', () => {
    const s = read('server/src/services/production/pipeline.ts')
    expect(s).not.toContain('INSERT INTO chapter_version')
    expect(s).not.toContain("status = 'generating'")
    expect(s).toContain('generateChapter') // 统一走章节生成域
  })

  it('章节后处理不写 chapter / chapter_version（落库唯一走 persistence.ts）', () => {
    const s = read('server/src/services/chapterGeneration/postProcess.ts')
    expect(s).not.toContain('UPDATE chapter')
    expect(s).not.toContain('INSERT INTO chapter_version')
    expect(s).not.toContain("status = 'generating'")
  })

  it('scheduler 不内联业务执行器（五类任务全部在 executors 注册表）', () => {
    const s = read('server/src/services/jobs/scheduler.ts')
    for (const sym of ['runDirectorPipeline', 'runProductionPipeline', 'fixAllDebts', 'refineOne', 'runProductionChapter']) {
      expect(s.includes(sym), `scheduler 不应内联 ${sym}`).toBe(false)
    }
  })

  it('chapter_version 的 INSERT 仅允许两处：章节生成域 persistence 与版本管理路由（手动快照/恢复）', () => {
    const offenders: string[] = []
    const walk = (d: string, prefix: string): void => {
      for (const f of readdirSync(d, { withFileTypes: true })) {
        if (f.isDirectory()) walk(join(d, f.name), `${prefix}${f.name}/`)
        else if (f.name.endsWith('.ts')) {
          const rel = `server/src/${prefix}${f.name}`
          const s = read(rel)
          if (s.includes('INSERT INTO chapter_version') && !rel.includes('chapterGeneration/persistence.ts') && !rel.includes('routes/chapters/versions.ts')) {
            offenders.push(rel)
          }
        }
      }
    }
    walk(join(ROOT, 'server/src'), '')
    expect(offenders).toEqual([])
  })
})
