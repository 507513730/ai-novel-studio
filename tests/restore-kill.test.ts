import { describe, expect, it } from 'vitest'
import { fork } from 'node:child_process'
import { once } from 'node:events'
import { createRequire } from 'node:module'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { recoverInterruptedRestore } from '../electron/restore'

describe('真实进程中断恢复', () => {
  it('候选库安装后 kill，重启处理恢复原库且可重复执行', async () => {
    const root = mkdtempSync(join(tmpdir(), 'novel-restore-kill-'))
    const data = join(root, 'data')
    const source = join(root, 'source')
    mkdirSync(data)
    mkdirSync(source)
    writeFileSync(join(data, 'ai-novel-studio.db'), 'original')
    writeFileSync(join(source, 'ai-novel-studio.db'), 'candidate')
    const runner = join(root, 'runner.cjs')
    // 只在测试子进程编译实际恢复模块，运行与产品相同的文件切换逻辑。
    writeFileSync(runner, `
const fs = require('node:fs');
const ts = require(process.argv[2]);
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText, filename);
const {restoreBackup} = require(process.argv[3]);
restoreBackup(process.argv[4], process.argv[5], 'test', {
  validate: async (input, output) => fs.copyFileSync(input, output),
  stop: async () => {},
  start: async () => { process.send('installed'); await new Promise(() => {}); },
  activate: async () => { throw Error('must not activate'); }
}).catch(() => process.exit(2));
`, 'utf8')
    const require = createRequire(import.meta.url)
    const module = join(dirname(fileURLToPath(import.meta.url)), '../electron/restore.ts')
    const child = fork(runner, [require.resolve('typescript'), module, data, source], { windowsHide: true, silent: true })
    child.stdout?.resume()
    child.stderr?.resume()
    const exited = once(child, 'exit')
    const timeout = setTimeout(() => child.kill('SIGKILL'), 10_000)
    try {
      const received = await Promise.race([once(child, 'message'), exited.then(() => { throw Error('恢复子进程提前退出') })])
      expect(received[0]).toBe('installed')
      expect(readFileSync(join(data, 'ai-novel-studio.db'), 'utf8')).toBe('candidate')
      child.kill('SIGKILL')
      await exited
      recoverInterruptedRestore(data)
      expect(readFileSync(join(data, 'ai-novel-studio.db'), 'utf8')).toBe('original')
      expect(existsSync(join(data, 'restore-pending.json'))).toBe(false)
      recoverInterruptedRestore(data)
      expect(readFileSync(join(data, 'ai-novel-studio.db'), 'utf8')).toBe('original')
    } finally {
      clearTimeout(timeout)
      if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await exited }
    }
  }, 15_000)
})
