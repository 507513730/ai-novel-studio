import { Router } from 'express'
import type { DatabaseSync } from 'node:sqlite'
import { z } from 'zod'

export function createExportRouter(db: DatabaseSync): Router {
  const router = Router()

  router.get('/:novelId/export', async (req, res, next) => {
    try {
      const novelId = Number(req.params.novelId)
      const format = z.enum(['txt', 'md', 'epub']).parse(req.query.format ?? 'txt')
      const novel = db.prepare('SELECT title, inspiration, framing_json FROM novel WHERE id = ?').get(novelId) as
        | { title: string; inspiration: string; framing_json: string }
        | undefined
      if (!novel) {
        res.status(404).json({ error: 'novel not found' })
        return
      }
      const chapters = db
        .prepare(
          `SELECT title, content FROM chapter
           WHERE novel_id = ? AND content != '' AND status IN ('written', 'reviewed', 'done')
           ORDER BY id`
        )
        .all(novelId) as Array<{ title: string; content: string }>

      const title = novel.title || '未命名小说'
      // P20（E4）：文件名消毒补全（控制字符/结尾点空格/Windows 保留名）
      const safeName =
        title
          .split('')
          .map((ch) => (ch.charCodeAt(0) < 32 ? '_' : ch))
          .join('')
          .replace(/[\\/:*?"<>|]/g, '_')
          .replace(/[. ]+$/g, '')
          .replace(/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i, '_$1') || '未命名小说'

      if (format === 'txt') {
        const parts = [title, '']
        for (const c of chapters) {
          parts.push(c.title)
          parts.push('')
          parts.push(c.content)
          parts.push('')
        }
        // P20（E3）：TXT 加 UTF-8 BOM（旧版 Windows 记事本按 GBK 误读中文乱码）
        const buf = Buffer.concat([Buffer.from('\uFEFF', 'utf-8'), Buffer.from(parts.join('\n'), 'utf-8')])
        res.setHeader('Content-Type', 'text/plain; charset=utf-8')
        res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(safeName)}.txt`)
        res.send(buf)
        return
      }

      if (format === 'md') {
        const parts = [`# ${title}`, '', novel.inspiration ? `> 灵感：${novel.inspiration}` : '', '']
        for (const c of chapters) {
          parts.push(`## ${c.title}`, '', c.content, '')
        }
        const buf = Buffer.from(parts.join('\n'), 'utf-8')
        res.setHeader('Content-Type', 'text/markdown; charset=utf-8')
        res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(safeName)}.md`)
        res.send(buf)
        return
      }

      // EPUB（P14 D：CJS 互操作——utilityProcess 下 import 可能多包一层 default）
      let epubMod = (await import('epub-gen-memory')) as unknown
      while (epubMod && typeof epubMod !== 'function' && typeof (epubMod as { default?: unknown }).default === 'object') {
        epubMod = (epubMod as { default: unknown }).default
      }
      const epub = (typeof epubMod === 'function' ? epubMod : (epubMod as { default?: unknown }).default) as (
        opts: Record<string, unknown>,
        chapters: Array<{ title: string; content: string }>
      ) => Promise<Buffer>
      if (typeof epub !== 'function') {
        throw new Error('epub-gen-memory 未正确加载（导出结构异常）')
      }
      // P20（E1）：章节内容 XML 转义（& < > " 防 EPUB 畸形/标签注入）
      const xmlEscape = (s: string): string =>
        s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
      const buf = (await epub(
        {
          title,
          author: 'AI-Novel-Studio',
          publisher: 'AI-Novel-Studio',
          description: novel.inspiration,
          lang: 'zh-CN'
        },
        chapters.map((c, i) => ({
          title: xmlEscape(c.title || `第 ${i + 1} 章`),
          content: `<p>${xmlEscape(c.content).replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br/>')}</p>`
        }))
      )) as Buffer
      res.setHeader('Content-Type', 'application/epub+zip')
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(safeName)}.epub`)
      res.send(buf)
    } catch (err) {
      next(err)
    }
  })

  return router
}
