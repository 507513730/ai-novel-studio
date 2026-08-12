// v0.13.0（批E/文档补救）：版本台账一致性检查——发布前验证 package.json 版本号
// 在各文档中均存在（防"replace 静默失败导致版本台账失真"——D87 教训）
// 用法：node scripts/verify-docs.mjs
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
const version = pkg.version
const failures = []

function check(label, ok, detail) {
  if (ok) console.log(`✓ ${label}`)
  else {
    console.error(`✗ ${label}${detail ? `：${detail}` : ''}`)
    failures.push(label)
  }
}

// 1) CHANGELOG 含 ## vX.Y.Z
const changelog = readFileSync(join(ROOT, 'docs', 'CHANGELOG.md'), 'utf8')
check('CHANGELOG.md 含 ## v' + version, changelog.includes(`## v${version}`), `缺 "## v${version}" 段落`)

// 2) versioning §7 含版本行（状态列任意）
const versioning = readFileSync(join(ROOT, 'docs', 'versioning.md'), 'utf8')
const versionRow = versioning.split('\n').find((l) => l.startsWith(`| ${version} |`))
check('versioning.md §7 含版本行', versionRow !== undefined, `缺 "| ${version} |" 行`)

// 3) PLAN.md 含对应版本记录
const plan = readFileSync(join(ROOT, 'PLAN.md'), 'utf8')
check('PLAN.md 含 v' + version, plan.includes(`v${version}`), `缺 "v${version}" 记录`)

// 4) CHANGELOG 顶部 Unreleased 段存在（KaC 规范）
check('CHANGELOG.md 有 [Unreleased] 段', changelog.includes('## [Unreleased]'))

if (failures.length > 0) {
  console.error(`\n文档检查失败 ${failures.length} 项：${failures.join('、')}——发布前必须补齐`)
  process.exit(1)
}
console.log(`\n✓ 文档台账一致（v${version}）`)
