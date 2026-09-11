import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import sharp from 'sharp'

const require = createRequire(import.meta.url)
const updaterRequire = createRequire(require.resolve('electron-updater/package.json'))
const builderRequire = createRequire(require.resolve('electron-builder/package.json'))
const appBuilderRequire = createRequire(builderRequire.resolve('app-builder-lib/package.json'))
const plistRequire = createRequire(appBuilderRequire.resolve('plist/package.json'))

describe('依赖安全更新的真实消费路径', () => {
  it('electron-updater 使用实际 js-yaml 正常解析更新元数据', () => {
    const yaml = updaterRequire('js-yaml') as { dump: (value: unknown) => string }
    const { parseUpdateInfo } = updaterRequire('./out/providers/Provider.js') as {
      parseUpdateInfo: (rawData: string, channelFile: string, channelUrl: URL) => unknown
    }
    const update = {
      version: '1.1.3',
      files: [{ url: 'AI-Novel-Studio-Setup-1.1.3.exe', sha512: 'c2FmZS10ZXN0', size: 12345 }],
      path: 'AI-Novel-Studio-Setup-1.1.3.exe',
      sha512: 'c2FmZS10ZXN0',
      releaseDate: '2026-09-11T00:00:00.000Z',
      releaseNotes: '修复备份恢复；保留原库'
    }
    expect(parseUpdateInfo(yaml.dump(update), 'latest.yml', new URL('https://example.invalid/latest.yml'))).toEqual(update)
  })

  it('app-builder-lib 使用实际 plist/xmldom 正常往返应用元数据', () => {
    const plist = appBuilderRequire('plist') as { build: (value: unknown) => string; parse: (xml: string) => unknown }
    const values = {
      CFBundleName: '小说工作台 & 工具',
      CFBundleIdentifier: 'studio.test.novel',
      CFBundleVersion: '1.1.3',
      NSHighResolutionCapable: true,
      CFBundleDocumentTypes: [{ CFBundleTypeExtensions: ['txt', 'epub'] }]
    }
    expect(plist.parse(plist.build(values))).toEqual(values)
  })

  it.each(['element', 'attribute'])('plist 实际 xmldom 严格序列化拒绝被篡改的名称：%s', (kind) => {
    const { DOMImplementation, XMLSerializer } = plistRequire('@xmldom/xmldom') as typeof import('@xmldom/xmldom')
    const document = new DOMImplementation().createDocument(null, 'root', null)
    const element = document.documentElement
    if (kind === 'element') {
      Object.defineProperty(element, 'tagName', { value: 'root><injected' })
    } else {
      element.setAttribute('safe', 'value')
      Object.defineProperty(element.getAttributeNode('safe'), 'name', { value: 'bad="value" injected' })
    }
    const serializer = new XMLSerializer()
    expect(() => serializer.serializeToString(document, false, undefined, { requireWellFormed: true })).toThrow()
  })

  it('sharp 对小型内存 PNG 正常编码解码', async () => {
    const pixels = Buffer.from([255, 0, 0, 255, 0, 255, 0, 128])
    const png = await sharp(pixels, { raw: { width: 2, height: 1, channels: 4 } }).png().toBuffer()
    const decoded = await sharp(png).raw().toBuffer({ resolveWithObject: true })
    expect(decoded.info).toMatchObject({ width: 2, height: 1, channels: 4 })
    expect(decoded.data).toEqual(pixels)
  })
})
