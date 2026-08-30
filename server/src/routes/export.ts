import { Router } from 'express'
import type { DatabaseSync } from 'node:sqlite'
import { z } from 'zod'

// v0.24.4（A5）：jszip 最小接口（DOCX OOXML 组装用）
interface JSZipLike {
  file(name: string, content: string): void
  folder(name: string): { file(name: string, content: string): void } | null
  generateAsync(opts: { type: string }): Promise<Buffer>
}

export function createExportRouter(db: DatabaseSync): Router {
  const router = Router()

  // v1.0 后续（A5 导出预览）：整本书导出前的结构化预览数据（camelCase，客户端 .prose 渲染）。
  // 与 /export 共用同一份"已写章节"查询，保证预览与真实导出内容一致。
  router.get('/:novelId/export-preview', (req, res, next) => {
    try {
      const novelId = Number(req.params.novelId)
      const novel = db.prepare('SELECT title, inspiration FROM novel WHERE id = ?').get(novelId) as
        | { title: string; inspiration: string }
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
      res.json({
        title: novel.title || '未命名小说',
        inspiration: novel.inspiration,
        chapters
      })
    } catch (err) {
      next(err)
    }
  })

  router.get('/:novelId/export', async (req, res, next) => {
    try {
      const novelId = Number(req.params.novelId)
      const format = z.enum(['txt', 'md', 'epub', 'docx']).parse(req.query.format ?? 'txt')
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

      // DOCX（v0.24.4 A5：零新依赖——jszip 组装 OOXML；投稿平台事实标准）
      if (format === 'docx') {
        // D42：utilityProcess 下 CJS 包动态 import 双层 default（jszip .default 为 function——按"非 function 且有 default 即解包"通用处理）
        let jszipMod = (await import('jszip')) as unknown
        while (jszipMod && typeof jszipMod !== 'function' && (jszipMod as { default?: unknown }).default !== undefined) {
          jszipMod = (jszipMod as { default: unknown }).default
        }
        const JSZipCtor = jszipMod as unknown as { new (): JSZipLike }
        if (typeof JSZipCtor !== 'function') {
          throw new Error('jszip 未正确加载（导出结构异常）')
        }
        const xmlEscape = (s: string): string =>
          s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/\r\n?/g, '\n')
        const para = (text: string, heading = false): string => {
          const pPr = heading
            ? '<w:pPr><w:spacing w:before="240" w:after="120"/><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:pPr>'
            : '<w:pPr><w:spacing w:line="360" w:lineRule="auto"/><w:jc w:val="both"/></w:pPr>'
          const rPr = heading ? '<w:rPr><w:b/><w:sz w:val="28"/></w:rPr>' : ''
          return `<w:p>${pPr}<w:r>${rPr}<w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r></w:p>`
        }
        const bodyParts: string[] = [para(title, true)]
        if (novel.inspiration) bodyParts.push(para(`灵感：${novel.inspiration}`))
        for (const c of chapters) {
          bodyParts.push(para(c.title || '（未命名章节）', true))
          // 正文空行分段（与 txt/md 语义一致）
          for (const seg of c.content.split(/\n{2,}/)) {
            for (const line of seg.split('\n')) bodyParts.push(para(line))
          }
        }
        const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>${bodyParts.join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body>
</w:document>`
        const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`
        const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`
        const zip = new JSZipCtor()
        zip.file('[Content_Types].xml', contentTypes)
        zip.file('_rels/.rels', rels)
        zip.folder('word')?.file('document.xml', documentXml)
        const buf = await zip.generateAsync({ type: 'nodebuffer' })
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
        res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(safeName)}.docx`)
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
