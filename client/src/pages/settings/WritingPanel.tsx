// v0.23.1（批次 E2）：自 SettingsPage.tsx 机械拆分（同 tab 互引组件同文件）
import { useState, useEffect } from 'react'
import { apiFetch } from '../../api'
import { useToast } from '../../components/Toast'
import { applyFonts, getStoredFonts, type FontSettings } from '../../utils/fonts'

export function WritingPanel(): React.JSX.Element {  const { toast } = useToast()
  const [settings, setSettings] = useState<{ lang: string; format: string; writingMode: string } | null>(null)
  // P22-B：排版状态（同步 fonts 工具，即时生效）
  const [typeIndent, setTypeIndent] = useState(getStoredFonts().indent)
  const [typeLineHeight, setTypeLineHeight] = useState(getStoredFonts().lineHeight)
  const [typeFontSize, setTypeFontSize] = useState(getStoredFonts().fontSize)
  const [typeMaxWidth, setTypeMaxWidth] = useState(getStoredFonts().maxWidth)
  const patchType = (patch: Partial<FontSettings>): void => {
    applyFonts({ ...getStoredFonts(), ...patch })
  }
  // v0.9.0（审查 #12）：走统一 apiFetch——此前裸 fetch('/api/...') 无 baseUrl/token
  // 且失败被静默吞掉，页面永远停留在"加载中…"
  useEffect(() => {
    let alive = true
    void apiFetch('/settings/writing')
      .then((d) => {
        if (alive) {
          const v = d as { lang?: string; format?: string; writingMode?: string }
          setSettings((prev) => ({
            lang: String(v.lang ?? prev?.lang ?? ''),
            format: String(v.format ?? prev?.format ?? ''),
            writingMode: String(v.writingMode ?? prev?.writingMode ?? '')
          }))
        }
      })
      .catch(() => toast('error', '写作偏好加载失败'))
    return () => {
      alive = false
    }
  }, [])
  const patch = async (patch: Record<string, string>): Promise<void> => {
    try {
      await apiFetch('/settings/writing', {
        method: 'PATCH',
        body: JSON.stringify(patch)
      })
      setSettings((prev) => (prev ? { ...prev, ...patch } : prev))
      toast('ok', '已保存，将影响后续生成')
    } catch {
      toast('error', '保存失败')
    }
  }
  const Option = ({ label, desc, current, onPick }: { label: string; desc: string; current: boolean; onPick: () => void }): React.JSX.Element => (
    <button
      onClick={onPick}
      style={{
        padding: '10px 14px',
        borderRadius: 'var(--radius-m)',
        background: 'var(--bg-card)',
        border: `1px solid ${current ? 'var(--accent)' : 'var(--border)'}`,
        cursor: 'pointer',
        textAlign: 'left'
      }}
    >
      <div style={{ fontSize: 13, color: 'var(--text)' }}>{label} {current ? '✓' : ''}</div>
      <div className="muted t-small">{desc}</div>
    </button>
  )
  if (!settings) return <div className="panel">加载中…</div>
  return (
    <div className="panel col">
      <h2>写作偏好</h2>
      <p className="muted t-small">
        这些规则会注入每次生成的写作要求（改设置后生成缓存自动失效）。仅在不等于默认值时注入，不浪费 token。
      </p>
      <h3 style={{ fontSize: 13, margin: '8px 0 4px' }}>语言</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8 }}>
        <Option label="简体中文" desc="默认" current={settings.lang === 'simplified'} onPick={() => void patch({ lang: 'simplified' })} />
        <Option label="繁体中文" desc="全文统一繁体" current={settings.lang === 'traditional'} onPick={() => void patch({ lang: 'traditional' })} />
      </div>
      <h3 style={{ fontSize: 13, margin: '8px 0 4px' }}>格式</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8 }}>
        <Option label="自然分段" desc="默认，一段一意" current={settings.format === 'paragraph'} onPick={() => void patch({ format: 'paragraph' })} />
        <Option label="长句连续" desc="复合句为主，段落连续" current={settings.format === 'longSentence'} onPick={() => void patch({ format: 'longSentence' })} />
      </div>
      <h3 style={{ fontSize: 13, margin: '8px 0 4px' }}>写作模式</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8 }}>
        <Option label="聚焦" desc="严格围绕章节目标，不展开支线" current={settings.writingMode === 'focused'} onPick={() => void patch({ writingMode: 'focused' })} />
        <Option label="标准" desc="默认，适度铺陈" current={settings.writingMode === 'standard'} onPick={() => void patch({ writingMode: 'standard' })} />
        <Option label="自由" desc="允许支线发散，结尾回落主线" current={settings.writingMode === 'free'} onPick={() => void patch({ writingMode: 'free' })} />
      </div>

      {/* P22-B：正文排版（编辑器即时生效） */}
      <h3 style={{ fontSize: 13, margin: '8px 0 4px' }}>正文排版</h3>
      <div className="col gap-2">
        <label className="row" style={{ fontSize: 12, gap: 8 }}>
          <input type="checkbox" checked={typeIndent} onChange={(e) => { setTypeIndent(e.target.checked); patchType({ indent: e.target.checked }) }} />
          首行缩进 2 字符（每行缩进；段落=一行时视觉正确）
        </label>
        <div className="row" style={{ fontSize: 12, gap: 8 }}>
          <span style={{ minWidth: 48 }}>行距</span>
          <input
            type="range" min={1.5} max={2.2} step={0.05}
            value={typeLineHeight}
            onChange={(e) => { const v = Number(e.target.value); setTypeLineHeight(v); patchType({ lineHeight: v }) }}
          />
          <span className="muted">{typeLineHeight.toFixed(2)}</span>
        </div>
        <div className="row" style={{ fontSize: 12, gap: 8 }}>
          <span style={{ minWidth: 48 }}>字号</span>
          <input
            type="range" min={14} max={18} step={1}
            value={typeFontSize}
            onChange={(e) => { const v = Number(e.target.value); setTypeFontSize(v); patchType({ fontSize: v }) }}
          />
          <span className="muted">{typeFontSize}px</span>
        </div>
        <label className="row" style={{ fontSize: 12, gap: 8 }}>
          <input type="checkbox" checked={typeMaxWidth} onChange={(e) => { setTypeMaxWidth(e.target.checked); patchType({ maxWidth: e.target.checked }) }} />
          阅读宽度（720px 居中，长行更易读）
        </label>
      </div>

      {/* v0.18.0：联网查找（零 key——Wikipedia；知识库联网搜索 + 世界观生成可选注入） */}
      <h3 style={{ fontSize: 13, margin: '12px 0 4px' }}>联网查找</h3>
      <div className="col gap-2" style={{ fontSize: 12 }}>
        <WebSearchToggle />
        <p className="muted" style={{ margin: 0 }}>
          开启后：知识库页可「联网搜索」导入设定资料（Wikipedia 中文优先，零 key）；生成世界观时自动注入相关联网资料。
          失败/离线静默降级，不影响正常创作。
        </p>
      </div>
    </div>
  )
}

