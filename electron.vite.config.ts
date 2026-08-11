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
