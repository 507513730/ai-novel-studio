// 独立 userData、真实 preload/服务与零模型调用的章节页验收。
const { app, BrowserWindow } = require('electron')
const { mkdtempSync, mkdirSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')
const { captureWithRetry } = require('./capture.cjs')
const root = join(__dirname, '../..')
const data = mkdtempSync(join(root, 'release/workspace-ui-'))
app.setPath('userData', data)
app.setPath('sessionData', data)
delete process.env.ELECTRON_RENDERER_URL
delete process.env.PORTABLE_EXECUTABLE_DIR
delete process.env.AI_NOVEL_ALLOW_PLAINTEXT
BrowserWindow.prototype.show = function () {}
let started = false
const checks = []
const timer = setTimeout(() => finish(1, 'timeout'), 120000)
function finish(code, message) {
  clearTimeout(timer)
  writeFileSync(join(data, 'evidence.json'), JSON.stringify({ code, message, checks, data, packaged: process.env.E2E_PACKAGED === '1' }, null, 2), 'utf8')
  console.log(JSON.stringify({ code, message, checks, data }))
  app.once('will-quit', () => app.exit(code))
  app.quit()
}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
app.on('browser-window-created', (_, win) => {
  win.webContents.setBackgroundThrottling(false)
  win.webContents.on('did-finish-load', async () => {
    if (started) return
    started = true
    const js = code => win.webContents.executeJavaScript(code)
    const wait = async code => {
      for (let i = 0; i < 60; i++) { if (await js(code)) return; await delay(200) }
      throw Error('UI 未到达预期状态：' + code)
    }
    try {
      await wait('Boolean(window.novelStudio?.serverToken)')
      let config
      for (let i = 0; i < 60; i++) {
        config = await js('(async()=>({base:await window.novelStudio.getServerUrl(),token:window.novelStudio.serverToken}))()')
        if (config.base) break
        await delay(200)
      }
      const api = async (path, method = 'GET', body) => {
        const r = await fetch(config.base + path, { method, headers: { 'Content-Type': 'application/json', 'X-App-Token': config.token }, body: body ? JSON.stringify(body) : undefined })
        if (!r.ok) throw Error(path + ' HTTP ' + r.status)
        return r.json()
      }
      // 假凭证仅为越过首启配置，真实 safeStorage 加密；测试从不请求该供应商。
      await api('/settings/providers', 'POST', { name: '界面测试供应商', baseUrl: 'http://127.0.0.1:1', apiKey: 'ui-test-not-a-real-key' })
      const novel = await api('/novels', 'POST', { title: '山海来信', inspiration: '隔离的界面测试书' })
      const a = await api(`/novels/${novel.id}/chapters`, 'POST', { title: '第十二章 · 山雨欲来' })
      const b = await api(`/novels/${novel.id}/chapters`, 'POST', { title: '第十三章 · 灯下故人' })
      const text = '山风卷过石阶，灯火忽明忽暗。他停在门前，听见屋内传来第二个人的呼吸声。\n\n门缝里漏出的光将信纸照成淡淡的金色。她没有催促，只把茶盏向对面推了半寸。\n\n“你来得比约定晚了一天。”\n\n他解下湿透的斗篷，从内袋取出那封始终没有拆开的信。'
      await api(`/novels/${novel.id}/chapters/${a.id}`, 'PATCH', { content: text, expectedContent: '', operationId: require('node:crypto').randomUUID(), summary: '揭示来客身份，以一封旧信推进两人的关系。保持克制，留出悬念。', status: 'written' })
      await api(`/novels/${novel.id}/chapters/${b.id}`, 'PATCH', { content: '第二章原稿', expectedContent: '', operationId: require('node:crypto').randomUUID(), status: 'written' })
      await js(`location.hash='/novels/${novel.id}/chapters'; location.reload()`)
      await wait("Boolean(document.querySelector('.chapter-workspace .cm-content'))")
      await wait("document.querySelector('.cm-content')?.textContent.includes('山风')")
      win.setMinimumSize(600, 500)
      win.setSize(1500, 960)
      await delay(500)
      const capture = async name => {
        await js('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
        await delay(200)
        const shot = await captureWithRetry(() => win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true }))
        writeFileSync(join(data, name + '.png'), shot.image.toPNG())
      }
      await capture('desktop-dark')
      if (!await js("getComputedStyle(document.querySelector('.workspace-assistant')).display !== 'none'")) throw Error('桌面助手不可见')
      checks.push('桌面三栏与正文加载')
      await js("document.querySelector('[role=tab]:last-child').click()")
      await wait("document.querySelector('[role=tab][aria-selected=true]')?.textContent==='版本'")
      checks.push('版本页签切换')
      await js("document.querySelector('[role=tab]:first-child').click(); document.documentElement.setAttribute('data-theme','paper')")
      await delay(300)
      await capture('desktop-paper')
      win.setSize(920, 800)
      await delay(400)
      if (!await js("getComputedStyle(document.querySelector('.workspace-assistant')).display === 'none'")) throw Error('窄窗口未收起助手')
      await js("Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='助手').click()")
      if (!await js("getComputedStyle(document.querySelector('.workspace-assistant')).display !== 'none'")) throw Error('助手抽屉未打开')
      await capture('narrow-assistant')
      checks.push('窄窗口收栏与助手抽屉')
      await js("Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='专注').click()")
      if (await js("Boolean(document.querySelector('.workspace-assistant'))")) throw Error('专注模式未隐藏助手')
      checks.push('专注模式')
      await js("document.querySelector('.cm-content').focus()")
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'A', modifiers: ['control'] })
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'A', modifiers: ['control'] })
      await win.webContents.insertText('用户手写的新正文')
      await wait("document.querySelector('.chapter-save-status')?.textContent==='未保存'")
      await js("Array.from(document.querySelectorAll('.chapter-toolbar button')).find(b=>b.textContent==='保存').click()")
      await wait("document.querySelector('.chapter-save-status')?.textContent==='已保存'")
      const saved = await api(`/novels/${novel.id}/chapters/${a.id}`)
      if (saved.chapter.content !== '用户手写的新正文') throw Error('正文保存不一致')
      checks.push('真实 CodeMirror 输入、保存反馈与服务端正文一致')
      await api(`/novels/${novel.id}/chapters/${a.id}`, 'PATCH', {
        content: '其他操作保存的正文', expectedContent: '用户手写的新正文', operationId: require('node:crypto').randomUUID()
      })
      await js("document.querySelector('.cm-content').focus()")
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'A', modifiers: ['control'] })
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'A', modifiers: ['control'] })
      await win.webContents.insertText('需要保留的冲突人工稿')
      await wait("document.querySelector('.chapter-save-status')?.textContent==='未保存'")
      await js("Array.from(document.querySelectorAll('.chapter-toolbar button')).find(b=>b.textContent==='保存').click()")
      await wait("document.querySelector('.chapter-save-status')?.textContent==='保存失败'")
      await js("Array.from(document.querySelectorAll('.chapter-toolbar button')).find(b=>b.textContent==='保存草稿副本并载入最新正文').click()")
      await wait("document.querySelector('.chapter-save-status')?.textContent==='已保存' && document.querySelector('.cm-content')?.textContent==='其他操作保存的正文'")
      const versions = await api(`/novels/${novel.id}/chapters/${a.id}/versions`)
      if (!versions.versions.some(v => v.preview === '需要保留的冲突人工稿')) throw Error('冲突人工稿未保留为版本')
      checks.push('真实保存冲突：人工稿存版本后加载服务端正文')
      finish(0, '章节页界面验收通过')
    } catch (error) { finish(1, error.message) }
  })
})
mkdirSync(data, { recursive: true })
require(process.env.E2E_PACKAGED === '1' ? join(root, 'release/win-unpacked/resources/app.asar/out/main/index.js') : join(root, 'out/main/index.js'))
