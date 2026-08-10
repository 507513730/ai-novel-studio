// P17-5B：检索后端抽象（TF-IDF 默认，Embedding 预留升级位）
export interface RetrievalDoc {
  id: number
  title: string
  content: string
}

export interface SearchHit {
  id: number
  title: string
  content: string
  score: number
}

export interface Retriever {
  index(docs: RetrievalDoc[]): Promise<void>
  search(query: string, topK: number): Promise<SearchHit[]>
  status(): { backend: 'tfidf' | 'embedding'; indexed: number }
}

// 中文 bigram + 英文单词 分词（零依赖）
function tokenize(text: string): string[] {
  const out: string[] = []
  const cleaned = text.replace(/\s+/g, ' ').trim()
  // 英文/数字单词
  for (const w of cleaned.match(/[a-zA-Z0-9_]{2,}/g) ?? []) out.push(w.toLowerCase())
  // 中文 bigram
  const cn = cleaned.replace(/[^\u4e00-\u9fff]/g, '')
  for (let i = 0; i < cn.length - 1; i++) out.push(cn.slice(i, i + 2))
  return out
}

// ---------- TF-IDF 检索器（默认，零依赖） ----------
export class TfidfRetriever implements Retriever {
  private docs: Array<{ id: number; title: string; content: string; tf: Map<string, number>; norm: number }> = []
  private df = new Map<string, number>()

  index(docs: RetrievalDoc[]): Promise<void> { this.indexNow(docs); return Promise.resolve() }
  indexNow(docs: RetrievalDoc[]): void {
    this.docs = []
    this.df = new Map()
    const allTerms = new Set<string>()
    for (const d of docs) {
      const tf = new Map<string, number>()
      for (const t of tokenize(d.title + ' ' + d.content.slice(0, 4000))) {
        tf.set(t, (tf.get(t) ?? 0) + 1)
        allTerms.add(t)
      }
      let norm = 0
      for (const [, f] of tf) norm += f * f
      this.docs.push({ id: d.id, title: d.title, content: d.content, tf, norm: Math.sqrt(norm) || 1 })
    }
    for (const t of allTerms) {
      let n = 0
      for (const d of this.docs) if (d.tf.has(t)) n++
      if (n > 0) this.df.set(t, n)
    }
  }

  search(query: string, topK: number): Promise<SearchHit[]> { return Promise.resolve(this.searchNow(query, topK)) }
  searchNow(query: string, topK: number): SearchHit[] {
    const qTerms = tokenize(query)
    if (qTerms.length === 0 || this.docs.length === 0) return []
    const N = this.docs.length
    const qf = new Map<string, number>()
    for (const t of qTerms) qf.set(t, (qf.get(t) ?? 0) + 1)
    const scored: Array<{ hit: SearchHit; score: number }> = []
    for (const d of this.docs) {
      let dot = 0
      for (const [t, f] of qf) {
        const df = this.df.get(t)
        if (!df) continue
        const idf = Math.log((N + 1) / (df + 1)) + 1
        dot += f * idf * (d.tf.get(t) ?? 0) * idf
      }
      if (dot > 0) {
        scored.push({
          hit: { id: d.id, title: d.title, content: d.content.slice(0, 800), score: dot / (Math.sqrt([...qf.values()].reduce((a, b) => a + b * b, 0)) * d.norm) },
          score: dot / d.norm
        })
      }
    }
    scored.sort((a, b) => b.score - a.score)
    return scored.slice(0, topK).map((s) => s.hit)
  }

  status(): { backend: 'tfidf'; indexed: number } {
    return { backend: 'tfidf', indexed: this.docs.length }
  }
}

// ---------- Embedding 检索器（预留升级位：SiliconFlow bge-m3 / OpenAI text-embedding-3） ----------
export interface EmbeddingProvider {
  embed(texts: string[]): Promise<number[][]>
}

export class EmbeddingRetriever implements Retriever {
  constructor(private provider: EmbeddingProvider) { void this.provider }
  async index(_docs: RetrievalDoc[]): Promise<void> {
    throw new Error('EmbeddingRetriever: 预留实现位（需配置 SiliconFlow/OpenAI embedding key）')
  }
  async search(_query: string, _topK: number): Promise<SearchHit[]> {
    return []
  }
  status(): { backend: 'embedding'; indexed: number } {
    return { backend: 'embedding', indexed: 0 }
  }
}

// ---------- 工厂：按设置选择后端（默认 TF-IDF；有 embedding provider 则升级） ----------
export function createRetriever(backend: 'tfidf' | 'embedding', provider?: EmbeddingProvider): Retriever {
  if (backend === 'embedding' && provider) return new EmbeddingRetriever(provider)
  return new TfidfRetriever()
}
