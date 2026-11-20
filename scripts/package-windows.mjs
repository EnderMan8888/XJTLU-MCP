import { cp, mkdir, readFile, rename, rm, writeFile, stat } from 'node:fs/promises'
import { existsSync, createReadStream } from 'node:fs'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

// Package only a clean build and its production dependencies. Never copy a
// working directory, browser profile or account file into a distributable.
if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Windows x64 is required')
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const runtime = join(root, 'node_modules/electron/dist')
if (!existsSync(join(runtime, 'electron.exe'))) throw new Error('Install the Electron runtime before packaging')
const name = `XJTLU-MCP-${pkg.version}-win-x64`
const stage = join(root, 'dist', name)
const zip = `${stage}.zip`
if (existsSync(stage) || existsSync(zip)) throw new Error(`Output already exists: ${stage}. Move it aside before packaging again.`)
await mkdir(join(root, 'dist'), { recursive: true })
await cp(runtime, stage, { recursive: true })
await rename(join(stage, 'electron.exe'), join(stage, 'XJTLU-MCP.exe'))
await rm(join(stage, 'resources/default_app.asar'), { force: true })
const appDir = join(stage, 'resources/app')
await mkdir(appDir, { recursive: true })
await cp(join(root, 'out'), join(appDir, 'out'), { recursive: true })
for (const file of ['.agents/plugins/marketplace.json', 'plugins/xjtlu-campus/.codex-plugin/plugin.json', 'plugins/xjtlu-campus/.mcp.json']) {
  const target = join(appDir, 'codex-plugin', file)
  await mkdir(dirname(target), { recursive: true })
  await cp(join(root, 'codex-plugin', file), target)
}
await writeFile(join(appDir, 'package.json'), JSON.stringify({ name:pkg.name, version:pkg.version, description:pkg.description, type:'module', main:pkg.main }, null, 2)+'\n')
const copied = new Set()
async function copyDependency(name, from, target) {
  const require = createRequire(join(from, 'package.json'))
  let source = dirname(require.resolve(name))
  while (!existsSync(join(source, 'package.json')) || JSON.parse(await readFile(join(source, 'package.json'), 'utf8')).name !== name) {
    const parent = dirname(source)
    if (parent === source) throw new Error(`Cannot locate dependency ${name}`)
    source = parent
  }
  const destination = join(target, 'node_modules', name)
  if (copied.has(destination)) return
  copied.add(destination)
  await cp(source, destination, { recursive: true })
  const dep = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'))
  for (const child of Object.keys(dep.dependencies || {})) await copyDependency(child, source, destination)
}
for (const dependency of Object.keys(pkg.dependencies || {})) await copyDependency(dependency, root, appDir)
await writeFile(join(stage, '使用说明.txt'), `XJTLU-MCP V${pkg.version}\r\n\r\n请完整解压文件夹，再双击 XJTLU-MCP.exe。无需安装 Node.js 或 Electron。\r\n首次使用请在首页“账号与登录”保存学校账号，验证提示按学校网页完成。\r\n账号和会话保存在当前 Windows 用户的 AppData 中，不随本压缩包分发。\r\n请保留文件夹内的 DLL、resources、locales 及许可证文件。\r\n本版本未作代码签名；请核对下载来源及 SHA256。\r\n`)
execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::CreateFromDirectory($env:XJTLU_PACKAGE_DIR, $env:XJTLU_PACKAGE_ZIP, [System.IO.Compression.CompressionLevel]::Optimal, $true)"], { env:{...process.env,XJTLU_PACKAGE_DIR:stage,XJTLU_PACKAGE_ZIP:zip}, windowsHide:true, stdio:'inherit' })
const hash = createHash('sha256')
for await (const chunk of createReadStream(zip)) hash.update(chunk)
await writeFile(join(root, 'dist/SHA256SUMS.txt'), `${hash.digest('hex')}  ${name}.zip\n`)
console.log(`Packaged ${name}.zip (${Math.round((await stat(zip)).size/1024/1024)} MB)`)
