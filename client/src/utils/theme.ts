// P13 F0：主题管理（多主题：deepblue 默认 / feelfish-green / purple-night / ocean / amber / paper）

export const THEMES = [
  { key: 'deepblue', label: '墨蓝', preview: ['#0e0f13', '#4f7cff'] },
  { key: 'feelfish-green', label: 'FeelFish 绿', preview: ['#101010', '#00a060'] },
  { key: 'purple-night', label: '紫夜', preview: ['#14121e', '#8b7cf6'] },
  { key: 'ocean', label: '深海青', preview: ['#0e1720', '#4db9d8'] },
  { key: 'amber', label: '琥珀', preview: ['#1a1410', '#ffb86c'] },
  { key: 'paper', label: '纸张·亮', preview: ['#f6f8f5', '#008c52'] }
] as const

export type ThemeKey = (typeof THEMES)[number]['key']

const THEME_KEY = 'ai-novel.theme'

export function getStoredTheme(): ThemeKey {
  try {
    const t = localStorage.getItem(THEME_KEY) as ThemeKey | null
    return t && THEMES.some((x) => x.key === t) ? t : 'deepblue'
  } catch {
    return 'deepblue'
  }
}

export function applyTheme(theme: ThemeKey): void {
  document.documentElement.setAttribute('data-theme', theme)
  try {
    localStorage.setItem(THEME_KEY, theme)
  } catch {
    /* ignore */
  }
  // 同步原生界面（nativeTheme + 标题栏 overlay）
  void window.novelStudio?.setTheme(theme).catch(() => undefined)
}

export function initTheme(): void {
  applyTheme(getStoredTheme())
}
