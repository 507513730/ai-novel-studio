import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdir, access, mkdtemp, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const require = createRequire(import.meta.url)
const electron = require('electron')
const packaged = process.argv.includes('--packaged')
if (packaged) await access(join(root, 'release/win-unpacked/resources/app.asar'))
await mkdir(join(root, 'release'), { recursive: true })
const resultDir = await mkdtemp(join(root, 'release', 'e2e-runner-'))
const resultFile = join(resultDir, 'result.json')
const log = createWriteStream(join(root, 'release', 'desktop-e2e-' + Date.now() + '.log'))
const env = { ...process.env, SYSTEM_NODE_EXE: process.execPath,
  E2E_RESULT_FILE: resultFile,
  E2E_SMOKE_ONLY: process.argv.includes('--smoke') ? '1' : '0', E2E_PACKAGED: packaged ? '1' : '0' }
delete env.ELECTRON_RUN_AS_NODE
const child = spawn(electron, [join(root, 'scripts/e2e/desktop.cjs')], {
  cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']
})
child.stdout.on('data', data => { log.write(data); process.stdout.write(data) })
child.stderr.on('data', data => { log.write(data); process.stderr.write(data) })
child.on('error', error => { console.error(error.message); process.exitCode = 1; log.end() })
child.on('close', async code => {
  log.end()
  try {
    const result = JSON.parse(await readFile(resultFile, 'utf8'))
    process.exitCode = code === 0 && result.code === 0 ? 0 : 1
  } catch {
    console.error('测试结果文件缺失或损坏，拒绝判定通过')
    process.exitCode = 1
  }
})
