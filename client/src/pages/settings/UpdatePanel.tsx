// v0.23.1（批次 E2）：自 SettingsPage.tsx 机械拆分（同 tab 互引组件同文件）
import { useState, useEffect } from 'react'

// v0.16.0：检查更新（electron-updater；便携版不支持自更新——手动下载提示）
type UpdaterState =
  | { state: 'idle'; currentVersion?: string }
  | { state: 'checking'; currentVersion?: string }
  | { state: 'available'; version?: string; currentVersion?: string; downloaded?: boolean }
  | { state: 'up-to-date'; currentVersion?: string }
  | { state: 'downloading'; percent?: number; currentVersion?: string }
  | { state: 'downloaded'; version?: string; currentVersion?: string }
  | { state: 'error'; message?: string; currentVersion?: string }

export function UpdatePanel(): React.JSX.Element {
  const [status, setStatus] = useState<UpdaterState>({ state: 'idle' })
  const [unsupported, setUnsupported] = useState(false)
  const busy = status.state === 'checking' || status.state === 'downloading'

  useEffect(() => {
    if (!window.novelStudio) return
    void window.novelStudio
      .updaterStatus()
      .then((s) => setStatus(s as UpdaterState))
      .catch(() => undefined)
    const unsub = window.novelStudio.onUpdaterStatus((s) => setStatus(s as UpdaterState))
    return unsub
  }, [])

  const check = async (): Promise<void> => {
    const r = await window.novelStudio?.updaterCheck()
    if (r && !r.ok && r.reason === 'unsupported') setUnsupported(true)
  }
  const download = (): void => {
    void window.novelStudio?.updaterDownload()
  }
  const install = (): void => {
    void window.novelStudio?.updaterInstall()
  }

  // v0.16.3：版本显示双保险——IPC 版本优先，编译期 __APP_VERSION__ 兜底（防广播覆盖后缺版本）
  const current = status.currentVersion ?? __APP_VERSION__ ?? '—'
  return (
    <div className="panel col">
      <h2>检查更新</h2>
      <div className="row flex-wrap" style={{ gap: 12, alignItems: 'center' }}>
        <span className="muted t-small">当前版本：</span>
        <strong style={{ fontSize: 14 }}>v{current}</strong>
        <button className="primary" onClick={() => void check()} disabled={busy}>
          {status.state === 'checking' ? '检查中…' : '检查更新'}
        </button>
      </div>
      <div style={{ marginTop: 12 }}>
        {unsupported || status.state === 'idle' ? (
          <p className="muted t-small" style={{ margin: 0 }}>
            应用启动时会自动静默检查新版本；发现更新后这里会提示。
          </p>
        ) : status.state === 'available' ? (
          <div className="row flex-wrap" style={{ gap: 12, alignItems: 'center' }}>
            <span className="t-small" style={{ color: 'var(--accent-bright)' }}>
              发现新版本 v{status.version} —— 点击下载后即可更新（下载完成会提示重启安装）
            </span>
            <button className="primary" onClick={download}>下载更新</button>
          </div>
        ) : status.state === 'downloading' ? (
          <div className="row flex-wrap" style={{ gap: 12, alignItems: 'center' }}>
            <span className="t-small">下载中… {status.percent ?? 0}%</span>
            <div style={{ flex: 1, maxWidth: 260, height: 6, borderRadius: 3, background: 'var(--border)' }}>
              <div style={{ height: 6, borderRadius: 3, background: 'var(--accent)', width: `${status.percent ?? 0}%` }} />
            </div>
          </div>
        ) : status.state === 'downloaded' ? (
          <div className="row flex-wrap" style={{ gap: 12, alignItems: 'center' }}>
            <span className="t-small" style={{ color: 'var(--ok)' }}>
              新版本 v{status.version} 已下载 —— 重启应用即完成安装
            </span>
            <button className="primary" onClick={install}>立即重启安装</button>
          </div>
        ) : status.state === 'up-to-date' ? (
          <p className="t-small" style={{ margin: 0, color: 'var(--ok)' }}>已是最新版本 ✓</p>
        ) : status.state === 'error' ? (
          <p className="t-small" style={{ margin: 0, color: 'var(--danger)' }}>
            检查更新失败：{String(status.message ?? '未知错误')}（请确认网络可用后重试）
          </p>
        ) : null}
        {unsupported && (
          <p className="muted t-small" style={{ margin: '8px 0 0' }}>
            当前为便携版，不支持自动更新——请到 GitHub Releases 手动下载最新安装包。
          </p>
        )}
      </div>
    </div>
  )
}

// P19 ②⑤：写作偏好（语言 / 格式 / 写作模式）+ P22-B 正文排版
