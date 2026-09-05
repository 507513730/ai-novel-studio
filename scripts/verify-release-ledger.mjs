import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { unmatchedPublishedRows } from './release-contracts.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
try {
  const releases = JSON.parse(execFileSync('gh', ['api', 'repos/{owner}/{repo}/releases', '--paginate', '--slurp'], { cwd: root, encoding: 'utf8' })).flat()
  const missing = unmatchedPublishedRows(readFileSync(new URL('../docs/versioning.md', import.meta.url), 'utf8'), releases)
  if (missing.length) throw Error('台账标记已发布但远端无正式 Release：' + missing.join(', '))
  console.log('远端 Release 台账核对通过；tag 或 draft 不计作正式发布')
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