// v0.18.0：联网查找开关（全局）

function WebSearchToggle(): React.JSX.Element {
  const { toast } = useToast()
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  // v0.21.0（审查 P3 LOW）：拉取失败态 + 重试——此前失败被吞，页面永卡"（加载中…）"
  const [loadFailed, setLoadFailed] = useState(false)
  const [reloadTick, setReloadTick] = useState(0)
  useEffect(() => {
    let alive = true
    setLoadFailed(false)
    void apiFetch('/settings/web/enabled')
      .then((d) => {
        if (alive) setEnabled((d as { enabled?: boolean })?.enabled === true)
      })
      .catch(() => {
        if (alive) setLoadFailed(true)
      })
    return () => {
      alive = false
    }
  }, [reloadTick])
  const toggle = async (on: boolean): Promise<void> => {
    setBusy(true)
    try {
      await apiFetch('/settings/app', { method: 'PATCH', body: JSON.stringify({ webSearchEnabled: on }) })
      setEnabled(on)
      toast('ok', on ? '联网查找已开启' : '联网查找已关闭')
    } catch (e) {
      toast('error', `保存失败：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(false)
    }
  }
  return (
    <label className="row" style={{ fontSize: 12, gap: 8, alignItems: 'center' }}>
      <input
        type="checkbox"
        checked={enabled === true}
        disabled={busy || enabled === null}
        onChange={(e) => void toggle(e.target.checked)}
      />
      开启联网查找
      {enabled === null && !loadFailed && <span className="muted">（加载中…）</span>}
      {loadFailed && (
        <span className="muted" style={{ color: 'var(--danger)' }}>
          （加载失败）
          <button className="sm ml-2" onClick={() => setReloadTick((t) => t + 1)}>重试</button>
        </span>
      )}
    </label>
  )
}

// P13 F0：外观设置（多主题选择器）
// P22-A：字体选择（正文字体 + 编辑器字体）
