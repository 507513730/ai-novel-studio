import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App } from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import { ToastProvider, toastGlobal } from './components/Toast'
import { initTheme } from './utils/theme'
import './index.css'

// P13 F0：主题在 React 渲染前应用（防闪烁）
initTheme()

// E3 全局 unhandledrejection 兜底（P9 B6：用户可见提示）
window.addEventListener('unhandledrejection', (e) => {
  const reason = e.reason
  const msg =
    reason instanceof Error ? reason.message : typeof reason === 'string' ? reason : '未知错误'
  console.error('[unhandledrejection]', reason)
  if (!/AbortError|aborted/i.test(msg)) {
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
