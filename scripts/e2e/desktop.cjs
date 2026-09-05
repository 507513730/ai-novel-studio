const { app, BrowserWindow } = require('electron')
const { mkdtempSync, mkdirSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')
const { spawn } = require('node:child_process')
const root = join(__dirname, '../..')
const output = join(root, 'release')
mkdirSync(output, { recursive: true })
const data = mkdtempSync(join(output, 'release-e2e-'))
app.setPath('userData', data)
app.setPath('sessionData', data)
delete process.env.PORTABLE_EXECUTABLE_DIR
delete process.env.ELECTRON_RENDERER_URL
delete process.env.AI_NOVEL_ALLOW_PLAINTEXT
BrowserWindow.prototype.show = function () {}
let started = false
let child
let finished = false
const timer = setTimeout(() => finish(1, 'test timeout'), 40 * 60 * 1000)
function finish(code, message) {
  if (finished) return
  finished = true
  clearTimeout(timer)
  if (child && child.exitCode === null) child.kill()
  writeFileSync(join(data, 'result.json'), JSON.stringify({ code, message, data, version: require('../../package.json').version }))
  console.log('[isolated-e2e]', message, 'code=' + code, 'data=' + data)
  if (process.env.E2E_RESULT_FILE) {
    writeFileSync(process.env.E2E_RESULT_FILE, JSON.stringify({ code, message, data }))
  }
  app.once('will-quit', () => app.exit(code))
  app.quit()
}
app.on('browser-window-created', (_, win) => {
  win.webContents.on('did-finish-load', async () => {
    if (started) return
    started = true
    try {
      let config
      for (let i = 0; i < 80; i++) {
        config = await win.webContents.executeJavaScript('(async () => ({base: await window.novelStudio.getServerUrl(), token: window.novelStudio.serverToken}))()')
        if (config.base && config.token) break
        await new Promise(r => setTimeout(r, 250))
      }
      if (!config?.base || !config.token) throw Error('renderer IPC bootstrap failed')
      const base = config.base.replace(/\/$/, '')
      const headers = { 'Content-Type': 'application/json', 'X-App-Token': config.token }
      async function api(path, method='GET', body) {
        const response = await fetch(base + path, {method, headers, body: body ? JSON.stringify(body) : undefined})
        const result = await response.json()
        if (!response.ok) throw Error(path + ': HTTP ' + response.status + ' ' + (result.error ?? ''))
        return result
      }
      const health = await api('/health')
      if (!health.ok) throw Error('health check failed')
      const noToken = await fetch(base + '/health', {headers: {Origin:'null'}})
      if (noToken.status !== 403) throw Error('missing token must return 403')
      const image = await win.webContents.capturePage()
      writeFileSync(join(data, 'renderer.png'), image.toPNG())
      const imported = await api('/settings/import-opencode', 'POST', {provider:'opencode-go'})
      const routes = await api('/settings/model-routes')
      for (const route of routes.routes) {
        await api('/settings/model-routes/' + route.taskType, 'PUT', {providerId: imported.id, model:'deepseek-v4-flash', thinkingEnabled:false, maxTokens:8192})
      }
      console.log('[isolated-e2e] bootstrap, token guard, encrypted credential import ready')
      if (process.env.E2E_SMOKE_ONLY === '1') {
        const novel = await api('/novels', 'POST', { inspiration: '打包态独立冒烟：雨夜守灯人' })
        const created = await api('/novels/' + novel.id + '/chapters', 'POST', { title: '雨夜来客' })
        const chapterId = created.id ?? created.chapterId ?? created.chapter?.id
        if (!chapterId) throw Error('chapter creation failed')
        const path = '/novels/' + novel.id + '/chapters/' + chapterId
        const response = await fetch(base + path + '/generate', {
          method: 'POST', headers, body: JSON.stringify({ guidance: '三百字以内，有完整场景。', tripleReview: false })
        })
        const text = await response.text()
        if (!response.ok || !text.includes('event: done')) throw Error('packaged SSE generation failed')
        const exported = await fetch(base + '/novels/' + novel.id + '/export?format=txt', { headers })
        if (!exported.ok || !(await exported.text()).trim()) throw Error('packaged export failed')
        finish(0, 'packaged IPC/auth/SSE/export PASS')
        return
      }
      child = spawn(process.env.SYSTEM_NODE_EXE, [join(root,'scripts/e2e/round.mjs'),'1'], {
        cwd:root,
        env:{...process.env,E2E_BASE_URL:base,E2E_APP_TOKEN:config.token,E2E_REPORT:join(data,'round-report.md')},
        stdio:['ignore','inherit','inherit'], windowsHide:true
      })
      child.once('error', e => finish(1,e.message))
      child.once('exit', code => finish(code ?? 1, 'T1-T5 completed'))
    } catch (error) { finish(1,error.message) }
  })
})
require(process.env.E2E_PACKAGED === '1'
  ? join(root, 'release/win-unpacked/resources/app.asar/out/main/index.js')
  : join(root, 'out/main/index.js'))
