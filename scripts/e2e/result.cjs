const { writeFileSync } = require('node:fs')

function writeRunResult(primary, mirror, result) {
  if (result.code === 0) readRunResult(result)
  const serialized = JSON.stringify(result)
  writeFileSync(primary, serialized, 'utf8')
  if (mirror && mirror !== primary) writeFileSync(mirror, serialized, 'utf8')
}

function readRunResult(result, expectedVersion) {
  if (expectedVersion !== undefined && result.version !== expectedVersion) throw Error('运行结果版本不匹配')
  if (result.code !== 0) throw Error('运行未成功完成')
  if (result.rendererReady !== true || !Number.isInteger(result.captureAttempts) || result.captureAttempts < 1 || result.captureAttempts > 3) {
    throw Error('运行结果缺少真实绘制/截图证据')
  }
  return { code: 0, rendererReady: true, captureAttempts: result.captureAttempts, diagnostics: result.diagnostics ?? [] }
}
module.exports = { writeRunResult, readRunResult }
