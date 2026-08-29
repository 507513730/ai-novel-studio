// 图标候选素材处理：三张候选图入库 resources/icon-candidates/
// - 两张 3x3 九宫各拆成 9 个（保留下方标签）
// - 全部白底去除 → 透明（从边缘洪水填充纯白 + 抗锯齿羽化）
// - 第 3 张（A-I 变体）B 槽换成使用终稿 logo（第 2 张 AI NOVEL STUDIO）
// 用法: node scripts/icon-candidates.mjs <grid1> <logo> <grid3>
import { copyFileSync, mkdirSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'resources', 'icon-candidates')
const [grid1Path, logoPath, grid3Path] = process.argv.slice(2)
if (!grid1Path || !logoPath || !grid3Path) {
  console.error('用法: node scripts/icon-candidates.mjs <grid1> <logo> <grid3>')
  process.exit(1)
}

// ---------- 基础工具 ----------
async function loadRaw(p) {
  const { data, info } = await sharp(p).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  return { data, w: info.width, h: info.height, ch: info.channels }
}
async function saveRaw(img, path) {
  await sharp(img.data, { raw: { width: img.w, height: img.h, channels: img.ch } }).png().toFile(path)
}
function px(img, x, y) {
  const i = (y * img.w + x) * img.ch
  return [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]]
}
function setPx(img, x, y, r, g, b, a) {
  const i = (y * img.w + x) * img.ch
  img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = a
}

// 距白 (254) 的最大通道差
function distWhite(r, g, b) {
  return Math.max(Math.abs(254 - r), Math.abs(254 - g), Math.abs(254 - b))
}

// 内容掩码（用于布局检测）
function contentMask(img, thr = 14) {
  const m = new Uint8Array(img.w * img.h)
  for (let y = 0; y < img.h; y++) {
    for (let x = 0; x < img.w; x++) {
      const i = (y * img.w + x) * img.ch
      if (distWhite(img.data[i], img.data[i + 1], img.data[i + 2]) > thr) m[y * img.w + x] = 1
    }
  }
  return m
}
function bands(mask, w, h, along) {
  const counts = along === 'col' ? new Array(w).fill(0) : new Array(h).fill(0)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (mask[y * w + x]) counts[along === 'col' ? x : y]++
    }
  }
  const out = []
  let s = -1
  for (let i = 0; i <= counts.length; i++) {
    const v = i < counts.length ? counts[i] : 0
    if (v > 2 && s < 0) s = i
    if (v <= 2 && s >= 0) {
      if (i - s > 8) out.push([s, i - 1])
      s = -1
    }
  }
  return out
}

// 从边缘洪水填充去除白底：alpha=0；fill 为可吸收判定
function floodRemove(img, absorb) {
  const { w, h } = img
  const seen = new Uint8Array(w * h)
  const q = new Int32Array(w * h)
  let qh = 0, qt = 0
  const push = (x, y) => {
    const i = y * w + x
    if (seen[i]) return
    const [r, g, b, a] = px(img, x, y)
    if (a === 0) { seen[i] = 2; return }
    if (!absorb(r, g, b)) return
    seen[i] = 1
    q[qt++] = i
    img.data[i * img.ch + 3] = 0
  }
  for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1) }
  for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y) }
  while (qh < qt) {
    const i = q[qh++]
    const x = i % w, y = (i / w) | 0
    if (x > 0) push(x - 1, y)
    if (x < w - 1) push(x + 1, y)
    if (y > 0) push(x, y - 1)
    if (y < h - 1) push(x, y + 1)
  }
}

// 抗锯齿羽化：与透明区相邻、中性灰（白↔内容过渡）的像素按距白距离给 alpha
function feather(img) {
  const { w, h } = img
  const out = new Uint8Array(img.data) // 复制
  const isTr = (x, y) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return true
    return img.data[(y * w + x) * img.ch + 3] === 0
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * img.ch
      if (out[i + 3] !== 255) continue
      let nearTr = isTr(x - 1, y) || isTr(x + 1, y) || isTr(x, y - 1) || isTr(x, y + 1)
      if (!nearTr) continue
      const r = img.data[i], g = img.data[i + 1], b = img.data[i + 2]
      const spread = Math.max(r, g, b) - Math.min(r, g, b)
      const d = distWhite(r, g, b)
      if (spread <= 9 && d < 60) {
        out[i + 3] = Math.min(255, Math.round((d - 4) * 6.4))
      }
    }
  }
  img.data = Buffer.from(out)
}

