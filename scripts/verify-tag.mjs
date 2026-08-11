// 版本一致性校验（CI 用）：tag vX.Y.Z 必须与 package.json version 一致
// 用法：node scripts/verify-tag.mjs  （读取 GITHUB_REF_NAME）
import { readFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const tag = process.env.GITHUB_REF_NAME ?? ''
if (!tag.startsWith('v')) {
  console.error(`tag must start with 'v', got: '${tag}'`)
  process.exit(1)
}
const tagVersion = tag.slice(1)
if (tagVersion !== pkg.version) {
  console.error(`tag ${tag} != package.json version ${pkg.version}`)
  process.exit(1)
}
console.log(`OK: tag ${tag} matches package.json ${pkg.version}`)
