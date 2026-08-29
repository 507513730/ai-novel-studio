import { useRef, useState } from 'react'
import { novelApi } from '../../../api'
import type { VersionDiffInfo } from '../../../types'
import type { ChapterVersion, CtxSection, MemoryData, PendingData, ResourceDetail } from '../types'
import type { VersionActions } from '../VersionHistoryPanel'

// v0.26.0（批次 B）：章节产物面板（待确认/记忆面/版本/上下文/资源详情）从页面拆出（AGENTS #38 先抽 hook）
// 回灌动作与其产物确认同置于此（confirmStates 需要关闭待确认浮层）
export function useChapterArtifacts(options: {
  novelId: number
  selectedChapter: number | null
  notify: (msg: string) => void
  withBusy: (key: string, fn: () => Promise<void> | void) => Promise<void>
  confirmFn: (o: { title: string; message: string; confirmText?: string; danger?: boolean; action: () => void }) => void
  invalidate: () => Promise<void>
  setContent: (v: string) => void
  savedContentRef: React.RefObject<string>
  dirtyRef: React.RefObject<boolean>
  onActionError: (msg: string | null) => void
}): {
  pending: PendingData | null
  showPending: boolean
  setShowPending: (v: boolean) => void
  loadPending: () => Promise<void>
  memory: MemoryData | null
  showMemory: boolean
  setShowMemory: (v: boolean) => void
  memoryBusy: boolean
  memoryPatchBusy: boolean
  loadMemory: () => Promise<void>
  patchCharState: (name: string, state: string, remove: boolean) => Promise<void>
  patchFactionState: (name: string, state: string) => Promise<void>
  versions: ChapterVersion[] | null
  showVersions: boolean
  setShowVersions: (v: boolean) => void
  versionDiff: VersionDiffInfo | null
  setVersionDiff: (d: VersionDiffInfo | null) => void
  loadVersions: () => Promise<void>
  snapshotNow: () => Promise<void>
  versionActions: VersionActions
  ctxSections: CtxSection[] | null
  ctxToggles: Record<string, boolean> | null
  setCtxToggles: React.Dispatch<React.SetStateAction<Record<string, boolean> | null>>
  loadContextPreview: () => Promise<void>
  closeContextPanel: () => void
  resourceDetail: ResourceDetail | null
  setResourceDetail: (d: ResourceDetail | null) => void
  closeAllPanels: () => void
  backfill: () => Promise<void>
  backfillResult: Record<string, unknown> | null
  setBackfillResult: (r: Record<string, unknown> | null) => void
  confirmStates: () => Promise<void>
} {
  const { novelId, selectedChapter, notify, withBusy, confirmFn, invalidate, setContent, savedContentRef, dirtyRef, onActionError } = options
  const id = novelId

  // 待确认区（B0）
  const [pending, setPending] = useState<PendingData | null>(null)
  const [showPending, setShowPending] = useState(false)
  const loadPending = async (): Promise<void> => {
    try {
      const r = await novelApi.pending(id)
      setPending(r)
      setShowPending(true)
    } catch (err) {
      onActionError(err instanceof Error ? err.message : String(err))
    }
  }

  // v0.20.0：记忆面（角色状态/势力状态/待确认事实——显式查看与手动修正）
  const [memory, setMemory] = useState<MemoryData | null>(null)
  const [showMemory, setShowMemory] = useState(false)
  const [memoryBusy, setMemoryBusy] = useState(false)
  const loadMemory = async (): Promise<void> => {
    setMemoryBusy(true)
    try {
      const r = await novelApi.memory(id)
      setMemory(r)
      setShowMemory(true)
    } catch (err) {
      onActionError(err instanceof Error ? err.message : String(err))
    } finally {
      setMemoryBusy(false)
    }
  }
  // v0.21.0（审查 N4）：记忆面操作 busy 锁（ref 防连点并发 POST）
  const memoryPatchBusyRef = useRef(false)
  const [memoryPatchBusy, setMemoryPatchBusy] = useState(false)
  const patchCharState = async (name: string, state: string, remove: boolean): Promise<void> => {
    if (memoryPatchBusyRef.current) return
    memoryPatchBusyRef.current = true
    setMemoryPatchBusy(true)
    try {
      await novelApi.memoryCharacter(id, { name, state, remove })
      await loadMemory()
    } catch (err) {
      onActionError(err instanceof Error ? err.message : String(err))
    } finally {
      memoryPatchBusyRef.current = false
      setMemoryPatchBusy(false)
    }
  }
  const patchFactionState = async (name: string, state: string): Promise<void> => {
    if (memoryPatchBusyRef.current) return
    memoryPatchBusyRef.current = true
    setMemoryPatchBusy(true)
    try {
      await novelApi.memoryFaction(id, { name, state })
      await loadMemory()
    } catch (err) {
      onActionError(err instanceof Error ? err.message : String(err))
    } finally {
      memoryPatchBusyRef.current = false
      setMemoryPatchBusy(false)
    }
  }

  // A3：版本历史
  const [versions, setVersions] = useState<ChapterVersion[] | null>(null)
  const [showVersions, setShowVersions] = useState(false)
  const [versionDiff, setVersionDiff] = useState<VersionDiffInfo | null>(null)
  const loadVersions = async (): Promise<void> => {
    if (!selectedChapter) return
    try {
      const r = await novelApi.versions(id, selectedChapter)
      setVersions(r.versions)
      setShowVersions(true)
      setVersionDiff(null)
    } catch (err) {
      onActionError(err instanceof Error ? err.message : String(err))
    }
  }

  const snapshotNow = async (): Promise<void> => {
    if (!selectedChapter) return
    try {
      await novelApi.createVersion(id, selectedChapter, '手动快照')
      notify('已创建版本快照')
      await loadVersions()
    } catch (err) {
      onActionError(err instanceof Error ? err.message : String(err))
    }
  }

  // B1：加载上下文预览
  const [ctxSections, setCtxSections] = useState<CtxSection[] | null>(null)
  const [ctxToggles, setCtxToggles] = useState<Record<string, boolean> | null>(null)
  const loadContextPreview = async (): Promise<void> => {
    if (!selectedChapter) return
    try {
      const r = await novelApi.contextPreview(id, selectedChapter)
      setCtxSections(r.sections)
      setCtxToggles((prev) => {
        if (prev) return prev
        const init: Record<string, boolean> = {}
        for (const s of r.sections) init[s.key] = true
        return init
      })
    } catch (err) {
      onActionError(err instanceof Error ? err.message : String(err))
    }
  }
  const closeContextPanel = (): void => {
    setCtxSections(null)
    setCtxToggles(null)
  }

  // D1：资源详情浮层（左栏资源树与版本「查看」共用）
  const [resourceDetail, setResourceDetail] = useState<ResourceDetail | null>(null)

  // A3：版本历史动作（数据操作在此，呈现交给 VersionHistoryPanel）
  const versionActions: VersionActions = {
    view: (v) => {
      if (!selectedChapter) return
      void withBusy(`vview-${v.id}`, async () => {
        try {
          const r = await novelApi.chapterVersionDetail(id, selectedChapter, v.id)
          setResourceDetail({ title: `版本 #${v.id}（${v.note} · ${v.createdAt}）`, body: r.version.content })
        } catch (err) {
          onActionError(err instanceof Error ? err.message : String(err))
        }
      })
    },
    restore: (v) => {
      if (!selectedChapter) return
      confirmFn({
        title: '恢复版本',
        message: `恢复为版本 #${v.id}？当前内容会先存入新版本，然后被替换。`,
        confirmText: '恢复',
        danger: true,
        action: () =>
          void withBusy(`vrestore-${v.id}`, async () => {
            try {
              const r = await novelApi.chapterVersionRestore(id, selectedChapter, v.id)
              setContent(r.content)
              savedContentRef.current = r.content
              dirtyRef.current = false
              notify(`已恢复版本 #${v.id}（${r.wordCount} 字），原内容已存为新版本`)
              await invalidate()
            } catch (err) {
              onActionError(err instanceof Error ? err.message : String(err))
            }
          })
      })
    },
    diff: (v) => {
      if (!selectedChapter) return
      void withBusy(`vdiff-${v.id}`, async () => {
        try {
          const d = await novelApi.chapterVersionDiff(id, selectedChapter, v.id)
          setVersionDiff(d)
        } catch (err) {
          onActionError(err instanceof Error ? err.message : String(err))
        }
      })
    }
  }

  // P9 D16：Esc 一键关闭浮层面板
  const closeAllPanels = (): void => {
    setShowVersions(false)
    setShowPending(false)
    setCtxSections(null)
    setResourceDetail(null)
  }

  // 回灌动作与其产物确认（confirmStates 需要关闭待确认浮层，故与 backfill 同置）
  const [backfillResult, setBackfillResult] = useState<Record<string, unknown> | null>(null)
  const backfill = async (): Promise<void> => {
    if (!selectedChapter) return
    onActionError(null)
    notify('回灌提取中…')
    try {
      const r = await novelApi.backfill(id, selectedChapter)
      setBackfillResult(r)
      notify('回灌完成：角色状态 / 新事实 / 伏笔已进入待确认区')
    } catch (err) {
      onActionError(err instanceof Error ? err.message : String(err))
    }
  }
  const confirmStates = async (): Promise<void> => {
    if (!backfillResult || !Array.isArray(backfillResult.characterStates)) return
    await withBusy('confirm', async () => {
      await novelApi.confirmState(id, backfillResult.characterStates as Array<{ name: string; state: string }>)
      setBackfillResult(null)
      setShowPending(false)
      notify('角色状态已确认入账')
    })
  }

  return {
    pending,
    showPending,
    setShowPending,
    loadPending,
    memory,
    showMemory,
    setShowMemory,
    memoryBusy,
    memoryPatchBusy,
    loadMemory,
    patchCharState,
    patchFactionState,
    versions,
    showVersions,
    setShowVersions,
    versionDiff,
    setVersionDiff,
    loadVersions,
    snapshotNow,
    versionActions,
    ctxSections,
    ctxToggles,
    setCtxToggles,
    loadContextPreview,
    closeContextPanel,
    resourceDetail,
    setResourceDetail,
    closeAllPanels,
    backfill,
    backfillResult,
    setBackfillResult,
    confirmStates
  }
}
