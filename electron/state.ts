// Electron 主进程共享状态（重构计划 R8）：窗口/server 进程/server URL/鉴权 token 的唯一存放点。
// 各模块经 getter 读取、setter 写入——替代原 main.ts 的模块级可变变量网。
import { randomBytes } from 'node:crypto'
import type { BrowserWindow, UtilityProcess } from 'electron'

let mainWindow: BrowserWindow | null = null
let serverProcessRef: UtilityProcess | null = null
// P11-1.2：缓存 server URL（防 server-ready 早于 renderer 监听导致消息丢失）
let lastServerUrlValue: string | null = null
// P20（S1）：renderer 调用本地 API 的鉴权 token（经 preload 注入，恶意网页拿不到）
export const SERVER_TOKEN = randomBytes(32).toString('hex')

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}
export function setMainWindow(w: BrowserWindow | null): void {
  mainWindow = w
}
export function getServerProcess(): UtilityProcess | null {
  return serverProcessRef
}
export function setServerProcess(sp: UtilityProcess | null): void {
  serverProcessRef = sp
}
export function getLastServerUrl(): string | null {
  return lastServerUrlValue
}
export function setLastServerUrl(url: string | null): void {
  lastServerUrlValue = url
}
