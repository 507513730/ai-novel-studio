import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App } from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import { ToastProvider, toastGlobal } from './components/Toast'
import { initTheme } from './utils/theme'
import { initFonts } from './utils/fonts'
import './index.css'

// P13 F0：主题在 React 渲染前应用（防闪烁）
initTheme()
// P22-A：字体与排版同样前置应用（防字体闪变）
initFonts()

// E3 全局 unhandledrejection 兜底（P9 B6：用户可见提示）
window.addEventListener('unhandledrejection', (e) => {
  const reason = e.reason
  const msg =
    reason instanceof Error ? reason.message : typeof reason === 'string' ? reason : '未知错误'
  console.error('[unhandledrejection]', reason)
  // v0.9.0（审查 C）：AbortSignal.timeout 抛 TimeoutError——与用户取消语义一致，不弹误报提示
  if (!/AbortError|aborted|TimeoutError|timed out/i.test(msg)) {
    toastGlobal('error', `操作失败：${msg}`)
  }
})

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false }
  }
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <App />
        </ToastProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>
)
