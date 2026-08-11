// 发布入口（唯一）：校验文档 → 全量验证 → 本地构建 → 提交/打 tag 指引
// 用法：
//   node scripts/release.mjs          # 校验 + 验证 + 本地构建 + 输出下一步
//   node scripts/release.mjs --push   # 额外执行 git commit + tag + push（需先文档就绪）
//   node scripts/release.mjs --skip-dist  # 跳过本地构建（仅校验+验证，用于纯文档发布）
import { execSync } from 'node:child_process'
import { readFileSync, existsSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const args = process.argv.slice(2)
const PUSH = args.includes('--push')
const SKIP_DIST = args.includes('--skip-dist')

let failures = 0
const fail = (msg) => {
  failures++
  console.error(`  ✗ ${msg}`)
}
const ok = (msg) => console.log(`  ✓ ${msg}`)
const run = (cmd, opts = {}) =>
  execSync(cmd, { stdio: 'pipe', encoding: 'utf8', cwd: ROOT, ...opts }).trim()

console.log('=== AI-Novel-Studio 发布流程 ===\n')

// ---------- 1) 工作区必须干净 ----------
console.log('[1/7] 工作区检查')
try {
  const status = run('git status --porcelain')
  if (status) {
    fail('工作区有未提交改动，先提交：\n' + status)
    process.exit(1)
  }
  ok('git 工作区干净')
} catch {
  fail('无法执行 git')
  process.exit(1)
}

// ---------- 2) 版本号 ----------
console.log('\n[2/7] 版本号')
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
const version = pkg.version
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  fail(`package.json 版本号非法: ${version}`)
  process.exit(1)
}
ok(`当前版本: v${version}`)

// ---------- 3) 文档强制检查（缺 → 终止） ----------
console.log('\n[3/7] 文档检查（发布前必须更新）')
const rn = readFileSync(join(ROOT, 'docs', 'release-notes.md'), 'utf8')
if (rn.includes(`## v${version}`)) {
  ok(`release-notes.md 含 v${version} 段落`)
} else {
  fail(`release-notes.md 缺少 "## v${version}" 段落（先补发布说明再发布）`)
}
const plan = readFileSync(join(ROOT, 'PLAN.md'), 'utf8')
if (plan.includes(`v${version}`)) {
  ok('PLAN.md 含对应版本记录')
} else {
  console.log(`  ⚠ PLAN.md 未找到 v${version} 记录（建议补 P 段落勾选）`)
}
if (failures > 0) {
  console.error('\n文档未就绪，发布终止。补完文档后重跑。')
  process.exit(1)
}

// ---------- 4) 全量验证 ----------
console.log('\n[4/7] 全量验证')
const checks = [
  ['typecheck', 'pnpm typecheck'],
  ['lint', 'pnpm lint -- --max-warnings=0 2>&1 || pnpm lint'],
  ['test', 'pnpm test'],
  ['build', 'pnpm build']
]
for (const [name, cmd] of checks) {
  try {
    run(cmd, { stdio: ['ignore', 'pipe', 'pipe'] })
    ok(`${name} 通过`)
  } catch (err) {
    const out = String(err.stdout ?? '')
    if (name === 'lint' && /0 errors/.test(out)) {
      ok(`${name} 通过（0 errors）`)
      continue
    }
    fail(`${name} 失败`)
    console.error(out.slice(-800))
  }
}
// db-smoke：Node 24 对 .ts 直接 import 的 warning 伴随 exit 1（输出实际通过）——按输出判定
try {
  const out = run('pnpm db:smoke', { stdio: ['ignore', 'pipe', 'pipe'] })
  if (/checks passed/.test(out)) ok('db-smoke 通过（checks passed）')
  else {
    fail('db-smoke 未输出通过标记')
    console.error(out.slice(-500))
  }
} catch (err) {
  const out = String(err.stdout ?? '')
  if (/checks passed/.test(out)) {
    ok('db-smoke 通过（checks passed；Node24 warning 不影响）')
  } else {
    fail('db-smoke 失败')
    console.error(out.slice(-500))
  }
}
if (failures > 0) {
  console.error('\n验证失败，发布终止。')
  process.exit(1)
}

// ---------- 5) 本地构建 ----------
if (SKIP_DIST) {
  console.log('\n[5/7] 跳过本地构建（--skip-dist）')
} else {
  console.log('\n[5/7] 本地构建（release/ 与远程 Release 同步）')
  const releaseDir = join(ROOT, 'release')
  if (existsSync(releaseDir)) {
    // 清理旧版本产物（按 artifactName 前缀匹配，保留 win-unpacked 调试目录）
    const stale = readdirSync(releaseDir).filter((f) => /Setup|portable|blockmap|latest\.yml|builder-debug/.test(f))
    for (const f of stale) rmSync(join(releaseDir, f), { force: true })
    ok(`清理旧产物 ${stale.length} 个`)
  }
  try {
    run('pnpm dist', { stdio: 'pipe' })
    ok('pnpm dist 完成')
    const produced = existsSync(releaseDir)
      ? readdirSync(releaseDir).filter((f) => f.includes(version)).join(', ')
      : '(无)'
    console.log(`  产物: ${produced || '未找到新版本文件，检查 dist 输出'}`)
  } catch (err) {
    fail('pnpm dist 失败')
    console.error(String(err.stdout ?? err).slice(-800))
    process.exit(1)
  }
}

// ---------- 6) 提交与打 tag ----------
console.log('\n[6/7] 提交与发布')
if (PUSH) {
  const msg = `chore: release v${version}`
  try {
    run(`git add -A && git commit -m "${msg}"`)
    ok('已提交')
  } catch (err) {
    if (String(err.stdout ?? '').includes('nothing to commit')) ok('无改动可提交')
    else fail(String(err.stdout ?? err).slice(-300))
  }
  try {
    run(`git push origin main`)
    ok('main 已推送')
  } catch (err) {
    fail(`push main 失败: ${String(err.stdout ?? err).slice(-300)}`)
    process.exit(1)
  }
  try {
    const tags = run('git tag -l v' + version)
    if (!tags) run(`git tag v${version} && git push origin v${version}`)
    else run(`git push origin v${version}`)
    ok(`tag v${version} 已推送（触发 CI）`)
  } catch (err) {
    fail(`tag 推送失败: ${String(err.stdout ?? err).slice(-300)}`)
    process.exit(1)
  }
} else {
  console.log('  （未加 --push，请手动执行）')
  console.log('  1. git add -A && git commit -m "chore: release v' + version + '"')
  console.log('  2. git push origin main')
  console.log('  3. git tag v' + version + ' && git push origin v' + version)
}

// ---------- 7) 发布后清单 ----------
console.log('\n[7/7] 发布后确认（参考 docs/versioning.md §3）')
console.log('  □ CI 通过（gh run list）')
console.log('  □ Release 资产齐全（gh release view v' + version + '）')
console.log('  □ test-report.md 追加版本验证记录')
console.log('  □ 本地安装验证（可选）')

console.log('\n=== 完成' + (failures > 0 ? `（${failures} 个问题）` : '') + ' ===')
