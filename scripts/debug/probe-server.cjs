const http = require('node:http')

const server = http.createServer((req, res) => {
  res.end('ok')
})
server.listen(0, '127.0.0.1', () => {
  const port = server.address().port
  console.log('[probe] listening on', port)
  if (process.parentPort) {
    process.parentPort.postMessage({ type: 'ready', port })
  }
})
console.log('[probe] module loaded, parentPort =', typeof process.parentPort)
