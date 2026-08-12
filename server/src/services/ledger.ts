import { DatabaseSync } from 'node:sqlite'

// ============================================================
// 角色账本（P2.1 修复 #1）
// 角色状态写入 character.ledger_json.states（追加去重），
// 手动确认（confirm-state）与整本生产（production 回灌）共用，
// 保证两种路径下跨章状态一致性
// ============================================================

// v0.13.0（批E/I4）：势力状态更新——匹配 world.factions_json 中的 name，更新 currentState
export function writeFactionStates(
  db: DatabaseSync,
  novelId: number,
  states: Array<{ name: string; state: string }>
): number {
  let written = 0
  const world = db
    .prepare('SELECT factions_json FROM world WHERE novel_id = ?')
    .get(novelId) as { factions_json: string } | undefined
  if (!world) return 0
  const factions = JSON.parse(world.factions_json || '[]') as Array<Record<string, unknown>>
  for (const fs of states) {
    if (!fs.name || !fs.state) continue
    const target = factions.find((f) => f.name === fs.name)
    if (target) {
      target.currentState = fs.state.slice(0, 120)
      written++
    }
  }
  if (written > 0) {
    db.prepare("UPDATE world SET factions_json = ?, updated_at = datetime('now') WHERE novel_id = ?").run(
      JSON.stringify(factions),
      novelId
    )
  }
  return written
}

export function writeCharacterStates(
  db: DatabaseSync,
  novelId: number,
  states: Array<{ name: string; state: string }>
): number {
  let written = 0
  for (const cs of states) {
    if (!cs.name || !cs.state) continue
    const char = db
      .prepare('SELECT id, ledger_json FROM character WHERE novel_id = ? AND name = ?')
      .get(novelId, cs.name) as { id: number; ledger_json: string } | undefined
    if (char) {
      const ledger = JSON.parse(char.ledger_json || '{}') as { states?: string[] }
      const statesList = ledger.states ?? []
      if (!statesList.includes(cs.state)) {
        statesList.push(cs.state)
        db.prepare('UPDATE character SET ledger_json = ? WHERE id = ?').run(
          JSON.stringify({ ...ledger, states: statesList }),
          char.id
        )
        written++
      }
    }
  }
  return written
}