// 裁剪
function crop(img, x0, y0, x1, y1) {
  const w = x1 - x0, h = y1 - y0
  const data = Buffer.alloc(w * h * img.ch)
  for (let y = 0; y < h; y++) {
    img.data.copy(data, y * w * img.ch, (y0 + y) * img.w * img.ch + x0 * img.ch, (y0 + y) * img.w * img.ch + x1 * img.ch)
  }
  return { data, w, h, ch: img.ch }
}

function contentBBox(img, bgThr = 10) {
  let x0 = img.w, y0 = img.h, x1 = -1, y1 = -1
  for (let y = 0; y < img.h; y++) {
    for (let x = 0; x < img.w; x++) {
      const i = (y * img.w + x) * img.ch
      if (img.data[i + 3] > 10 && distWhite(img.data[i], img.data[i + 1], img.data[i + 2]) > bgThr) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    }
  }
  return { x0, y0, x1, y1 }
}

// 处理一个图：白底 → 透明
function whiten(img) {
  floodRemove(img, (r, g, b) => distWhite(r, g, b) <= 6)
  feather(img)
  return img
}

// ---------- 布局拆分 ----------
function detectGrid(img) {
  const m = contentMask(img)
  const cb = bands(m, img.w, img.h, 'col')
  const rb = bands(m, img.w, img.h, 'row')
  // 行带应为 6（3 瓦片 + 3 标签），否则报错
  if (cb.length !== 3 || rb.length !== 6) {
    throw new Error(`网格布局异常: cols=${cb.length} rows=${rb.length} (${JSON.stringify({ cb, rb })})`)
  }
  return { cb, tiles: [rb[0], rb[2], rb[4]], caps: [rb[1], rb[3], rb[5]] }
}

