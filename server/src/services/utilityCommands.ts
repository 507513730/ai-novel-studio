import type { DatabaseSync } from 'node:sqlite'

export function handleUtilityCommand(
  event: unknown,
  db: DatabaseSync,
  reply: (message: Record<string, unknown>) => void,
  shutdown: () => void
): void {
  const data = (event as { data?: unknown } | null)?.data
  if (!data || typeof data !== 'object') return
  const message = data as { type?: string; id?: string; destination?: string }
  if (message.type === 'shutdown') {
    shutdown()
    return
  }
  if (message.type !== 'backup-snapshot' || typeof message.id !== 'string') return
  try {
    if (typeof message.destination !== 'string' || !message.destination) throw new Error('备份目标无效')
    db.prepare('VACUUM INTO ?').run(message.destination)
    reply({ type: 'backup-done', id: message.id })
  } catch (error) {
    reply({ type: 'backup-error', id: message.id, error: String(error) })
  }
}
