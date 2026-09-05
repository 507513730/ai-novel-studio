import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { requestBackupSnapshot } from './shutdown'

export const BACKUP_DB = 'ai-novel-studio.db'
export const BACKUP_PENDING = 'backup-in-progress.json'
const MANIFEST = 'backup-info.json'

export async function createBackupDirectory(
  dataDir: string,
  target: string,
  version: string,
  auto = false,
  snapshot: (path: string) => Promise<void> = requestBackupSnapshot
): Promise<void> {
  if (!existsSync(join(dataDir, BACKUP_DB))) throw new Error('数据库文件不存在，无法备份')
  const absolute = resolve(target)
  const output = join(realpathSync(dirname(absolute)), relative(dirname(absolute), absolute))
  const data = realpathSync(dataDir)
  const child = relative(output, data)
  if (!child || (child !== '..' && !child.startsWith('..' + sep) && !isAbsolute(child))) {
    throw new Error('不能将数据目录或其祖先目录作为备份目标')
  }
  // 独占预留；目标已存在时 mkdir 抛错，绝不清空用户目录。
  mkdirSync(output)
  writeFileSync(join(output, BACKUP_PENDING), JSON.stringify({ createdAt: new Date().toISOString() }), { encoding: 'utf8', flag: 'wx' })
  await snapshot(join(output, BACKUP_DB))
  if (!existsSync(join(output, BACKUP_DB))) throw new Error('快照未生成，备份未完成')
  writeFileSync(join(output, MANIFEST), JSON.stringify({
    app: 'AI-Novel-Studio', version, createdAt: new Date().toISOString(), auto,
    files: [BACKUP_DB], method: 'vacuum-into'
  }, null, 2), { encoding: 'utf8', flag: 'wx' })
  unlinkSync(join(output, BACKUP_PENDING))
}

export function isManagedAutoBackup(directory: string): boolean {
  try {
    const stat = lstatSync(directory)
    if (!stat.isDirectory() || stat.isSymbolicLink()) return false
    const files = readdirSync(directory)
    if (files.length !== 2 || !files.includes(BACKUP_DB) || !files.includes(MANIFEST)) return false
    if (files.some((file) => !lstatSync(join(directory, file)).isFile())) return false
    const info = JSON.parse(readFileSync(join(directory, MANIFEST), 'utf8')) as { app?: string; auto?: boolean }
    return info.app === 'AI-Novel-Studio' && info.auto === true
  } catch { return false }
}

export function listAutoBackups(directory: string): string[] {
  if (!existsSync(directory)) return []
  return readdirSync(directory)
    .filter((name) => /^auto-\d{8}-\d{4}$/.test(name) && isManagedAutoBackup(join(directory, name)))
    .sort()
}

export function removeAutoBackup(directory: string): void {
  if (!isManagedAutoBackup(directory)) return
  // 只删除受管文件，目录出现任何新文件时 rmdir 拒绝，不递归波及用户内容。
  unlinkSync(join(directory, BACKUP_DB))
  unlinkSync(join(directory, MANIFEST))
  rmdirSync(directory)
}

export function resolveBackupDirectory(source: string): string {
  const stat = lstatSync(source)
  if (stat.isSymbolicLink() || (!stat.isDirectory() && (!stat.isFile() || basename(source) !== BACKUP_DB))) {
    throw new Error('请选择备份目录或 ai-novel-studio.db 文件')
  }
  const directory = stat.isDirectory() ? source : dirname(source)
  if (existsSync(join(directory, BACKUP_PENDING))) throw new Error('备份未完成，不能恢复此目录')
  if (!existsSync(join(directory, BACKUP_DB))) throw new Error('所选位置不是有效备份')
  return directory
}
