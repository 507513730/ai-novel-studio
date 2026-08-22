// 发布入口（唯一）：校验文档 → 全量验证 → 本地构建 → 提交/打 tag 指引
// 用法：
//   node scripts/release.mjs          # 校验 + 验证 + 本地构建 + 输出下一步
//   node scripts/release.mjs --push   # 额外执行 git commit + tag + push（需先文档就绪）
//   node scripts/release.mjs --skip-dist  # 跳过本地构建（仅校验+验证，用于纯文档发布）
//   node scripts/release.mjs --e2e    # 额外跑真机全功能 e2e（round.mjs R1，需真实 API key，消耗少量额度）
//   node scripts/release.mjs --bump=patch|minor|major  # 自动 bump 版本 + 生成 CHANGELOG 草稿（P26）
import { execSync } from 'node:child_process'
import { readFileSync, existsSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const args = process.argv.slice(2)
const PUSH = args.includes('--push')
const SKIP_DIST = args.includes('--skip-dist')
const E2E = args.includes('--e2e')
const BUMP = args.find((a) => a.startsWith('--bump='))?.split('=')[1] ?? null

let failures = 0
const fail = (msg) => {
  failures++
  console.error(`  ✗ ${msg}`)
}
const ok = (msg) => console.log(`  ✓ ${msg}`)
const run = (cmd, opts = {}) =>
  execSync(cmd, { stdio: 'pipe', encoding: 'utf8', cwd: ROOT, ...opts }).trim()

console.log('=== AI-Novel-Studio 发布流程 ===\n')

// ---------- 0) --bump：自动 bump 版本 + 生成 CHANGELOG 草稿（P26） ----------
if (BUMP) {
  console.log('[0/7] 自动 bump 版本（--bump=' + BUMP + '）')
  if (!['patch', 'minor', 'major'].includes(BUMP)) {
    console.error(`--bump 参数非法: ${BUMP}（patch|minor|major）`)
    process.exit(1)
  }
  const pkgPath = join(ROOT, 'package.json')
  const pkgNow = JSON.parse(readFileSync(pkgPath, 'utf8'))
  const [maj, min, pat] = pkgNow.version.split('.').map(Number)
  const next =
    BUMP === 'major' ? `${maj + 1}.0.0` : BUMP === 'minor' ? `${maj}.${min + 1}.0` : `${maj}.${min}.${pat + 1}`
  pkgNow.version = next
  writeFileSync(pkgPath, JSON.stringify(pkgNow, null, 2) + '\n')
  ok(`版本 ${pkgNow.version} → ${next}`)
  // CHANGELOG 草稿段落（git log 上次 tag 起）
  try {
    const lastTag = execSync('git describe --tags --abbrev=0', { encoding: 'utf8', cwd: ROOT }).trim()
    const log = execSync(`git log --oneline ${lastTag}..HEAD`, { encoding: 'utf8', cwd: ROOT })
      .split('\n')
      .filter(Boolean)
      .slice(0, 20)
      .join('\n')
    const rnPath = join(ROOT, 'docs', 'CHANGELOG.md')
    const rn = readFileSync(rnPath, 'utf8')
    const draft = `# AI-Novel-Studio 发布说明

## v${next}（${new Date().toISOString().slice(0, 10)}）

### 安装方式
- **安装版**：\`AI-Novel-Studio Setup ${next}.exe\`（NSIS 向导版）
- **便携版**：\`AI-Novel-Studio-${next}-portable-x64.exe\`

### 变更（草稿，请润色）

${log.split('\n').map((l) => '- ' + l.trim()).join('\n')}

## v${pkgNow.version}`
    // 在旧版本标题前插入完整草稿段
    const anchor = `## v${pkgNow.version}`
    const anchorIdx = rn.indexOf(anchor)
    const headerEnd = rn.indexOf('\n', rn.indexOf('# AI-Novel-Studio')) + 1
    if (anchorIdx > 0) {
      writeFileSync(rnPath, draft + '\n' + rn.slice(anchorIdx), 'utf8')
    } else {
      writeFileSync(rnPath, draft + '\n' + rn.slice(headerEnd), 'utf8')
    }
    console.log('  CHANGELOG 草稿已生成（请润色后发布）')
  } catch (err) {
    console.log('  ⚠ 无法生成草稿（无历史 tag？）:', err instanceof Error ? err.message : String(err))
  }
}

// ---------- 1) 工作区必须干净 ----------
console.log('[1/7] 工作区检查')
try {
  const status = run('git status --porcelain')
  if (status) {
    fail('工作区有未提交改动，先提交：\n' + status)
    process.exit(1)
  }
  ok('git 工作区干净')
  // v0.22.0（完成即推送纪律 #60b）：检查未推送提交（提示但不阻断——发布会自动带上）
  try {
    const ahead = Number(run('git rev-list --count origin/main..main').trim() || 0)
    if (ahead > 0) {
      console.log(`  ⚠ 本地领先远程 ${ahead} 个提交——完成即推送纪律（AGENTS #60b）要求门禁通过即 push；本发布将一并带上，建议日常即时推送`)
    }
  } catch {
    /* 无远程/离线时忽略 */
  }
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
// v0.13.0（批E/文档补救）：verify-docs 全量一致性检查（CHANGELOG/versioning/PLAN + Unreleased 段）
try {
  run('node scripts/verify-docs.mjs', { stdio: ['ignore', 'pipe', 'pipe'] })
  ok('文档台账一致性（verify-docs：CHANGELOG/versioning/PLAN）')
} catch (err) {
  fail('verify-docs 文档一致性检查失败')
  console.error(String(err.stdout ?? '').slice(-600))
  process.exit(1)
}
const rn = readFileSync(join(ROOT, 'docs', 'CHANGELOG.md'), 'utf8')
if (rn.includes(`## v${version}`)) {
  ok(`CHANGELOG.md 含 v${version} 段落`)
} else {
  fail(`CHANGELOG.md 缺少 "## v${version}" 段落（先补发布说明再发布）`)
}
const plan = readFileSync(join(ROOT, 'PLAN.md'), 'utf8')
if (plan.includes(`v${version}`)) {
  ok('PLAN.md 含对应版本记录')
} else {
  fail(`PLAN.md 未找到 v${version} 记录（补 PLAN 段落再发布）`)
}
const dl = readFileSync(join(ROOT, 'docs', 'decision-log.md'), 'utf8')
if (dl.length > 20000 && dl.trim().endsWith('```') || dl.includes('D60')) {
  ok('decision-log.md 有近期决策记录')
} else {
  console.log('  ⚠ decision-log.md 未见近期决策（建议补充）')
}
if (failures > 0) {
  console.error('\n文档未就绪，发布终止。补完文档后重跑。')
  process.exit(1)
}

// ---------- 4) 全量验证 ----------
console.log('\n[4/7] 全量验证')
// P26：依赖安全（高危漏洞阻断发布）
try {
  const auditOut = run('pnpm audit --prod --audit-level=high', { stdio: ['ignore', 'pipe', 'pipe'] })
  ok('pnpm audit 通过（无高危漏洞）')
  void auditOut
} catch (err) {
  const out = String(err.stdout ?? '').slice(-600)
  if (/0 vulnerabilities/.test(out)) {
    ok('pnpm audit 通过（0 vulnerabilities）')
  } else {
    fail('pnpm audit：存在高危漏洞（见输出）')
    console.error(out)
  }
}
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
    // v0.12.0：vitest 在 release 顺序执行环境偶发资源竞争失败（单独跑必过，已遇 3 次）——
    // 失败重试一次，仍失败才终止发布
    if (name === 'test') {
      console.log(`  ⚠ ${name} 首次失败，重试一次…`)
      try {
        run(cmd, { stdio: ['ignore', 'pipe', 'pipe'] })
        ok(`${name} 通过（重试后）`)
        continue
      } catch (err2) {
        fail(`${name} 失败（重试后仍失败）`)
        console.error(String(err2.stdout ?? '').slice(-800))
        process.exit(1)
      }
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
  // v0.21.0（防假 PASS）：db-smoke 的 check 失败仅置 exitCode=1 不中断，结尾仍打印
  // "[db-smoke] N checks passed"（N=成功数）——此前仅匹配 stdout 字样 → 部分失败被误判通过
  // （历史实例：schema 版本断言过期时发布一路"通过"）。修复：必须退出码 0 且含通过标记。
  const exitOk = err.status === 0
  if (exitOk && /checks passed/.test(out)) {
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

// ---------- 4.5) 可选：真机 e2e（--e2e，P26） ----------
if (E2E) {
  console.log('\n[4.5/7] 真机 e2e（round.mjs R1，消耗真实额度）')
  const userData = join(ROOT, 'release', '.e2e-data')
  const serverEnv = {
    ...process.env,
    AI_NOVEL_USER_DATA: userData,
    AI_NOVEL_PORT: '3000'
  }
  const { spawn } = await import('node:child_process')
  const server = spawn(process.execPath, [join(ROOT, 'out', 'main', 'server.js')], {
    env: serverEnv,
    stdio: 'ignore'
  })
  try {
    // 等 server ready（最多 15s）
    let ready = false
    for (let i = 0; i < 30; i++) {
      try {
        const r = await fetch('http://127.0.0.1:3000/api/health')
        if (r.ok) {
          ready = true
          break
        }
      } catch {
        /* 未就绪 */
      }
      await new Promise((r2) => setTimeout(r2, 500))
    }
    if (!ready) throw new Error('server 未在 15s 内就绪')
    run('node scripts/e2e/round.mjs 1', { stdio: 'pipe', timeout: 40 * 60 * 1000 })
    ok('e2e R1 通过（含 T1 配置 / T2 创作链）')
    // v0.9.2（O3）：配置了 FF_DIR 时追加跑方案生产真机验收（mc-good2.0 导入 → 10 步流水线 → 章节产出）
    // p30 脚本自起独立 server（3000 端口 + 独立临时库），先释放本段 server 防端口冲突
    server.kill()
    await new Promise((r) => setTimeout(r, 1500))
    if (process.env.FF_DIR) {
      try {
        run('node scripts/p30-mcgood2-e2e.mjs', {
          stdio: 'pipe',
          timeout: 30 * 60 * 1000,
          env: { ...process.env, FF_DIR: process.env.FF_DIR, AI_NOVEL_PORT: '3000' }
        })
        ok('p30-mcgood2 方案生产真机验收通过（FF_DIR）')
      } catch (err) {
        const out = String(err.stdout ?? '').slice(-800)
        fail('p30-mcgood2 真机验收失败（FF_DIR 配置下必过）')
        console.error(out)
        process.exit(1)
      }
    } else {
      console.log('  ⏭ p30-mcgood2 真机段跳过（未配置 FF_DIR）')
    }
  } catch (err) {
    const out = String(err.stdout ?? '').slice(-1200)
    fail('e2e 失败（见输出）')
    console.error(out)
    process.exit(1)
  } finally {
    server.kill()
    // P26 强化：Windows 下文件句柄释放有延迟——等待后重试清理（防 .e2e-data 残留）
    await new Promise((r) => setTimeout(r, 2000))
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        rmSync(userData, { recursive: true, force: true })
        break
      } catch {
        if (attempt < 2) await new Promise((r) => setTimeout(r, 500))
      }
    }
  }
}

// ---------- 5) 本地构建 ----------
if (SKIP_DIST) {
  console.log('\n[5/7] 跳过本地构建（--skip-dist）')
} else {
  console.log('\n[5/7] 本地构建（release/ 与远程 Release 同步）')
  const releaseDir = join(ROOT, 'release')
  if (existsSync(releaseDir)) {
    // 清理旧版本产物（按 artifactName 前缀匹配，保留 win-unpacked 调试目录）
    // v0.10.0：被占用（如用户正在运行旧版 portable）时跳过并警告——发布不中断
    const stale = readdirSync(releaseDir).filter((f) => /Setup|portable|blockmap|latest\.yml|builder-debug/.test(f))
    let cleaned = 0
    const skipped = []
    for (const f of stale) {
      try {
        rmSync(join(releaseDir, f), { force: true })
        cleaned += 1
      } catch {
        skipped.push(f)
      }
    }
    ok(`清理旧产物 ${cleaned}/${stale.length} 个`)
    if (skipped.length > 0) {
      console.warn(`  ⚠ ${skipped.length} 个文件被占用跳过（可能是正在运行的旧版应用）: ${skipped.join(', ')}`)
    }
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
  // v0.22.0：手操指引 PS 5.1 兼容（PowerShell 5.1 不支持 &&——用 ; 分隔；PS 7+ 两者皆可）
  console.log('  1. git add -A; git commit -m "chore: release v' + version + '"')
  console.log('  2. git push origin main')
  console.log('  3. git tag v' + version + '; git push origin v' + version)
}

// ---------- 7) 发布后确认（P26：--push 后自动验证 CI + Release） ----------
console.log('\n[7/7] 发布后确认（参考 docs/versioning.md §3）')
if (PUSH) {
  console.log('  等待 CI 构建（最多 10 分钟）…')
  try {
    const out = execSync(
      `gh run list --workflow="Build Release" --limit 1 --json databaseId --jq ".[0].databaseId"`,
      { encoding: 'utf8', cwd: ROOT, shell: 'cmd' }
    ).trim()
    if (out) {
      try {
        execSync(`gh run watch ${out} --exit-status --interval 10`, {
          stdio: ['ignore', 'pipe', 'pipe'],
          encoding: 'utf8',
          cwd: ROOT,
          timeout: 10 * 60 * 1000
        })
        ok(`CI 通过（run ${out}）`)
      } catch {
        console.error(`  ✗ CI 失败（run ${out}）——见 docs/versioning.md §8 回滚决策树`)
        process.exit(1)
      }
    }
  } catch {
    console.log('  ⚠ 无法自动查询 CI（gh 未登录或网络问题），请手动 gh run list 确认')
  }
  try {
    const rel = execSync(
      `gh release view v${version} --json publishedAt,assets --jq "{publishedAt, assets: [.assets[].name]}"`,
      { encoding: 'utf8', cwd: ROOT, shell: 'cmd' }
    ).trim()
    ok(`Release v${version} 已发布：${rel}`)
  } catch {
    console.error(`  ✗ Release v${version} 未找到——见 versioning.md §8 回滚/排查`)
  }
  // 仓库整理（2026-08-12）：Release body 自动写入 CHANGELOG 当前版本段落（v0.14.1 起生效，历史不回溯）
  try {
    const changelog = readFileSync(join(ROOT, 'docs', 'CHANGELOG.md'), 'utf8')
    const start = changelog.indexOf(`## v${version}`)
    if (start === -1) throw new Error('CHANGELOG 无当前版本段落')
    const end = changelog.indexOf('\n## ', start + 1)
    const section = (end === -1 ? changelog.slice(start) : changelog.slice(start, end)).trim()
    const notesFile = join(ROOT, 'release', `.release-notes-${version}.md`)
    writeFileSync(notesFile, section, 'utf8')
    execSync(`gh release edit v${version} --notes-file "${notesFile}"`, {
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
      cwd: ROOT,
      shell: 'cmd'
    })
    rmSync(notesFile, { force: true })
    console.log(`  ✓ Release body 已写入 CHANGELOG 段落（v${version}）`)
  } catch (e) {
    console.log(`  ⚠ Release body 更新失败（不影响发布结果）: ${String(e).slice(0, 150)}`)
  }
  // v0.14.0：发布成功 → versioning §7 当前版本行 🔄→✅（防下一版 docs replace 静默失败——D89 教训）
  try {
    const vp = join(ROOT, 'docs', 'versioning.md')
    let vc = readFileSync(vp, 'utf8')
    const lines = vc.split('\n')
    const idx = lines.findIndex((l) => l.startsWith(`| ${version} |`))
    // v0.23.1（批次 C3）：状态列任意非 ✅ 终态均翻转（此前只匹配 🔄 发布中——
    // 规划中（待发布）行永远翻不动，v0.23.0 台账滞留即此盲区）
    if (idx !== -1 && !lines[idx].includes('✅ 已发布')) {
      const cells = lines[idx].split('|')
      cells[cells.length - 2] = ' ✅ 已发布 '
      lines[idx] = cells.join('|')
      writeFileSync(vp, lines.join('\n'), 'utf8')
      console.log('  ✓ versioning §7 已标记 ✅ 已发布')
    }
  } catch (e) {
    console.log('  ⚠ versioning 状态更新失败（不影响发布结果）:', String(e))
  }
  // v0.9.2（O1）：发布后自动跑打包态等价验收——SSE 生成/导出/鉴权 403 全链路
  // 防"打包态坏了发布照样出"（Node24 SSE 回归教训）
  try {
    console.log('  运行打包态等价验收（模拟 file:// Origin:null + token）…')
    const out = execSync(`node scripts/v072-pack-verify.mjs`, {
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
      cwd: ROOT,
      timeout: 10 * 60 * 1000,
      env: {
        ...process.env,
        BASE: 'http://127.0.0.1:39999/api',
        TOKEN: 'release-verify-token',
        UDATA: join(ROOT, 'release', '.verify-tmp'),
        // v0.17.0（M2 配套）：验收跑独立 server（非 utilityProcess）——显式允许明文密钥（调试场景开关）
        AI_NOVEL_ALLOW_PLAINTEXT: '1'
      }
    })
    if (/PASS/.test(out)) ok('打包态等价验收 PASS（SSE/导出/鉴权）')
    else {
      fail('打包态等价验收未通过')
      console.error(out.slice(-600))
    }
  } catch (err) {
    const out = String(err.stdout ?? '')
    if (/PASS/.test(out)) ok('打包态等价验收 PASS（SSE/导出/鉴权）')
    else {
      fail('打包态等价验收失败（v072-pack-verify）——见 versioning.md §8 排查')
      console.error(out.slice(-600))
    }
  }
} else {
  console.log('  □ CI 通过（gh run list）')
  console.log('  □ Release 资产齐全（gh release view v' + version + '）')
}
console.log('  □ 发布级测试报告汇总（release/e2e-report.md 详情轮次——需要时 E2E_REPORT=docs/test-report.md 重跑收集）')
console.log('  □ 本地安装验证（可选）')
console.log('  □ 发现问题？→ docs/versioning.md §8 回滚决策树')

console.log('\n=== 完成' + (failures > 0 ? `（${failures} 个问题）` : '') + ' ===')
