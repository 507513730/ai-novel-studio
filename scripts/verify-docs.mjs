// v0.13.0（批E/文档补救）：版本台账一致性检查——发布前验证 package.json 版本号
// 在各文档中均存在（防"replace 静默失败导致版本台账失真"——D87 教训）
// 用法：node scripts/verify-docs.mjs
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertActiveGuide, assertVersionDocs } from './release-contracts.mjs'

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

try {
  assertVersionDocs(changelog, versioning, version)
  check('候选版本/Unreleased 标题及台账唯一且顺序正确', true)
} catch (error) { check('候选版本文档结构', false, error.message) }
for (const file of ['docs/versioning.md', 'docs/AI-AGENT-ONBOARDING.md', 'docs/operations/release-checklist.md', 'docs/operations/packaging.md', 'docs/development/local-development.md']) {
  try { assertActiveGuide(readFileSync(join(ROOT, file), 'utf8')); check(file + ' 操作指引安全', true) }
  catch (error) { check(file + ' 操作指引安全', false, error.message) }
}

// 3) PLAN.md 含对应版本记录
const plan = readFileSync(join(ROOT, 'PLAN.md'), 'utf8')
check('PLAN.md 含 v' + version, plan.includes(`v${version}`), `缺 "v${version}" 记录`)

// 4) CHANGELOG 顶部 Unreleased 段存在（KaC 规范）
check('CHANGELOG.md 有 [Unreleased] 段', changelog.includes('## [Unreleased]'))

// ---------- v0.21.0：onboarding 一致性检查组（AI Agent 协作者手册保鲜机制） ----------
const ONBOARDING = 'docs/AI-AGENT-ONBOARDING.md'
const onboardingPath = join(ROOT, ONBOARDING)
if (existsSync(onboardingPath)) {
  const ob = readFileSync(onboardingPath, 'utf8')

  // 5) onboarding 存在性（上层 if 已保证；此处显式断言）
  check('AI-AGENT-ONBOARDING.md 存在', true)

  // 6) 内部引用完整性：文中所有 docs/*.md 引用路径存在
  const refs = [...ob.matchAll(/docs\/[A-Za-z0-9_.-]+\.md/g)].map((m) => m[0])
  const missingRefs = [...new Set(refs)].filter((r) => !existsSync(join(ROOT, r)))
  check('onboarding 内部引用路径存在', missingRefs.length === 0, `缺失: ${missingRefs.join(', ')}`)

  // 7) 命令真实性：文中所有 `pnpm <cmd>` 均存在于 package.json scripts（pnpm 内置命令除外）
  const PNPM_BUILTIN = new Set(['install', 'add', 'remove', 'run', 'exec', 'dlx', 'store', 'link', 'rebuild', 'patch', 'why', 'list', 'outdated', 'update'])
  const cmds = [...ob.matchAll(/`pnpm ([a-z0-9:-]+)`/g)].map((m) => m[1])
  const unknownCmds = [...new Set(cmds)].filter((c) => !pkg.scripts[c] && !PNPM_BUILTIN.has(c))
  check('onboarding 命令均真实', unknownCmds.length === 0, `未知命令: ${unknownCmds.join(', ')}`)

  // 8) 版本锚点：`当前版本：vX.Y.Z`（容忍加粗/反引号）== package.json version
  const versionAnchor = ob.match(/当前版本.*?：`?v(\d+\.\d+\.\d+)/)
  check(
    'onboarding 当前版本锚点一致',
    versionAnchor !== null && versionAnchor[1] === version,
    versionAnchor ? `文档 v${versionAnchor[1]} ≠ package.json v${version}` : '缺「当前版本：vX.Y.Z」锚点'
  )

  // 9) AGENTS.md 含 onboarding 指引行
  const agents = readFileSync(join(ROOT, 'AGENTS.md'), 'utf8')
  check('AGENTS.md 含 onboarding 指引', agents.includes('AI-AGENT-ONBOARDING'))
} else {
  check('AI-AGENT-ONBOARDING.md 存在', false, '缺失 onboarding 文档（AI 协作者手册）')
}

// ---------- v0.21.0：文档健康检查（防控制字符损坏——D90 教训：PowerShell 写入产生 0x07） ----------
const DOC_FILES = [
  'docs/CHANGELOG.md',
  'PLAN.md',
  'docs/AI-AGENT-ONBOARDING.md',
  'docs/decision-log.md',
  'docs/versioning.md',
  'README.md',
  'AGENTS.md'
]
const damaged = []
for (const f of DOC_FILES) {
  const p = join(ROOT, f)
  if (!existsSync(p)) continue
  const buf = readFileSync(p)
  // ASCII 控制字符（0x00-0x1F，允许 \n \r \t）
  for (let i = 0; i < buf.length; i++) {
    const c = buf[i]
    if (c < 0x20 && c !== 0x0a && c !== 0x0d && c !== 0x09) {
      damaged.push(`${f}@字节${i}（0x${c.toString(16).padStart(2, '0')}）`)
    }
  }
}
check('核心文档无 ASCII 控制字符', damaged.length === 0, damaged.slice(0, 5).join(', ') + (damaged.length > 5 ? ` 等 ${damaged.length} 处` : ''))

if (failures.length > 0) {
  console.error(`\n文档检查失败 ${failures.length} 项：${failures.join('、')}——发布前必须补齐`)
  process.exit(1)
}
console.log(`\n✓ 文档台账一致（v${version}）`)
