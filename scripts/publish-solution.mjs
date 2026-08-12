// v0.11.0（批C）：方案市场发布辅助脚本
// 用法：node scripts/publish-solution.mjs
//   扫描 solutions/*/solution-pack.json → 校验 → 生成 solutions/index.json（市场索引）
//   提交 solutions/ 目录即发布（GitHub 仓库即市场）
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SOLUTIONS_DIR = join(ROOT, 'solutions')

if (!existsSync(SOLUTIONS_DIR)) {
  console.error('solutions/ 目录不存在——先创建 solutions/<id>/solution-pack.json')
  process.exit(1)
}

const dirs = readdirSync(SOLUTIONS_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort()

const index = []
let ok = 0
for (const dir of dirs) {
  const packPath = join(SOLUTIONS_DIR, dir, 'solution-pack.json')
  if (!existsSync(packPath)) {
    console.warn(`  ⚠ ${dir}/ 缺少 solution-pack.json，跳过`)
    continue
  }
  const raw = readFileSync(packPath, 'utf8')
  let pack
  try {
    pack = JSON.parse(raw)
  } catch {
    console.warn(`  ⚠ ${dir}/solution-pack.json 不是合法 JSON，跳过`)
    continue
  }
  // 校验（D83：name+version 唯一标识、小写 kebab-case id）
  if (pack.kind !== 'solution-pack' || !pack.id || !pack.name || !pack.version) {
    console.warn(`  ⚠ ${dir}/solution-pack.json 缺 kind/id/name/version，跳过`)
    continue
  }
  if (!/^[a-z0-9-]+$/.test(pack.id)) {
    console.warn(`  ⚠ ${dir}/solution-pack.json 的 id 必须是小写 kebab-case（${pack.id}），跳过`)
    continue
  }
  index.push({
    id: pack.id,
    name: pack.name,
    description: pack.description ?? '',
    version: pack.version,
    tags: pack.tags ?? [],
    file: `${dir}/solution-pack.json`,
    updatedAt: pack.exportedAt ?? null,
    metrics: pack.metrics ?? null,
    hasSample: Boolean(pack.sampleBook),
    hasWholeBook: pack.metrics?.wholeBook === true
  })
  ok += 1
}

writeFileSync(join(SOLUTIONS_DIR, 'index.json'), JSON.stringify(index, null, 2) + '\n', 'utf8')
console.log(`✓ 已发布 ${ok} 个方案包 → solutions/index.json`)
for (const it of index) {
  console.log(`  - ${it.name} v${it.version}（${it.hasWholeBook ? '整本' : '普通'}${it.hasSample ? '·含样例' : ''}）`)
}
