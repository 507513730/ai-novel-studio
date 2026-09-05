const { setTimeout: delay } = require('node:timers/promises')
const transient = new Set(['UnknownVizError', 'VizSentEmptyBitmap', 'Frame Gone', 'EmbeddingTokenChanged', 'Timeout'])

function hasPixelContrast(bitmap) {
  if (!bitmap || bitmap.length < 8) return false
  for (let offset = 4; offset + 2 < bitmap.length; offset += 4) {
    if (Math.abs(bitmap[offset] - bitmap[0]) > 64 || Math.abs(bitmap[offset + 1] - bitmap[1]) > 64 || Math.abs(bitmap[offset + 2] - bitmap[2]) > 64) return true
  }
  return false
}

async function captureWithRetry(capture, wait = delay) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const image = await capture()
      if (image.isEmpty() || !hasPixelContrast(image.toBitmap())) throw Error('VizSentEmptyBitmap')
      return { image, attempts: attempt }
    } catch (error) {
      if (!transient.has(error.message) || attempt === 3) throw error
      await wait(attempt * 250)
    }
  }
  throw Error('capture did not complete')
}
async function waitForRenderer(check, wait = delay, attempts = 40) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (await check()) return
    await wait(250)
  }
  throw Error('renderer did not reach onboarding UI')
}
module.exports = { captureWithRetry, waitForRenderer, hasPixelContrast }
