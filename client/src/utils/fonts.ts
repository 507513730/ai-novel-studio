// P22-A：字体与排版设置（localStorage 持久化 + CSS 变量驱动，即时生效）
// 与主题机制（utils/theme.ts）同模式：直接设置 document.documentElement 的 CSS 变量

export interface FontSettings {
  // 正文字体 key（见 SERIF_FONTS）
  prose: string
  // 编辑器字体：'prose'（跟随正文）| 'mono'（等宽）
  editor: 'prose' | 'mono'
  // P27 0d：界面字体 key（见 UI_FONTS）
  ui: string
  // 排版
  indent: boolean // 首行缩进 2 字符
  lineHeight: number // 1.5 - 2.2
  fontSize: number // 14 - 18
  maxWidth: boolean // 阅读宽度 720px 居中
}

export interface FontOption {
  key: string
  label: string
  stack: string
  desc?: string
}

// P27 0d：界面字体选项（应用于 --font-sans，全站界面）
export const UI_FONTS: FontOption[] = [
  { key: 'system', label: '系统默认', stack: "'HarmonyOS Sans SC', 'PingFang SC', 'Microsoft YaHei', 'Segoe UI', system-ui, sans-serif", desc: '默认字体栈' },
  { key: 'yahei', label: '微软雅黑', stack: "'Microsoft YaHei', system-ui, sans-serif", desc: 'Windows 默认' },
  { key: 'simhei', label: '黑体', stack: "'SimHei', system-ui, sans-serif", desc: 'Windows 自带黑体' },
  { key: 'noto-sans', label: '思源黑体', stack: "'Noto Sans SC', 'Microsoft YaHei', system-ui, sans-serif", desc: '打包开源字体' }
]

export const SERIF_FONTS: FontOption[] = [
  { key: 'lxgw', label: '霞鹜文楷', stack: "'LXGW WenKai', 'KaiTi', 'SimSun', serif", desc: '开源楷体，网文写作手感（默认）' },
  { key: 'noto-serif', label: '思源宋体', stack: "'Noto Serif SC', 'SimSun', serif", desc: '宋体出版感' },
  { key: 'noto-sans', label: '思源黑体', stack: "'Noto Sans SC', 'Microsoft YaHei', sans-serif", desc: '黑体现代感' },
  { key: 'kai', label: '系统楷体', stack: "'KaiTi', 'STKaiti', serif", desc: 'Windows 自带楷体' },
  { key: 'song', label: '系统宋体', stack: "'SimSun', 'STSong', serif", desc: 'Windows 自带宋体' },
  { key: 'fangsong', label: '仿宋', stack: "'FangSong', 'STFangsong', serif", desc: 'Windows 自带仿宋' },
  { key: 'yahei', label: '微软雅黑', stack: "'Microsoft YaHei', sans-serif", desc: 'Windows 默认黑体' },
  { key: 'system', label: '系统默认', stack: "system-ui, sans-serif", desc: '跟随操作系统' }
]

const STORAGE_KEY = 'ai-novel.fonts'

export const DEFAULTS: FontSettings = {
  prose: 'lxgw',
  editor: 'prose',
  ui: 'system',
  indent: true,
  lineHeight: 1.75,
  fontSize: 15,
  maxWidth: true
}

export function getStoredFonts(): FontSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<FontSettings>
      return { ...DEFAULTS, ...parsed }
    }
  } catch {
    /* 损坏则回退默认 */
  }
  return { ...DEFAULTS }
}

function fontStack(settings: FontSettings): string {
  const opt = SERIF_FONTS.find((f) => f.key === settings.prose)
  return opt?.stack ?? SERIF_FONTS[0].stack
}

/** 应用字体与排版到 CSS 变量（CodeMirror 与全局同时生效） */
export function applyFonts(settings: FontSettings): void {
  const root = document.documentElement
  root.style.setProperty('--font-serif', fontStack(settings))
  // P27 0d：界面字体（--font-sans）
  const uiOpt = UI_FONTS.find((f) => f.key === settings.ui)
  if (uiOpt) root.style.setProperty('--font-sans', uiOpt.stack)
  root.style.setProperty('--prose-font-size', `${settings.fontSize}px`)
  root.style.setProperty('--prose-line-height', String(settings.lineHeight))
  root.style.setProperty('--prose-indent', settings.indent ? '2em' : '0')
  root.style.setProperty('--prose-max-width', settings.maxWidth ? '720px' : 'none')
  // 编辑器字体跟随
  const editorStack =
    settings.editor === 'prose'
      ? fontStack(settings)
      : "'JetBrains Mono', 'Cascadia Code', 'Consolas', monospace"
  root.style.setProperty('--font-editor', editorStack)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
}

export function initFonts(): FontSettings {
  const settings = getStoredFonts()
  applyFonts(settings)
  return settings
}
