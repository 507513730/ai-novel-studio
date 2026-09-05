// 唯一发布入口：--bump 仅准备；--push 必须完整证据 + 当前提交 CI，通过后才创建新 tag。
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertEvidence, assertRelease, assertVersionDocs, executePublish, MAIN_WORKFLOWS, prepareVersion, selectRuns } from './release-contracts.mjs'

const ROOT = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
const args = process.argv.slice(2)
const PUSH = args.includes('--push')
const E2E = args.includes('--e2e')
const SKIP_DIST = args.includes('--skip-dist')
const REUSE = args.includes('--reuse-evidence')
const provider = args.find(arg => arg.startsWith('--provider='))?.slice(11) ?? 'opencode-go'
const BUMP = args.find(arg => arg.startsWith('--bump='))?.slice(7)
const run = (command, options = {}) => execSync(command, { cwd: ROOT, encoding: 'utf8', stdio: 'pipe', maxBuffer: 16 * 1024 * 1024, ...options }).trim()
const json = command => JSON.parse(run(command))
const read = path => readFileSync(join(ROOT, path), 'utf8')
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const hash = path => createHash('sha256').update(readFileSync(join(ROOT, path))).digest('hex')
const clean = () => { if (run('git status --porcelain')) throw Error('工作区不干净，请先提交已审查改动') }

let releaseObserved = false

