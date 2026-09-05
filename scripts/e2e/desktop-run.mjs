import { spawn, execFileSync } from 'node:child_process'
import { createWriteStream, readFileSync } from 'node:fs'
import { mkdir, access, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { dirname, join, resolve, relative, isAbsolute, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertSuites } from '../release-contracts.mjs'
import resultProtocol from './result.cjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const args = process.argv.slice(2)
const modes = ['--probe-directions', '--backup', '--smoke'].filter(flag => args.includes(flag))
if (modes.length > 1) throw Error('一次测试只能选择一种模式')
const mode = modes[0]?.slice(2) ?? 'full'
const require = createRequire(import.meta.url)
const electron = require('electron')
const provider = args.find(arg => arg.startsWith('--provider='))?.slice(11) ?? 'opencode-go'
if (!['opencode-go', 'deepseek'].includes(provider)) throw Error('测试供应商不在允许列表')
const packaged = args.includes('--packaged')
const bundle = join(root, 'release/win-unpacked/resources/app.asar')
if (packaged) await access(bundle)
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
const head = git('rev-parse', 'HEAD')
const dirty = Boolean(git('status', '--porcelain'))
const hashBundle = () => packaged ? createHash('sha256').update(readFileSync(bundle)).digest('hex') : null
const bundleHash = hashBundle()
await mkdir(join(root, 'release'), { recursive: true })
const resultDir = await mkdtemp(join(root, 'release', 'e2e-runner-'))
const resultFile = join(resultDir, 'result.json')
const suitesFile = join(resultDir, 'suites.json')
const evidenceArg = args.find(arg => arg.startsWith('--evidence='))?.slice('--evidence='.length)
const evidenceFile = evidenceArg ? resolve(root, evidenceArg) : join(resultDir, 'evidence.json')
const evidenceRelative = relative(join(root, 'release'), evidenceFile)
if (!evidenceRelative || isAbsolute(evidenceRelative) || evidenceRelative === '..' || evidenceRelative.startsWith('..' + sep)) throw Error('证据文件必须位于 release 目录内')
await writeFile(evidenceFile, JSON.stringify({ code: 1, mode, head, reason: 'running' }), 'utf8')
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
await writeFile(join(resultDir, 'package.json'), JSON.stringify({ name: 'novel-studio-isolated-test', version: pkg.version, main: '../../scripts/e2e/desktop.cjs' }), 'utf8')
const log = createWriteStream(join(resultDir, 'runtime.log'))
const env = { ...process.env, SYSTEM_NODE_EXE: process.execPath,
  E2E_RESULT_FILE: resultFile, E2E_SUITE_RESULTS: suitesFile, E2E_PROVIDER: provider, E2E_FAIL_FAST: '1',
  E2E_PROBE_DIRECTIONS: mode === 'probe-directions' ? '1' : '0',
  E2E_BACKUP_ONLY: mode === 'backup' ? '1' : '0',
  E2E_SMOKE_ONLY: mode === 'smoke' ? '1' : '0', E2E_PACKAGED: packaged ? '1' : '0' }
delete env.ELECTRON_RUN_AS_NODE
const child = spawn(electron, [resultDir], { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
child.stdout.on('data', data => { log.write(data); process.stdout.write(data) })
child.stderr.on('data', data => { log.write(data); process.stderr.write(data) })
child.on('error', error => { console.error(error.message); process.exitCode = 1 })
child.on('close', async code => {
  log.end()
  let result = {}
  let suites = []
  let verified = { rendererReady: false, captureAttempts: 0, diagnostics: [] }
  let passed = false
  try {
    result = JSON.parse(await readFile(resultFile, 'utf8'))
    verified = resultProtocol.readRunResult(result, pkg.version)
    if (mode === 'full') {
      suites = JSON.parse(await readFile(suitesFile, 'utf8'))
      assertSuites(suites)
    }
    passed = code === 0 && result.code === 0 && hashBundle() === bundleHash
  } catch (error) { console.error('测试证据不完整：' + error.message) }
  const changed = dirty || git('rev-parse', 'HEAD') !== head || Boolean(git('status', '--porcelain'))
  const evidence = { code: passed ? 0 : 1, mode, packaged, provider, head, version: pkg.version, bundleHash, dirty: changed,
    suites, rendererReady: verified.rendererReady, captureAttempts: verified.captureAttempts, diagnostics: verified.diagnostics, completedAt: new Date().toISOString(), resultDirectory: resultDir }
  await writeFile(evidenceFile, JSON.stringify(evidence, null, 2), 'utf8')
  console.log('[evidence]', evidenceFile, 'code=' + evidence.code, changed ? '(dirty: 仅供本地调试)' : '')
  process.exitCode = evidence.code
})
