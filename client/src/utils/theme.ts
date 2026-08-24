// P13 F0：主题管理（多主题：deepblue 默认 / feelfish-green / purple-night / ocean / amber / paper / sepia）
// v0.24.4（A7）：支持「跟随系统」偏好（system → prefers-color-scheme 映射 暗=deepblue / 亮=paper）

export const THEMES = [
  { key: 'deepblue', label: '墨蓝', preview: ['#0e0f13', '#4f7cff'] },
  { key: 'feelfish-green', label: 'FeelFish 绿', preview: ['#101010', '#00a060'] },
  { key: 'purple-night', label: '紫夜', preview: ['#14121e', '#8b7cf6'] },
  { key: 'ocean', label: '深海青', preview: ['#0e1720', '#4db9d8'] },
  { key: 'amber', label: '琥珀', preview: ['#1a1410', '#ffb86c'] },
  { key: 'paper', label: '纸张·亮', preview: ['#f6f8f5', '#008c52'] },
  { key: 'sepia', label: '暖色文学', preview: ['#f4ecd8', '#a06a2c'] }
] as const

export type ThemeKey = (typeof THEMES)[number]['key']
export type ThemePreference = ThemeKey | 'system'

const THEME_KEY = 'ai-novel.theme'
const DARK_KEY: ThemeKey = 'deepblue'
const LIGHT_KEY: ThemeKey = 'paper'

function systemDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches === true
}

export function getStoredTheme(): ThemePreference {
  try {
    const t = localStorage.getItem(THEME_KEY) as ThemePreference | null
    return t && (t === 'system' || THEMES.some((x) => x.key === t)) ? t : 'deepblue'
  } catch {
    return 'deepblue'
  }
}

/** system 偏好解析为实际主题键（跟随系统配色） */
export function resolveTheme(pref: ThemePreference): ThemeKey {
  return pref === 'system' ? (systemDark() ? DARK_KEY : LIGHT_KEY) : pref
}

export function applyTheme(pref: ThemePreference): void {
  const resolved = resolveTheme(pref)
  document.documentElement.setAttribute('data-theme', resolved)
  try {
    localStorage.setItem(THEME_KEY, pref)
  } catch {
    /* ignore */
  }
  // 同步原生界面（nativeTheme + 标题栏 overlay）
  void window.novelStudio?.setTheme(pref === 'system' ? (systemDark() ? DARK_KEY : LIGHT_KEY) : pref).catch(() => undefined)
}

export function initTheme(): void {
  applyTheme(getStoredTheme())
  // 跟随系统：监听系统配色变化
  if (typeof window !== 'undefined' && window.matchMedia) {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (): void => {
      if (getStoredTheme() === 'system') applyTheme('system')
    }
    try {
      mq.addEventListener?.('change', onChange)
    } catch {
      /* older browsers */
    }
  }
}
