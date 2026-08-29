// utilityProcess server 生命周期（重构计划 R8 / spec §3.7）：
// 启动（数据目录/端口/token 环境注入）、ready 缓存补发（P11-1.2）、
// 异常退出清理与通知（v0.17.0 M16）、safeStorage 加解密中继（fail-closed，审查 H7/#24）。
import { app, BrowserWindow, utilityProcess, safeStorage } from 'electron'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { SERVER_TOKEN, getLastServerUrl, getServerProcess, setLastServerUrl, setServerProcess } from './state'

// P20（S2）：便携版数据目录统一（export/restore/wipe/open-data-dir 与 server 使用同一目录）
export function getDataDir(): string {
  if (process.env.PORTABLE_EXECUTABLE_DIR) {
    const d = join(process.env.PORTABLE_EXECUTABLE_DIR, 'data')
    try {
      mkdirSync(d, { recursive: true })
      return d
    } catch {
      /* 不可写时回退 userData */
    }
  }
  return app.getPath('userData')
}

function getServerEntry(): string {
  return join(__dirname, 'server.js')
}

export function startServer(): void {
  // P6-3 + P20（S2）：portable 版数据跟随可执行文件（与备份/恢复/清数据统一目录）
  // 随机端口（AI_NOVEL_PORT=0）——仅 dev（ELECTRON_RENDERER_URL 存在）固定 3000 供浏览器直连
  const userData = getDataDir()
  const serverProcess = utilityProcess.fork(getServerEntry(), [], {
    env: {
      ...(process.env as Record<string, string>),
      AI_NOVEL_USER_DATA: userData,
      AI_NOVEL_APP_VERSION: app.getVersion(),
      AI_NOVEL_PORT: process.env.ELECTRON_RENDERER_URL ? '3000' : '0',
      SERVER_TOKEN
    },
    serviceName: 'ai-novel-server',
    stdio: 'inherit'
  })
  setServerProcess(serverProcess)
  serverProcess.on('message', (msg: unknown) => {
    const m = msg as { type?: string; port?: number; error?: string; id?: string; value?: string }
    if (m?.type === 'ready' && typeof m.port === 'number') {
      console.log(`[main] server ready on http://127.0.0.1:${m.port}`)
      setLastServerUrl(`http://127.0.0.1:${m.port}/api`)
      const w = BrowserWindow.getAllWindows()[0] ?? null
      if (w && !w.webContents.isLoading()) {
        w.webContents.send('server-ready', getLastServerUrl())
      }
    } else if (m?.type === 'error') {
      console.error('[main] server error:', m.error)
    } else if ((m?.type === 'encrypt' || m?.type === 'decrypt') && typeof m.id === 'string') {
      handleCrypto(m as { type: 'encrypt' | 'decrypt'; id: string; value?: string })
    }
  })
  serverProcess.on('exit', (code) => {
    console.log(`[main] server process exited with code ${code}`)
    // v0.17.0（审查 M16）：异常退出清理 URL 并通知 renderer（此前只置 null——renderer 轮询已停 → 静默指向死服务）
    const wasAlive = getServerProcess() !== null
    setServerProcess(null)
    if (wasAlive && code !== 0 && getLastServerUrl()) {
      setLastServerUrl(null)
      for (const w of BrowserWindow.getAllWindows()) {
        w.webContents.send('server-lost', String(code))
      }
    }
  })
}

function handleCrypto(m: { type: 'encrypt' | 'decrypt'; id: string; value?: string }): void {
  const reply = (payload: Record<string, unknown>): void => {
    getServerProcess()?.postMessage({ type: 'crypto-result', id: m.id, ...payload })
  }
  try {
    if (m.type === 'encrypt' && m.value !== undefined) {
      if (!safeStorage.isEncryptionAvailable()) {
        // v0.17.0（审查 H7）：fail-closed——拒绝明文落库（此前降级回明文违反 #6；
        // Windows ready 后恒可用，此路径仅在异常环境触发）
        console.error('[crypto] safeStorage 不可用——拒绝以明文存储 API Key（请检查系统环境后重试）')
        reply({ error: 'safeStorage unavailable: refusing to store plaintext key' })
        return
      }
      reply({ value: safeStorage.encryptString(m.value).toString('base64') })
    } else if (m.type === 'decrypt' && m.value !== undefined) {
      if (!m.value) {
        reply({ value: m.value })
        return
      }
      if (!safeStorage.isEncryptionAvailable()) {
        // v0.9.0（审查 #24）：解密侧不可用——密文不可解密，显式报错而非把密文当 key 直传
        console.error('[crypto] safeStorage 不可用——无法解密已加密的密钥（可能系统 keyring 被锁/环境变化）')
        reply({ error: 'safeStorage unavailable: cannot decrypt key' })
        return
      }
      reply({ value: safeStorage.decryptString(Buffer.from(m.value, 'base64')) })
    }
  } catch (err) {
    reply({ error: String(err) })
  }
}
