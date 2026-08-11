// P28：kimi-k3 生成 8 稿图标（SVG，透明背景）——并发 3 + 长超时
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const key = JSON.parse(readFileSync(join(homedir(), '.local', 'share', 'opencode', 'auth.json'), 'utf8'))['opencode-go'].key
const base = 'https://opencode.ai/zen/go/v1'
const DIR = 'D:/OpenCode/projects/ai-novel-studio/resources/icon-sources/k3'

const SPEC =
  'Design an application icon as standalone SVG code. Requirements: viewBox="0 0 1024 1024"; ONLY the icon glyph on a TRANSPARENT background (no rect covering the full canvas, no white box); the glyph is a dark rounded-square badge with a single central symbol; flat modern minimal style; palette deep navy #0e0f13-#1a1f2b with one accent (#4F7CFF blue or gold); small margins; readable at 256px. Output ONLY the raw SVG code starting with <svg and ending with </svg>, no explanations, no markdown fences.'

const DIRECTIONS = [
  'Quill pen nib with negative-space cutout, minimal',
  'Open book with a pen resting on it, pages slightly fanned',
  'Rolled scroll with a calligraphy brush',
  'Ink drop forming a star (creative spark)',
  'Feather quill with a small sparkle accent at top',
  'Typewriter key with the Chinese character 文 (wen)',
  'Fountain pen nib with a small crescent moon accent',
  'Storybook with a glowing star above the open pages'
]

async function genIcon(index, direction) {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), 240000)
  const t0 = Date.now()
  try {
    const r = await fetch(base + '/chat/completions', {
      method: 'POST',
      signal: ac.signal,
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'kimi-k3',
        messages: [{ role: 'user', content: `${SPEC}\n\nDirection: ${direction}` }],
        max_tokens: 8192
      })
    })
    const j = await r.json()
    const content = j.choices?.[0]?.message?.content ?? ''
    const m = content.match(/<svg[\s\S]*?<\/svg>/)
    if (!m) {
      console.log(`[${index + 1}] ✗ 无 SVG（${((Date.now() - t0) / 1000).toFixed(0)}s, len=${content.length}）`)
      return
    }
    const file = join(DIR, `k3-icon-${String(index + 1).padStart(2, '0')}.svg`)
    writeFileSync(file, m[0].trim(), 'utf8')
    console.log(`[${index + 1}] ✓ ${((Date.now() - t0) / 1000).toFixed(0)}s → ${file.split('/').pop()}`)
  } catch (e) {
    console.log(`[${index + 1}] ✗ 失败: ${e.message.slice(0, 60)}`)
  } finally {
    clearTimeout(timer)
  }
}

mkdirSync(DIR, { recursive: true })
// 跳过已存在的稿（断点续跑）
const existing = new Set(
  readdirSync(DIR).filter((f) => f.endsWith('.svg')).map((f) => f.replace(/^k3-icon-(\d+)\..*$/, '$1'))
)
const todo = DIRECTIONS.map((d, i) => ({ d, i })).filter(({ i }) => !existing.has(String(i + 1).padStart(2, '0')))
console.log(`待生成 ${todo.length} 稿（已完成 ${DIRECTIONS.length - todo.length}）`)
// 并发 3
for (let i = 0; i < todo.length; i += 2) {
  await Promise.all(todo.slice(i, i + 2).map(({ d, i: idx }) => genIcon(idx, d)))
}
console.log('\n完成')