async function main() {
  for (const arg of args) if (!['--push', '--e2e', '--skip-dist', '--reuse-evidence'].includes(arg) && !arg.startsWith('--bump=') && !arg.startsWith('--provider=')) throw Error('未知参数：' + arg)
  if (!['opencode-go', 'deepseek'].includes(provider)) throw Error('非法测试供应商')
  if (((PUSH || E2E) && SKIP_DIST) || (REUSE && !PUSH) || (BUMP && args.length !== 1)) throw Error('参数组合不合法；准备版本、仅验证和正式发布必须分开')
  const pkgText = read('package.json')
  const pkg = JSON.parse(pkgText)
  if (!/^\d+\.\d+\.\d+$/.test(pkg.version)) throw Error('版本号非法')
  if (BUMP) {
    const original = read('docs/CHANGELOG.md')
    const prepared = prepareVersion(pkgText, original, BUMP, Boolean(run('git tag -l v' + pkg.version)), new Date().toISOString().slice(0, 10))
    try {
      writeFileSync(join(ROOT, 'package.json'), prepared.packageText, 'utf8')
      writeFileSync(join(ROOT, 'docs/CHANGELOG.md'), prepared.changelog, 'utf8')
    } catch (error) {
      writeFileSync(join(ROOT, 'package.json'), pkgText, 'utf8')
      writeFileSync(join(ROOT, 'docs/CHANGELOG.md'), original, 'utf8')
      throw error
    }
    console.log('版本准备完成：' + prepared.previous + ' → ' + prepared.version + '；同步台账并提交后再验证。未打 tag。')
    return
  }
  clean()
  if (run('git branch --show-current') !== 'main') throw Error('发布入口只允许从 main 执行')
  const head = run('git rev-parse HEAD')
  const version = pkg.version
  const tag = 'v' + version
  if (PUSH && (run('git tag -l ' + tag) || run('git ls-remote --tags origin refs/tags/' + tag))) throw Error('tag 已存在，禁止复用、删除或重指')
  assertVersionDocs(read('docs/CHANGELOG.md'), read('docs/versioning.md'), version)
  if (PUSH && read('docs/CHANGELOG.md').includes('待补充发布说明')) throw Error('发布说明仍含草稿占位')
  const artifacts = ['release/AI-Novel-Studio-Setup-' + version + '.exe', 'release/AI-Novel-Studio-' + version + '-portable-x64.exe']
  let bundleHash
  let artifactHashes
  const prepare = () => {
    for (const command of ['node scripts/check-docs.mjs', 'node scripts/verify-docs.mjs', 'pnpm audit --prod --audit-level=high', 'pnpm audit --audit-level=high', 'pnpm typecheck', 'pnpm lint', 'pnpm test', 'pnpm db:smoke']) {
      run(command)
      console.log('PASS ' + command)
    }
    if (SKIP_DIST) { console.log('仅本地检查：未打包、未发布'); return }
    const buildStarted = Date.now()
    run('pnpm dist')
    for (const file of artifacts) if (!existsSync(join(ROOT, file)) || statSync(join(ROOT, file)).size === 0 || statSync(join(ROOT, file)).mtimeMs < buildStarted - 2000) throw Error('安装包缺失：' + file)
    bundleHash = hash('release/win-unpacked/resources/app.asar')
    artifactHashes = artifacts.map(hash)
    console.log('PASS 双安装包构建')
  }
  const gate = mode => {
    if (REUSE) return
    const flags = mode === 'full' ? '' : '--' + mode
    run('node scripts/e2e/desktop-run.mjs --packaged --provider=' + provider + ' ' + flags + ' --evidence=release/gate-' + mode + '.json', { timeout: 45 * 60 * 1000 })
    console.log('PASS ' + mode)
  }
  const evidence = () => {
    clean()
    if (run('git rev-parse HEAD') !== head || hash('release/win-unpacked/resources/app.asar') !== bundleHash || artifacts.some((file, index) => hash(file) !== artifactHashes[index])) throw Error('验证期间提交或安装包发生变化')
    for (const mode of ['full', 'smoke', 'backup']) assertEvidence(JSON.parse(read('release/gate-' + mode + '.json')), { mode, provider, head, version, bundleHash })
  }
  const waitCi = async (branch, workflows) => {
    const deadline = Date.now() + 30 * 60 * 1000
    for (;;) {
      const runs = json('gh run list --commit ' + head + ' --event push --limit 100 --json databaseId,headSha,headBranch,workflowName,event,status,conclusion')
      const selected = selectRuns(runs, head, branch, workflows)
      const failed = selected.find(item => item?.status === 'completed' && item.conclusion !== 'success')
      if (failed) throw Error('CI 未通过：' + failed.workflowName + ' run=' + failed.databaseId + '，保留失败记录并修复，禁止删除证据')
      if (selected.every(item => item?.status === 'completed' && item.conclusion === 'success')) return selected
      if (Date.now() >= deadline) throw Error('等待指定 SHA 的 CI 超时或缺少必需工作流')
      await pause(15000)
    }
  }
  if (!PUSH) {
    prepare()
    if (!SKIP_DIST) {
      gate('backup')
      if (E2E) { gate('smoke'); gate('full'); evidence() }
    }
    console.log('本地验证完成；未推送、未打 tag、未发布。' + (E2E ? '' : '完整 E2E 未运行。'))
    return
  }
  await executePublish({
    prepare,
    backup: () => gate('backup'),
    smoke: () => gate('smoke'),
    full: () => gate('full'),
    evidence,
    pushMain: () => run('git push origin main'),
    mainCi: async () => {
      await waitCi('main', MAIN_WORKFLOWS)
      const alerts = json('gh api repos/{owner}/{repo}/code-scanning/alerts --method GET -f state=open -f ref=refs/heads/main --paginate --slurp').flat()
      if (alerts.some(alert => ['high', 'critical'].includes(alert.rule?.security_severity_level))) throw Error('存在未关闭的高危 CodeQL 告警')
    },
    tag: () => {
      evidence()
      if (run('git ls-remote --heads origin main').split(/\s/)[0] !== head) throw Error('远端 main 已变化，停止打 tag')
      if (run('git tag -l ' + tag) || run('git ls-remote --tags origin refs/tags/' + tag)) throw Error('tag 已存在')
      run('git tag ' + tag)
      run('git push origin ' + tag)
    },
    tagCi: () => waitCi(tag, ['Build Release']),
    release: () => {
      const release = json('gh release view ' + tag + ' --json tagName,isDraft,isPrerelease,publishedAt,assets,url')
      releaseObserved = true
      assertRelease(release, version)
      mkdirSync(join(ROOT, 'release'), { recursive: true })
      writeFileSync(join(ROOT, 'release/published-evidence.json'), JSON.stringify({ head, version, release, artifactHashes, verifiedAt: new Date().toISOString() }, null, 2), 'utf8')
      const changelog = read('docs/CHANGELOG.md')
      const start = changelog.indexOf('## v' + version)
      const end = changelog.indexOf('\n## ', start + 1)
      writeFileSync(join(ROOT, 'release/release-notes.md'), end < 0 ? changelog.slice(start) : changelog.slice(start, end), 'utf8')
      run('gh release edit ' + tag + ' --notes-file release/release-notes.md')
      console.log('正式发布已验证：' + tag + '。请依据 published-evidence.json 同步发布状态台账。')
    }
  })
}

try { await main() }
catch (error) {
  console.error('发布流程停止：' + error.message)
  if (releaseObserved) console.error('远端 Release 已存在，但验收或收尾未完成；保留 tag，不要删除重建。')
  if (error.stdout) console.error(String(error.stdout).slice(-1600))
  process.exitCode = 1
}
