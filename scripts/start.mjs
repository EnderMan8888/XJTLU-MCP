import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const electronRoot = join(root, 'node_modules', 'electron')
const pathFile = join(electronRoot, 'path.txt')
// Reading Electron's module would automatically download a missing runtime.
// Leave installation explicitly under the user's control instead.
const executable = existsSync(pathFile) ? join(electronRoot, 'dist', readFileSync(pathFile, 'utf8').trim()) : ''
if (!executable || !existsSync(executable)) {
  console.error('Electron 运行时尚未安装。请先手动执行：npm run install:electron')
  process.exit(1)
}
if (!existsSync(join(root, 'out', 'main', 'index.js'))) {
  console.error('应用尚未构建。请先执行：npm run build')
  process.exit(1)
}
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
const child = spawn(executable, [root, ...process.argv.slice(2)], { stdio: 'inherit', windowsHide: false, env })
child.on('error', () => { console.error('无法启动 Electron，请确认运行时安装完整。'); process.exitCode = 1 })
child.on('exit', (code) => {
  if (process.platform === 'win32' && code !== null && (code >>> 0) >= 0x80000000) {
    const windowsCode = (code >>> 0).toString(16).toUpperCase()
    console.error(`Electron 异常退出（Windows 错误码 0x${windowsCode}）。`)
    process.exitCode = 1
    return
  }
  process.exitCode = code ?? 1
})
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal))
