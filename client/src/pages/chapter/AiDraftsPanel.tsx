import type { useAiDrafts } from './hooks/useAiDrafts'

export function AiDraftsPanel({ ai, chapterId, onSelect }: {
  ai: ReturnType<typeof useAiDrafts>
  chapterId: number | null
  onSelect: (id: number) => void
}): React.JSX.Element {
  return <section className="workspace-section">
    <h3>待采用结果 · {ai.drafts.length}</h3>
    {ai.running && <p role="status">正在处理：{ai.running.title}</p>}
    {!ai.drafts.length && <p>选中文字润色，或从光标续写。结果会先保留在这里。</p>}
    {ai.drafts.map(draft => <article className="workspace-preview" key={draft.id}>
      <strong>{draft.title}</strong>
      <p>{draft.versionId ? '已存入版本历史' : '暂存于当前页面'}</p>
      {chapterId !== draft.chapterId ? <button onClick={() => onSelect(draft.chapterId)}>返回原章节</button> :
        !ai.canAdopt(draft) && <p className="preview-warning">你已修改正文，AI 结果已保留。请对照后手动合并。</p>}
      <details><summary>查看原文与 AI 结果</summary>
        <h4>原选区</h4><pre>{draft.original.slice(draft.from, draft.to) || '在光标处插入'}</pre>
        <h4>AI 结果</h4><pre tabIndex={0}>{draft.text}</pre>
      </details>
      <div className="workspace-secondary">
        <button disabled={!ai.canAdopt(draft) || ai.running !== null} onClick={() => void ai.adopt(draft)}>采用</button>
        <button onClick={() => ai.dismiss(draft.id)}>关闭预览</button>
      </div>
    </article>)}
  </section>
}
