// v0.23.1（批次 E2）：自 SettingsPage.tsx 机械拆分（同 tab 互引组件同文件）
import { useState, useEffect } from 'react'
import { useToast } from '../../components/toastGlobal'
import { useConfirm } from '../../components/useConfirm'
import { THEMES, applyTheme, getStoredTheme, type ThemePreference } from '../../utils/theme'
import { SERIF_FONTS, UI_FONTS, applyFonts, getStoredFonts, DEFAULTS, type FontSettings } from '../../utils/fonts'
import { SHORTCUT_ACTIONS, getStoredShortcuts, saveShortcut, resetShortcuts, eventToCombo, formatCombo, type ShortcutAction, type ShortcutBinding } from '../../utils/shortcuts'

function BackupInfo(): React.JSX.Element | null {
  const [info, setInfo] = useState<{ lastAt: string | null; count: number; keep: number } | null>(null)
  useEffect(() => {
    let alive = true
    void window.novelStudio
      ?.getAutoBackupInfo()
      .then((r) => {
        if (alive) setInfo(r)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])
  if (!info || info.count === 0) return null
  return (
    <div className="muted t-small" style={{ marginBottom: 8 }}>
      💾 每日自动备份已启用：最近 {info.lastAt ?? '未知'}（保留最近 {info.keep} 份，位于数据目录 backups/）
    </div>
  )
}

function FontPanel(): React.JSX.Element {
  const { toast } = useToast()
  const [settings, setSettings] = useState<FontSettings>(getStoredFonts())
  const update = (patch: Partial<FontSettings>): void => {
    const next = { ...settings, ...patch }
    setSettings(next)
    applyFonts(next)
  }
  return (
    <div className="col" style={{ gap: 10, marginTop: 6 }}>
      <div>
        <div style={{ fontSize: 13, marginBottom: 4 }}>正文字体</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 8 }}>
          {SERIF_FONTS.map((f) => (
            <button
              key={f.key}
              onClick={() => update({ prose: f.key })}
              title={f.desc}
              style={{
                padding: '10px 12px',
                borderRadius: 'var(--radius-m)',
                background: 'var(--bg-card)',
                border: `1px solid ${settings.prose === f.key ? 'var(--accent)' : 'var(--border)'}`,
                cursor: 'pointer',
                textAlign: 'left'
              }}
            >
              <div style={{ fontSize: 15, color: 'var(--text)', fontFamily: f.stack }}>
                {f.label} {settings.prose === f.key ? '✓' : ''}
              </div>
              <div className="muted t-small">{f.desc}</div>
            </button>
          ))}
        </div>
        <div
          style={{
            marginTop: 8,
            padding: '10px 14px',
            borderRadius: 8,
            background: 'var(--bg-panel)',
            fontFamily: SERIF_FONTS.find((f) => f.key === settings.prose)?.stack,
            fontSize: 15,
            lineHeight: 1.8,
            color: 'var(--text-dim)'
          }}
        >
          仿佛面前展开了全新的世界。他推开那扇尘封的门，光线涌了进来——预览文字，用于感受字体观感。
        </div>
      </div>
      <div className="row gap-2">
        <span className="t-small">编辑器字体：</span>
        <select
          value={settings.editor}
          onChange={(e) => update({ editor: e.target.value as 'prose' | 'mono' })}
        >
          <option value="prose">跟随正文</option>
          <option value="mono">等宽（JetBrains Mono）</option>
        </select>
        <span className="t-small">界面字体：</span>
        <select value={settings.ui} onChange={(e) => update({ ui: e.target.value })}>
          {UI_FONTS.map((f) => (
            <option key={f.key} value={f.key}>{f.label}</option>
          ))}
        </select>
        <button className="sm" onClick={() => { update({ ...DEFAULTS }); toast('ok', '已恢复默认字体') }}>恢复默认</button>
      </div>
    </div>
  )
}

// P27 1-9：快捷键自定义（录制 + 冲突检测 + 恢复默认）

function ShortcutPanel(): React.JSX.Element {
  const { toast } = useToast()
  const [bindings, setBindings] = useState<Record<string, string>>(getStoredShortcuts())
  const [recording, setRecording] = useState<string | null>(null)

  const startRecord = (action: string): void => {
    setRecording(action)
    toast('info', '请按下新的组合键（Esc 取消）')
  }

  const onKey = (e: KeyboardEvent): void => {
    if (!recording) return
    e.preventDefault()
    e.stopPropagation()
    if (e.key === 'Escape') {
      setRecording(null)
      return
    }
    const combo = eventToCombo(e)
    if (!combo) return
    // 冲突检测
    const conflict = Object.entries(bindings).find(([a, b]) => b === combo && a !== recording)
    if (conflict) {
      toast('error', `与「${SHORTCUT_ACTIONS[conflict[0] as ShortcutAction]?.label ?? conflict[0]}」冲突`)
      setRecording(null)
      return
    }
    saveShortcut(recording as ShortcutAction, combo)
    setBindings(getStoredShortcuts())
    setRecording(null)
    toast('ok', `已设置：${formatCombo(combo)}`)
  }

  useEffect(() => {
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording, bindings])

  return (
    <div className="col gap-2" style={{ marginBottom: 8 }}>
      <p className="muted t-small">点击「录制」后按下组合键即可自定义。命令面板默认 Ctrl+K（搜小说/跳页面）。</p>
      <div className="col gap-1">
        {(Object.entries(SHORTCUT_ACTIONS) as Array<[ShortcutAction, ShortcutBinding]>).map(([action, meta]) => (
          <div key={action} className="row justify-between" style={{ padding: '4px 0' }}>
            <span className="t-small">{meta.label}</span>
            <div className="row gap-2">
              <kbd style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 4, padding: '2px 8px', fontSize: 12, minWidth: 90, textAlign: 'center' }}>
                {recording === action ? '…按下组合键' : formatCombo(bindings[action] ?? meta.combo)}
              </kbd>
              <button className="sm" onClick={() => startRecord(action)} disabled={recording !== null && recording !== action}>
                录制
              </button>
            </div>
          </div>
        ))}
      </div>
      <button className="sm" onClick={() => { resetShortcuts(); setBindings(getStoredShortcuts()); toast('ok', '已恢复默认快捷键') }}>
        恢复默认
      </button>
    </div>
  )
}

