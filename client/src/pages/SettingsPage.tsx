// v0.23.1（批次 E2）：八个设置面板拆分至 ./settings/（本文件仅保留页骨架与 tab 编排）
import { useState } from 'react'
import { ProvidersPanel } from './settings/ProvidersPanel'
import { ModelRoutesPanel } from './settings/ModelRoutesPanel'
import { UsagePanel } from './settings/UsagePanel'
import { UpdatePanel } from './settings/UpdatePanel'
import { WritingPanel } from './settings/WritingPanel'
import { AppearancePanel } from './settings/AppearancePanel'

export function SettingsPage({ initialTab = 'providers' }: { initialTab?: 'providers' | 'routes' | 'usage' | 'appearance' | 'writing' | 'update' }): React.JSX.Element {
  const [tab, setTab] = useState<'providers' | 'routes' | 'usage' | 'appearance' | 'writing' | 'update'>(initialTab)
  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="row justify-between">
        <h1>设置</h1>
        <div className="pill-tabs">
          <button className={tab === 'providers' ? 'active' : ''} onClick={() => setTab('providers')}>
            供应商
          </button>
          <button className={tab === 'routes' ? 'active' : ''} onClick={() => setTab('routes')}>
            模型路由
          </button>
          <button className={tab === 'usage' ? 'active' : ''} onClick={() => setTab('usage')}>
            成本
          </button>
          <button className={tab === 'writing' ? 'active' : ''} onClick={() => setTab('writing')}>
            写作
          </button>
          <button className={tab === 'appearance' ? 'active' : ''} onClick={() => setTab('appearance')}>
            外观
          </button>
          {/* v0.16.0：检查更新 */}
          <button className={tab === 'update' ? 'active' : ''} onClick={() => setTab('update')}>
            更新
          </button>
        </div>
      </div>
      {tab === 'providers' && <ProvidersPanel />}
      {tab === 'routes' && <ModelRoutesPanel />}
      {tab === 'usage' && <UsagePanel />}
      {tab === 'writing' && <WritingPanel />}
      {tab === 'appearance' && <AppearancePanel />}
      {tab === 'update' && <UpdatePanel />}
    </div>
  )
}
