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
    // v0.17.0（审查 M2）：fail-closed——非 utility 模式拒绝明文落库（违反 #6）；
    // 显式调试开关 AI_NOVEL_ALLOW_PLAINTEXT=1 才允许（独立调试/测试用）
    if (process.env.AI_NOVEL_ALLOW_PLAINTEXT !== '1') {
      throw new Error('keyCrypto: 非 utilityProcess 环境拒绝明文存储 API Key（调试可设 AI_NOVEL_ALLOW_PLAINTEXT=1）')
    }
    console.warn('[keyCrypto] AI_NOVEL_ALLOW_PLAINTEXT=1：API Key 将以明文存储（仅限独立调试）')
    return plain
  }
  return requestCrypto('encrypt', plain)
}

export async function decryptSecret(encrypted: string): Promise<string> {
  if (!isUtilityProcess()) {
    if (process.env.AI_NOVEL_ALLOW_PLAINTEXT !== '1') {
      throw new Error('keyCrypto: 非 utilityProcess 环境拒绝按明文读取（调试可设 AI_NOVEL_ALLOW_PLAINTEXT=1）')
    }
    console.warn('[keyCrypto] AI_NOVEL_ALLOW_PLAINTEXT=1：按明文读取 API Key（仅限独立调试）')
    return encrypted
  }
  return requestCrypto('decrypt', encrypted)
}