export function AppearancePanel(): React.JSX.Element {
  const { toast } = useToast()
  const [current, setCurrent] = useState<ThemePreference>(getStoredTheme())
  // v0.22.0（审查 ALOW）：themed confirm 统一——备份恢复/清除数据
  const [confirmFn, confirmDialog] = useConfirm()
  return (
    <div className="panel col">
      {/* P27 1-9：快捷键自定义 */}
      <h2>快捷键</h2>
      <ShortcutPanel />
      <h2>主题</h2>
      <p className="muted t-small">
        选择界面配色（灵感来自 FeelFish 色板与参考项目浅色风格；「跟随系统」自动映射 深色=墨蓝 / 浅色=纸张）。主题即时生效并记住选择。
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12 }}>
        {/* v0.24.4（A7）：跟随系统偏好 */}
        <button
          onClick={() => {
            applyTheme('system')
            setCurrent('system')
          }}
          style={{
            padding: 12,
            borderRadius: 'var(--radius-m)',
            background: 'var(--bg-card)',
            border: `1px solid ${current === 'system' ? 'var(--accent)' : 'var(--border)'}`,
            cursor: 'pointer',
            textAlign: 'left'
          }}
        >
          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            <span style={{ width: 28, height: 28, borderRadius: 6, background: '#0e0f13', border: '1px solid rgba(255,255,255,0.15)' }} />
            <span style={{ width: 28, height: 28, borderRadius: 6, background: '#f6f8f5' }} />
          </div>
          <div style={{ fontSize: 13, color: 'var(--text)' }}>跟随系统</div>
          <div className="muted t-small">{current === 'system' ? '✓ 当前' : 'system'}</div>
        </button>
        {THEMES.map((t) => (
          <button
            key={t.key}
            onClick={() => {
              applyTheme(t.key)
              setCurrent(t.key)
            }}
            style={{
              padding: 12,
              borderRadius: 'var(--radius-m)',
              background: 'var(--bg-card)',
              border: `1px solid ${current === t.key ? 'var(--accent)' : 'var(--border)'}`,
              cursor: 'pointer',
              textAlign: 'left'
            }}
          >
            <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
              <span style={{ width: 28, height: 28, borderRadius: 6, background: t.preview[0], border: '1px solid rgba(255,255,255,0.15)' }} />
              <span style={{ width: 28, height: 28, borderRadius: 6, background: t.preview[1] }} />
            </div>
            <div style={{ fontSize: 13, color: 'var(--text)' }}>{t.label}</div>
            <div className="muted t-small">{current === t.key ? '✓ 当前' : t.key}</div>
          </button>
        ))}
      </div>

      {/* P22-A：字体设置 */}
      <h2 className="mt-2">字体</h2>
      <p className="muted t-small">
        正文字体作用于写作编辑器与预览；界面字体保持系统栈。打包字体为开源 OFL 协议（霞鹜文楷/思源宋体/思源黑体），离线可用。
      </p>
      <FontPanel />

      {/* P16 P0：数据管理 */}
      <h2 className="mt-2">数据与卸载</h2>
      {/* v0.9.2（O4）：每日自动备份信息（启动后首备 + 每 24h，保留最近 7 份） */}
      <BackupInfo />
      <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
        <button onClick={() => void window.novelStudio?.openDataDir()}>📂 打开数据目录</button>
        {/* P18 B：备份导出/恢复 */}
        <button
          onClick={() =>
            void window.novelStudio?.exportBackup().then((r) => {
              if (!r.ok) {
                if (!r.canceled) toast('error', r.error ?? '导出失败')
                return
              }
              toast('ok', `已导出备份（${r.copied ?? 0} 个文件）`)
            })
          }
        >
          📦 导出备份
        </button>
        <button
          onClick={() => {
            confirmFn({ title: '从备份恢复', message: '从备份恢复将覆盖当前全部数据（小说/设定/Key），且需要重启应用。继续？', confirmText: '恢复', danger: true, action: () => {
              void window.novelStudio?.restoreBackup().then((r) => {
                if (!r.ok) {
                  if (!r.canceled) toast('error', r.error ?? '恢复失败')
                  return
                }
                toast('ok', '已恢复，正在重启…')
                setTimeout(() => window.location.reload(), 1200)
              })
            } })
          }}
        >
          ♻️ 从备份恢复
        </button>
        <button
          className="danger"
          onClick={() => {
            confirmFn({ title: '清除全部数据', message: '清除全部数据（API Key、小说、设定、配置）？此操作不可恢复，应用将退出。', confirmText: '清除', danger: true, action: () => void window.novelStudio?.wipeData() })
          }}
        >
          🗑 清除全部数据
        </button>
      </div>
      <p className="muted" style={{ fontSize: 11, marginTop: 8, lineHeight: 1.6 }}>
        数据存于用户目录（AppData\\Roaming\\ai-novel-studio），与安装目录分离。卸载应用：Windows 设置 &gt; 应用 &gt; AI-Novel-Studio &gt; 卸载（会同时清除数据）；
        便携版 = 删除文件夹与旁 data/ 目录。
      </p>
      {confirmDialog}
    </div>
  )
}
