// v0.18.0：联网查找（零 key 优先——Wikipedia action API 为主；DDG Instant Answer 无结果弃用）
// 用途：知识库「联网搜索」导入 + 导演/世界观生成可选注入
// 纪律：5s 超时、失败返回空（abort 静默 / HTTP 与网络错误 warn 一次）、模块级缓存（TTL 1h）——离线环境零影响

import type { DatabaseSync } from 'node:sqlite'
import { getAppSetting, setAppSetting } from './appSettings'
import { stripHtmlTags } from './sanitize'

export interface WebSearchResult {
  title: string
  snippet: string
  url: string
  /** 详情正文（top1 条目 exintro 摘要；可能为空） */
  excerpt?: string
}

const TIMEOUT_MS = 5000
const CACHE_TTL_MS = 60 * 60 * 1000

const cache = new Map<string, { at: number; results: WebSearchResult[] }>()

export function isWebSearchEnabled(db: DatabaseSync): boolean {
  return getAppSetting(db, 'web_search_enabled') === '1'
}

export function setWebSearchEnabled(db: DatabaseSync, on: boolean): void {
  setAppSetting(db, 'web_search_enabled', on ? '1' : '0')
}

type FetchJsonResult =
  | { ok: true; data: Record<string, unknown> | null }
  | { ok: false }

// v0.21.0（审查 P3 LOW）：区分失败原因——abort（5s 超时）静默；
// HTTP 非 2xx 与网络错误 console.warn 一次（此前 catch 全吞，问题无从排查）
async function fetchJson(url: string): Promise<FetchJsonResult> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'AI-Novel-Studio/0.18 (+local desktop app)' }
    })
    if (!res.ok) {
      console.warn(`[webSearch] HTTP ${res.status}：${url}`)
      return { ok: false }
    }
    return { ok: true, data: (await res.json()) as Record<string, unknown> }
  } catch {
    if (!ctrl.signal.aborted) {
      console.warn(`[webSearch] 请求失败：${url}`)
    }
    return { ok: false }
  } finally {
    clearTimeout(timer)
  }
}

/** Wikipedia 搜索（zh 优先；srlimit=4）——零 key；failed=true 表示请求层失败（区别于"无结果"） */
async function searchWikipedia(query: string, lang: string): Promise<{ hits: WebSearchResult[]; failed: boolean }> {
  const url = `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(
    query
  )}&format=json&srlimit=4&srprop=snippet`
  const r = await fetchJson(url)
  if (!r.ok) return { hits: [], failed: true }
  const hits = ((r.data as { query?: { search?: Array<{ title: string; snippet: string }> } })?.query?.search ?? []).map(
    (s) => ({
      title: String(s.title),
      // 去除搜索高亮标记（CodeQL：用逐字符扫描替代不完整正则剥离）
      snippet: stripHtmlTags(String(s.snippet ?? '')),
      url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(String(s.title).replace(/\s+/g, '_'))}`
    })
  )
  return { hits, failed: false }
}

/** 取 top1 条目的引言摘要（exintro，正文素材） */
async function fetchExcerpt(title: string, lang: string): Promise<string> {
  const url = `https://${lang}.wikipedia.org/w/api.php?action=query&prop=extracts&exintro=1&explaintext=1&titles=${encodeURIComponent(
    title
  )}&format=json`
  const r = await fetchJson(url)
  if (!r.ok) return ''
  const pages = (r.data as { query?: { pages?: Record<string, { extract?: string }> } })?.query?.pages ?? {}
  for (const p of Object.values(pages)) {
    const ex = p?.extract
    if (ex && ex.length > 0) return ex.slice(0, 2500)
  }
  return ''
}

/**
 * 联网搜索（中文优先，英文兜底）。
 * 返回结构：results（列表）+ excerpt（top1 摘要，用于知识库正文导入）。
 */
export async function searchWeb(db: DatabaseSync, query: string): Promise<{ results: WebSearchResult[]; excerpt: string }> {
  const q = query.trim().slice(0, 120)
  if (!q) return { results: [], excerpt: '' }
  if (!isWebSearchEnabled(db)) return { results: [], excerpt: '' }

  const cached = cache.get(q)
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return { results: cached.results, excerpt: cached.results[0]?.excerpt ?? '' }
  }

  const zh = await searchWikipedia(q, 'zh')
  // v0.21.0（审查 P3 LOW）：仅"zh 无结果"才降级 en——zh 请求失败（abort/网络/HTTP）直接返回空，
  // 不再触发 en 兜底请求（en 大概率同样失败，避免双重请求与双重日志）
  let results: WebSearchResult[]
  if (zh.failed) {
    results = []
  } else if (zh.hits.length > 0) {
    results = zh.hits
  } else {
    results = (await searchWikipedia(q, 'en')).hits
  }
  let excerpt = ''
  if (results.length > 0) {
    const ex = await fetchExcerpt(results[0].title, results[0].url.includes('/zh.wikipedia') ? 'zh' : 'en')
    if (ex) {
      results[0].excerpt = ex
      excerpt = ex
    }
  }
  cache.set(q, { at: Date.now(), results })
  return { results, excerpt }
}

/** 供 world/characters 生成注入：把搜索结果拼成设定参考文本（上限 ~2000 字，含摘要） */
export async function buildWebContextBlock(db: DatabaseSync, query: string, maxChars = 2000): Promise<string> {
  if (!isWebSearchEnabled(db)) return ''
  const { results, excerpt } = await searchWeb(db, query)
  if (results.length === 0) return ''
  const parts = results.map((r) => `- ${r.title}：${r.snippet.slice(0, 200)}`)
  const body = excerpt.slice(0, maxChars - parts.join('\n').length - 100)
  return `【联网资料（Wikipedia）】\n${parts.join('\n')}${body ? `\n\n资料摘要：${body}` : ''}`
}
