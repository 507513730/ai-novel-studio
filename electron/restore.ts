import { constants, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { BACKUP_DB, resolveBackupDirectory } from './backup'

const FILES = [BACKUP_DB, BACKUP_DB + '-wal', BACKUP_DB + '-shm']
const PENDING = 'restore-pending.json'
const JOURNAL = 'restore.json'
interface Journal { app: string; original: string[]; createdAt: string }
export interface RestoreServices {
  validate: (source: string, output: string) => Promise<void>
  stop: () => Promise<void>
  start: (paused: boolean) => Promise<void>
  activate: () => Promise<void>
}

function regularFile(path: string): void {
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('备份文件必须为普通文件')
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, JSON.stringify(value), { encoding: 'utf8', flag: 'wx', flush: true })
}

function readJournal(directory: string): Journal {
  regularFile(join(directory, JOURNAL))
  const value = JSON.parse(readFileSync(join(directory, JOURNAL), 'utf8')) as Journal
  if (value.app !== 'AI-Novel-Studio' || !Array.isArray(value.original) ||
    !value.original.includes(BACKUP_DB) || new Set(value.original).size !== value.original.length ||
    value.original.some(file => !FILES.includes(file))) throw new Error('恢复记录无效，已停止自动处理')
  return value
}

function rollback(dataDir: string, directory: string): void {
  const journal = readJournal(directory)
  const beforeStat = lstatSync(join(directory, 'before'))
  if (!beforeStat.isDirectory() || beforeStat.isSymbolicLink()) throw new Error('原库副本目录无效')
  for (const file of FILES) {
    const saved = join(directory, 'before', file)
    const active = join(dataDir, file)
    if (existsSync(saved)) {
      regularFile(saved)
      // 保留原件；回退中再次中断仍可重放。
      const temporary = join(directory, 'rollback-' + file)
      copyFileSync(saved, temporary)
      renameSync(temporary, active)
    } else if (!journal.original.includes(file) && existsSync(active)) {
      regularFile(active)
      unlinkSync(active)
    } else if (journal.original.includes(file) && !existsSync(active)) {
      throw new Error('原库文件缺失，已停止回退')
    }
  }
}

/** 启动服务前处理未提交的切换；损坏记录拒绝启动，不猜测路径。 */
export function recoverInterruptedRestore(dataDir: string): void {
  const pending = join(dataDir, PENDING)
  if (!existsSync(pending)) return
  regularFile(pending)
  const { directory } = JSON.parse(readFileSync(pending, 'utf8')) as { directory?: string }
  if (typeof directory !== 'string' || !/^restore-[A-Za-z0-9]+$/.test(directory)) throw new Error('恢复目录记录无效')
  const work = join(dataDir, directory)
  const stat = lstatSync(work)
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('恢复目录无效')
  readJournal(work)
  if (!existsSync(join(work, 'committed'))) rollback(dataDir, work)
  else regularFile(join(work, 'committed'))
  unlinkSync(pending)
}

function prunePrevious(dataDir: string, keep: string): void {
  for (const name of readdirSync(dataDir)) {
    if (!/^restore-[A-Za-z0-9]+$/.test(name) || join(dataDir, name) === keep) continue
    const directory = join(dataDir, name)
    try {
      if (lstatSync(directory).isSymbolicLink() || !existsSync(join(directory, 'committed'))) continue
      const journal = readJournal(directory)
      const allowed = [JOURNAL, 'committed', 'before', 'backup-info.json']
      if (readdirSync(directory).some(file => !allowed.includes(file))) continue
      const before = join(directory, 'before')
      if (lstatSync(before).isSymbolicLink()) continue
      const files = readdirSync(before)
      if (files.some(file => !journal.original.includes(file) && file !== 'backup-info.json')) continue
      for (const file of files) regularFile(join(before, file))
      for (const file of files) unlinkSync(join(before, file))
      rmdirSync(before)
      for (const file of readdirSync(directory)) { regularFile(join(directory, file)); unlinkSync(join(directory, file)) }
      rmdirSync(directory)
    } catch { /* 未知内容或清理失败保留副本，不影响已完成恢复。 */ }
  }
}

export async function restoreBackup(dataDir: string, source: string, version: string, services: RestoreServices): Promise<string> {
  if (existsSync(join(dataDir, PENDING))) throw new Error('存在未完成恢复，请重启应用后重试')
  const sourceDir = resolveBackupDirectory(source)
  if (realpathSync(sourceDir) === realpathSync(dataDir)) throw new Error('不能从当前活动数据库恢复，请先导出备份')
  const work = mkdtempSync(join(dataDir, 'restore-'))
  const incoming = join(work, 'incoming')
  const before = join(work, 'before')
  mkdirSync(incoming)
  mkdirSync(before)
  // 所有外部输入先复制，校验进程永不打开原备份或活动库。
  for (const file of FILES) {
    const input = join(sourceDir, file)
    if (file !== BACKUP_DB && !existsSync(input)) continue
    regularFile(input)
    copyFileSync(input, join(incoming, file), constants.COPYFILE_EXCL)
  }
  const candidate = join(work, 'candidate.db')
  await services.validate(join(incoming, BACKUP_DB), candidate)
  regularFile(candidate)
  let stopped = false
  let journalWritten = false
  let committed = false
  try {
    await services.stop()
    stopped = true
    const original = FILES.filter(file => existsSync(join(dataDir, file)))
    for (const file of original) regularFile(join(dataDir, file))
    if (!original.includes(BACKUP_DB)) throw new Error('原数据库不存在，停止恢复')
    writeJson(join(work, JOURNAL), { app: 'AI-Novel-Studio', original, createdAt: new Date().toISOString() })
    writeJson(join(dataDir, PENDING), { directory: basename(work) })
    journalWritten = true
    for (const file of original) renameSync(join(dataDir, file), join(before, file))
    renameSync(candidate, join(dataDir, BACKUP_DB))
    await services.start(true)
    writeJson(join(before, 'backup-info.json'), { app: 'AI-Novel-Studio', version, files: original, method: 'closed-database', createdAt: new Date().toISOString() })
    writeJson(join(work, 'committed'), { version })
    committed = true
    unlinkSync(join(dataDir, PENDING))
  } catch (error) {
    if (stopped && !committed) {
      // 新服务可能异步启动失败；确认退出后才回退，失败则保留 journal 阻止下次误启动。
      await services.stop()
      if (journalWritten) recoverInterruptedRestore(dataDir)
      await services.start(false)
    }
    throw error
  }
  await services.activate()
  // 仅清理本次暂存的已知文件，未知内容一律保留。
  try {
    const files = readdirSync(incoming)
    if (files.every(file => FILES.includes(file))) {
      for (const file of files) { regularFile(join(incoming, file)); unlinkSync(join(incoming, file)) }
      rmdirSync(incoming)
    }
  } catch { /* 保留暂存文件供诊断。 */ }
  prunePrevious(dataDir, work)
  return before
}
