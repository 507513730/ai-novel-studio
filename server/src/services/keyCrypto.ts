import { isUtilityProcess } from '../env'

const pending = new Map<string, { resolve: (v: string) => void; reject: (e: Error) => void }>()
let seq = 0

const CRYPTO_TIMEOUT_MS = 5000

function requestCrypto(type: 'encrypt' | 'decrypt', value: string): Promise<string> {
  const id = `crypto-${++seq}`
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error(`crypto ${type} 超时（主进程未响应，${CRYPTO_TIMEOUT_MS}ms）`))
    }, CRYPTO_TIMEOUT_MS)
    pending.set(id, {
      resolve: (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      reject: (e) => {
        clearTimeout(timer)
        reject(e)
      }
    })
    ;(process.parentPort as unknown as {
      postMessage: (msg: unknown) => void
    }).postMessage({ type, id, value })
  })
}

if (isUtilityProcess()) {
  process.parentPort.on('message', (e: { data: unknown }) => {
    const msg = e.data as { type?: string; id?: string; value?: string; error?: string }
    if (msg?.type !== 'crypto-result' || !msg.id) return
    const entry = pending.get(msg.id)
    if (!entry) return
    pending.delete(msg.id)
    if (msg.error) entry.reject(new Error(msg.error))
    else entry.resolve(msg.value ?? '')
  })
}

export async function encryptSecret(plain: string): Promise<string> {
  if (!isUtilityProcess()) {
    // P2.2 🟡8：非 utilityProcess（独立调试）→ 明文回退 + 告警
    console.warn('[keyCrypto] 非 utilityProcess 环境，API Key 将以明文存储（仅限独立调试）')
    return plain
  }
  return requestCrypto('encrypt', plain)
}

export async function decryptSecret(encrypted: string): Promise<string> {
  if (!isUtilityProcess()) {
    console.warn('[keyCrypto] 非 utilityProcess 环境，按明文读取 API Key（仅限独立调试）')
    return encrypted
  }
  return requestCrypto('decrypt', encrypted)
}
