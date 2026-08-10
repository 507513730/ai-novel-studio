const { app, utilityProcess } = require('electron')
const { join } = require('node:path')

app.whenReady().then(() => {
  const child = utilityProcess.fork(join(__dirname, '../out/main/server.js'), [], {
    serviceName: 'probe-server',
    stdio: 'inherit',
    env: {
      ...process.env,
      AI_NOVEL_USER_DATA: join(__dirname, '../server/data-probe')
    }
  })
  child.on('message', (msg) => {
    console.log('[main] got message', JSON.stringify(msg))
  })
  child.on('exit', (code) => {
    console.log('[main] server exited with code', code)
    app.quit()
  })
  setTimeout(() => {
    console.log('[main] server still alive after 6s (loop held)')
    child.kill()
  }, 6000)
})
