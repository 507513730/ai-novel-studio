#!/usr/bin/env node
// v0.24.3（文档治理）：docs 健康检查（CI docs-lint + 本地可跑）
// 1) 乱码行拦截：5+ 连续 '?'（0x3F 编码事故残留；反引号代码 span 豁免；docs/archive 历史原文豁免）
// 2) Markdown 相对链接存在性（断链拦截；外链/锚点跳过；docs/archive 冻结物豁免）
// 用法：node scripts/check-docs.mjs（从仓库根运行；git 不可用时退出 1 提示）
import { readFileSync, existsSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { join, dirname } from 'node:path'

const ROOT = process.cwd()

let files = []
try {
  files = execSync('git ls-files "*.md"', { encoding: 'utf8', cwd: ROOT })
    .split('\n')
    .filter(Boolean)
} catch {
  console.error('✗ 无法执行 git ls-files（请从仓库根运行）')
  process.exit(1)
}

let problems = 0
const fail = (msg) => {
  problems++
  console.error('✗ ' + msg)
}

for (const f of files) {
  // docs/archive = 历史冻结物（含有意保留的损坏标注原文），跳过全部检查
  if (f.startsWith('docs/archive/')) continue
  let text
  try {
    text = readFileSync(join(ROOT, f), 'utf8')
  } catch {
    fail(`无法读取 ${f}`)
    continue
  }

  // 1) 乱码：剔除反引号代码 span 后找 5+ 连续 ?
  const stripped = text.replace(/`[^`]*`/g, '')
  if (/\?{5,}/.test(stripped)) {
    const line = stripped.split('\n').findIndex((l) => /\?{5,}/.test(l)) + 1
    fail(`乱码嫌疑（5+ 连续 ?，第 ${line} 行附近）: ${f}——请重建或删除损坏段`)
  }

  // 2) 相对链接存在性（跳过 fenced code blocks——计划类文档常在代码块里给 markdown 示例）
  const noFence = text.replace(/```[\s\S]*?```/g, '')
  const lines = noFence.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const re = /\[[^\]]*\]\(([^)\s]+)\)/g
    let m
    while ((m = re.exec(lines[i])) !== null) {
      const target = m[1]
      if (/^(https?:|mailto:|tel:|#)/.test(target)) continue
      const anchorIdx = target.indexOf('#')
      const pathOnly = anchorIdx >= 0 ? target.slice(0, anchorIdx) : target
      if (!pathOnly) continue
      const baseDir = dirname(join(ROOT, f))
      // 候选解析：相对文档目录 / 仓库根 / docs/ 目录（docs 内文档常见“docs/xxx”互指）
      const candidates = [
        join(baseDir, pathOnly),
        join(ROOT, pathOnly),
        pathOnly.startsWith('docs/') ? join(ROOT, pathOnly) : null
      ].filter(Boolean)
      if (!candidates.some((c) => existsSync(c))) {
        fail(`断链: ${f}:${i + 1} → ${target}`)
      }
    }
  }
}

if (problems > 0) {
  console.error(`\n文档检查未通过（${problems} 处）`)
  process.exit(1)
}
console.log('✓ docs 健康检查通过（乱码 0 / 断链 0）')
