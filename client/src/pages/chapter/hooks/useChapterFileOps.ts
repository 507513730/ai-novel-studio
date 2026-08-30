import { useState } from 'react'
import { novelApi, authHeaders } from '../../../api'
import { extractProtagonistName } from '../../../utils/protagonist'
import type { ExportFormat } from '../EditorArea'

// v0.26.0（批次 B）：章节文件/元信息操作从页面拆出（AGENTS #38 先抽 hook）
// 覆盖：P9 B7 导出下载（fetch 校验）、P9 B8 标题保存、v0.15.0 引导句固定为硬约束
// v1.0 后续（A5）：导出前先打开排版预览（ExportPreviewModal）——`openExportPreview` 弹预览，
// 用户确认后在预览内点「下载」才走到 `downloadExport` 实际下载。
export function useChapterFileOps(options: {
  novelId: number
  selectedChapter: number | null
  chapterTitle: string | undefined
  notify: (msg: string) => void
  invalidate: () => Promise<void>
  toast: (type: 'ok' | 'error' | 'info', text: string) => void
}): {
  exportBusy: string | null
  exportPreviewFormat: ExportFormat | null
  openExportPreview: (format: ExportFormat) => void
  closeExportPreview: () => void
  toggleExportFormat: (format: ExportFormat) => void
  downloadExport: (format: ExportFormat) => Promise<void>
  saveTitle: (t: string) => Promise<void>
  pinGuidance: (guidance: string, onPinned: () => void) => void
} {
  const { novelId, selectedChapter, chapterTitle, notify, invalidate, toast } = options
  const id = novelId

  // P9 B7：导出改为 fetch 下载（校验响应，成功/失败真实反馈）
  const [exportBusy, setExportBusy] = useState<string | null>(null)
  // A5：导出预览弹层（当前格式非空即为打开态）
  const [exportPreviewFormat, setExportPreviewFormat] = useState<ExportFormat | null>(null)

  const openExportPreview = (format: ExportFormat): void => {
    setExportPreviewFormat(format)
  }
  const closeExportPreview = (): void => {
    setExportPreviewFormat(null)
  }
  const toggleExportFormat = (format: ExportFormat): void => {
    setExportPreviewFormat(format)
  }

  const downloadExport = async (format: 'txt' | 'md' | 'epub' | 'docx'): Promise<void> => {
    if (exportBusy) return
    setExportBusy(format)
    try {
      const res = await fetch(novelApi.exportUrl(id, format), { headers: authHeaders() })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        throw new Error(body?.error ?? `HTTP ${res.status}`)
      }
      const blob = await res.blob()
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `${chapterTitle ?? `chapter-${id}`}.${format}`
      a.click()
      URL.revokeObjectURL(a.href)
      toast('ok', `已导出 ${format.toUpperCase()}`)
      setExportPreviewFormat(null)
    } catch (err) {
      toast('error', `导出失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setExportBusy(null)
    }
  }

  // P9 B8：标题保存（由 ChapterToolbar 提交时调用；编辑态由工具条自持）
  const saveTitle = async (t: string): Promise<void> => {
    if (!selectedChapter || t === chapterTitle) return
    try {
      await novelApi.chapterPatch(id, selectedChapter, { title: t })
      await invalidate()
      notify('标题已更新')
    } catch (err) {
      toast('error', `标题保存失败：${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // v0.15.0：反馈沉淀——把引导句固定为书级硬约束（导演/方案/生成/修复全链生效）
  const pinGuidance = (guidance: string, onPinned: () => void): void => {
    const t = guidance.trim()
    if (!t) return
    void (async () => {
      const d = await novelApi.detail(id)
      const cur = d.novel.constraints ?? []
      const next = cur.filter((c) => c.text !== t)
      const canon = extractProtagonistName(t)
      next.push({
        // v0.23.1（批次 B6）：约束 id 补随机后缀（同毫秒多次固定不撞 id）
        id: `c${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        text: t,
        level: 'must' as const,
        enabled: true,
        createdAt: new Date().toISOString(),
        ...(canon ? { keyword: canon, replaceWith: canon } : {})
      })
      await novelApi.patch(id, { constraints: next })
      onPinned()
    })().catch(() => undefined)
  }

  return { exportBusy, exportPreviewFormat, openExportPreview, closeExportPreview, toggleExportFormat, downloadExport, saveTitle, pinGuidance }
}
