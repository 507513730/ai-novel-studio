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
      const safeName = title.replace(/[\\/:*?"<>|]/g, '_')

      if (format === 'txt') {
        const parts = [title, '']
        for (const c of chapters) {
          parts.push(c.title)
          parts.push('')
          parts.push(c.content)
          parts.push('')
        }
        const buf = Buffer.from(parts.join('\n'), 'utf-8')
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
      const buf = (await epub(
        {
          title,
          author: 'AI-Novel-Studio',
          publisher: 'AI-Novel-Studio',
          description: novel.inspiration,
          lang: 'zh-CN'
        },
        chapters.map((c, i) => ({
          title: c.title || `第 ${i + 1} 章`,
          content: `<p>${c.content.replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br/>')}</p>`
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
