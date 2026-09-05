import { useCallback, useEffect, useRef, useState } from 'react'
import { apiFetch } from '../../api'
import { useToast } from '../../components/toastGlobal'

export interface WritingSettings {
  lang: string
  format: string
  writingMode: string
  quickWords: Record<string, string>
}
export type WritingPatch = Partial<Pick<WritingSettings, 'lang' | 'format' | 'writingMode' | 'quickWords'>>

export function useWritingSettings() {
  const { toast } = useToast()
  const [settings, setSettings] = useState<WritingSettings | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [saving, setSaving] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const generation = useRef(0)
  const savingRef = useRef(false)
  const loadingRef = useRef(true)
  const mounted = useRef(false)

  useEffect(() => {
    const current = ++generation.current
    mounted.current = true
    loadingRef.current = true
    setLoadError(false)
    void apiFetch('/settings/writing')
      .then((data) => {
        if (!mounted.current || current !== generation.current) return
        const value = data as Partial<WritingSettings>
        setSettings({
          lang: value.lang ?? 'simplified',
          format: value.format ?? 'paragraph',
          writingMode: value.writingMode ?? 'standard',
          quickWords: value.quickWords ?? {}
        })
      })
      .catch(() => {
        if (!mounted.current || current !== generation.current) return
        setLoadError(true)
        toast('error', '写作偏好加载失败')
      })
      .finally(() => {
        if (current === generation.current) loadingRef.current = false
      })
    return () => {
      mounted.current = false
      generation.current = current + 1
    }
  }, [reloadKey, toast])

  const retry = useCallback(() => {
    if (loadingRef.current || savingRef.current || !mounted.current) return
    loadingRef.current = true
    setReloadKey(key => key + 1)
  }, [])

  const patch = useCallback(async (change: WritingPatch): Promise<void> => {
    if (!mounted.current || !settings || loadingRef.current || savingRef.current) return
    savingRef.current = true
    setSaving(true)
    const current = generation.current
    try {
      await apiFetch('/settings/writing', { method: 'PATCH', body: JSON.stringify(change) })
      if (!mounted.current || current !== generation.current) return
      setSettings(previous => previous ? { ...previous, ...change } : previous)
      toast('ok', '已保存，将影响后续生成')
    } catch {
      if (mounted.current && current === generation.current) toast('error', '保存失败')
    } finally {
      savingRef.current = false
      if (mounted.current) setSaving(false)
    }
  }, [settings, toast])

  return { settings, saving, loadError, retry, patch }
}
