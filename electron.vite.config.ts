import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/main',
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'electron/main.ts'),
          server: resolve(__dirname, 'server/src/index.ts')
        }
      }
    },
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'shared/src')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/preload',
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'electron/preload.ts')
        }
      }
    }
  },
  renderer: {
    root: 'client',
    plugins: [react()],
    // 版本单一来源：package.json（npm_package_version 由 pnpm/npm 注入）
    define: {
      __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? '0.0.0')
    },
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'shared/src'),
        '@': resolve(__dirname, 'client/src')
      }
    },
    build: {
      outDir: 'out/renderer',
      rollupOptions: {
        input: resolve(__dirname, 'client/index.html'),
        // P20（U4）：分包——react/codemirror/lucide 独立 chunk（4.4MB 单包拆分为缓存友好多包）
        // v0.23.1（批次 E6）：@codemirror/language/state/view 显式声明为直接依赖
        // （此前是 @uiw/react-codemirror 的传递依赖，靠 pnpm shamefully-hoist 才可解析——脆弱）
        output: {
          manualChunks: {
            react: ['react', 'react-dom', 'react-router-dom', '@tanstack/react-query'],
            codemirror: ['@codemirror/lang-markdown', '@codemirror/language', '@codemirror/state', '@codemirror/view'],
            icons: ['lucide-react']
          }
        }
      }
    }
  }
})
