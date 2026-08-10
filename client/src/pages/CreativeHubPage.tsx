import { useNavigate, useParams } from 'react-router-dom'
import { HubChat } from '../components/HubChat'
import { NovelGate } from '../components/NovelGate'

// P17-1：创作中枢全局化——无书时选书落地，有书时正常对话
export function CreativeHubPage(): React.JSX.Element {
  const { novelId } = useParams()
  const navigate = useNavigate()
  const id = Number(novelId)

  if (!novelId || !Number.isInteger(id) || id <= 0) {
    return (
      <NovelGate
        title="创作中枢"
        desc="对话即创作：选择一本书后，可以直接让 AI 查状态、跑导演、生成章节。"
        target={(n) => `/novels/${n}/hub`}
      />
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', maxWidth: 960, margin: '0 auto' }}>
      <div className="row" style={{ padding: '10px 20px', borderBottom: '1px solid var(--border)', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ fontSize: 18 }}>创作中枢（Creative Hub）</h1>
          <span className="muted" style={{ fontSize: 12 }}>
            对话即创作：可以直接让 AI 查状态、跑导演、生成章节
          </span>
        </div>
        <div className="row">
          <button className="sm" onClick={() => navigate('/hub')}>切换书</button>
          <button className="sm" onClick={() => navigate(`/novels/${id}`)}>← 工作台</button>
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <HubChat novelId={id} />
      </div>
    </div>
  )
}