const PAD = 8
function cellRect(g, row, col) {
  const t = g.tiles[row], c = g.caps[row], b = g.cb[col]
  return { x0: b[0] - PAD, y0: t[0] - PAD, x1: b[1] + PAD, y1: c[1] + PAD }
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  const srcDir = join(OUT, 'source')
  mkdirSync(srcDir, { recursive: true })

  console.log('加载原图…')
  const grid1 = await loadRaw(grid1Path)
  const logo = await loadRaw(logoPath)
  const grid3 = await loadRaw(grid3Path)

  console.log('解析网格…')
  const g1 = detectGrid(grid1)
  const g3 = detectGrid(grid3)

  // B 槽（第 3 张、中上格）替换为 logo：
  const logoTile = { x0: g3.cb[1][0], y0: g3.tiles[0][0], x1: g3.cb[1][1], y1: g3.tiles[0][1] }
  const logoProc = whiten(logo)
  const lb = contentBBox(logoProc)
  const logoContent = crop(logoProc, lb.x0, lb.y0, lb.x1 + 1, lb.y1 + 1)
  const logoFull = await sharp(logoContent.data, { raw: { width: logoContent.w, height: logoContent.h, channels: 4 } })
    .resize(logoTile.x1 - logoTile.x0, logoTile.y1 - logoTile.y0, { fit: 'fill' })
    .raw().toBuffer({ resolveWithObject: true })
  const logoFit = { data: Buffer.from(logoFull.data), w: logoFull.info.width, h: logoFull.info.height, ch: 4 }

  function replaceB(img, g) {
    // 复制原始 cell，将瓦片区清空（alpha 0），再贴 logo，保留标签
    const r = cellRect(g, 0, 1)
    const cell = crop(img, r.x0, r.y0, r.x1, r.y1)
    for (let y = 0; y < cell.h; y++) {
      for (let x = 0; x < cell.w; x++) {
        const gy = r.y0 + y, gx = r.x0 + x
        if (gx >= logoTile.x0 && gx <= logoTile.x1 && gy >= logoTile.y0 && gy <= logoTile.y1) {
          setPx(cell, x, y, 0, 0, 0, 0)
        }
      }
    }
    // 贴 logo（居中覆盖瓦片区）
    for (let y = 0; y < cell.h; y++) {
      for (let x = 0; x < cell.w; x++) {
        const gy = r.y0 + y, gx = r.x0 + x
        if (gx < logoTile.x0 || gx > logoTile.x1 || gy < logoTile.y0 || gy > logoTile.y1) continue
        const sx = Math.round(((gx - logoTile.x0) / (logoTile.x1 - logoTile.x0)) * (logoFit.w - 1))
        const sy = Math.round(((gy - logoTile.y0) / (logoTile.y1 - logoTile.y0)) * (logoFit.h - 1))
        const si = (sy * logoFit.w + sx) * 4
        const ea = logoFit.data[si + 3]
        if (ea === 0) continue
        const di = (y * cell.w + x) * 4
        const a = ea / 255
        cell.data[di] = Math.round(logoFit.data[si] * a + cell.data[di] * (1 - a))
        cell.data[di + 1] = Math.round(logoFit.data[si + 1] * a + cell.data[di + 1] * (1 - a))
        cell.data[di + 2] = Math.round(logoFit.data[si + 2] * a + cell.data[di + 2] * (1 - a))
        cell.data[di + 3] = Math.max(cell.data[di + 3], ea)
      }
    }
    whiten(cell)
    return cell
  }

  console.log('拆分第 1 张（1-9 概念）…')
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      const n = r * 3 + c + 1
      const rect = cellRect(g1, r, c)
      const cell = crop(grid1, rect.x0, rect.y0, rect.x1, rect.y1)
      whiten(cell)
      const file = join(OUT, `concepts-${String(n).padStart(2, '0')}.png`)
      await saveRaw(cell, file)
      console.log(`  ✓ concepts-${String(n).padStart(2, '0')}.png (${cell.w}x${cell.h})`)
    }
  }

  console.log('拆分第 3 张（A-I 变体，B=使用终稿）…')
  const labels = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I']
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      const L = labels[r * 3 + c]
      let cell
      if (L === 'B') {
        cell = replaceB(grid3, g3)
      } else {
        const rect = cellRect(g3, r, c)
        cell = crop(grid3, rect.x0, rect.y0, rect.x1, rect.y1)
        whiten(cell)
      }
      const file = join(OUT, `variants-${L}.png`)
      await saveRaw(cell, file)
      console.log(`  ✓ variants-${L}.png (${cell.w}x${cell.h})`)
    }
  }

  console.log('整图去白（三张全图）…')
  // 第 3 张整图：先替换 B 瓦片再整体去白
  await saveRaw(whiten(grid1), join(OUT, 'sheet-concepts.png'))
  const g3b = { ...grid3, data: Buffer.from(grid3.data) }
  {
    const r = cellRect(g3, 0, 1)
    // 清空 B 瓦片区
    for (let y = r.y0; y < r.y1; y++) {
      for (let x = r.x0; x < r.x1; x++) {
        if (x >= logoTile.x0 && x <= logoTile.x1 && y >= logoTile.y0 && y <= logoTile.y1) setPx(g3b, x, y, 0, 0, 0, 0)
      }
    }
    for (let y = r.y0; y < r.y1; y++) {
      for (let x = r.x0; x < r.x1; x++) {
        if (x < logoTile.x0 || x > logoTile.x1 || y < logoTile.y0 || y > logoTile.y1) continue
        const sx = Math.round(((x - logoTile.x0) / (logoTile.x1 - logoTile.x0)) * (logoFit.w - 1))
        const sy = Math.round(((y - logoTile.y0) / (logoTile.y1 - logoTile.y0)) * (logoFit.h - 1))
        const si = (sy * logoFit.w + sx) * 4
        const ea = logoFit.data[si + 3]
        if (ea === 0) continue
        const di = (y * g3b.w + x) * 4
        const a = ea / 255
        g3b.data[di] = Math.round(logoFit.data[si] * a + g3b.data[di] * (1 - a))
        g3b.data[di + 1] = Math.round(logoFit.data[si + 1] * a + g3b.data[di + 1] * (1 - a))
        g3b.data[di + 2] = Math.round(logoFit.data[si + 2] * a + g3b.data[di + 2] * (1 - a))
        g3b.data[di + 3] = Math.max(g3b.data[di + 3], ea)
      }
    }
  }
  await saveRaw(whiten(g3b), join(OUT, 'sheet-variants.png'))

  console.log('处理 logo（第 2 张）…')
  const logoOut = whiten({ data: Buffer.from(logoProc.data), w: logoProc.w, h: logoProc.h, ch: logoProc.ch })
  const lb2 = contentBBox(logoOut)
  const logoCropped = crop(logoOut, Math.max(0, lb2.x0 - 20), Math.max(0, lb2.y0 - 20), Math.min(logoOut.w, lb2.x1 + 21), Math.min(logoOut.h, lb2.y1 + 21))
  await saveRaw(logoCropped, join(OUT, 'logo-ai-novel-studio.png'))
  console.log(`  ✓ logo-ai-novel-studio.png (${logoCropped.w}x${logoCropped.h})`)

  console.log('归档原始素材…')
  copyFileSync(grid1Path, join(srcDir, 'sheet-grid1-concepts.png'))
  copyFileSync(logoPath, join(srcDir, 'logo-ai-novel-studio.png'))
  copyFileSync(grid3Path, join(srcDir, 'sheet-grid3-variants.png'))

  console.log('\n完成 →', OUT)
}

main().catch((e) => { console.error(e); process.exit(1) })
