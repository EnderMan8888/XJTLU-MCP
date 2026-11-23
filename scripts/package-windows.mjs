import { cp, mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile, stat } from 'node:fs/promises'
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
const setup = `${stage}-setup.exe`
if ([stage, zip, setup].some(existsSync)) throw new Error(`Output already exists: ${stage}. Move it aside before packaging again.`)
const framework = join(process.env.SystemRoot ?? 'C:\\Windows', 'Microsoft.NET/Framework64/v4.0.30319')
const compiler = join(framework, 'csc.exe')
if (!existsSync(compiler)) throw new Error('The Windows .NET Framework C# compiler is needed to build Setup and Uninstall.')
if (!/^\d+\.\d+\.\d+$/.test(pkg.version)) throw new Error('The Windows release requires a three-part version number.')
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
const build = await mkdtemp(join(root, 'dist', '.windows-build-'))
const versionSource = join(build, 'Version.cs')
await writeFile(versionSource, `using System.Reflection;\n[assembly: AssemblyProduct("XJTLU-MCP")]\n[assembly: AssemblyVersion("${pkg.version}.0")]\n[assembly: AssemblyFileVersion("${pkg.version}.0")]\n[assembly: AssemblyInformationalVersion("${pkg.version}")]\n`)
function compile(output, args) {
  const references = ['System.Windows.Forms', 'System.Drawing', 'System.IO.Compression', 'System.IO.Compression.FileSystem', 'Microsoft.CSharp']
  execFileSync(compiler, ['/nologo', '/target:winexe', '/platform:x64', '/optimize+', '/codepage:65001',
    `/out:${output}`, ...references.map(name => `/reference:${join(framework, name + '.dll')}`),
    ...args, join(root, 'scripts/windows-package.cs'), versionSource], { windowsHide: true, stdio: 'inherit' })
}
compile(join(stage, 'Uninstall.exe'), [])
async function filesInside(folder, prefix = '') {
  const files = []
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const path = prefix + entry.name
    if (entry.isDirectory()) files.push(...await filesInside(join(folder, entry.name), path + '/'))
    else if (entry.isFile()) files.push(path)
    else throw new Error(`Unexpected file type in Windows package: ${path}`)
  }
  return files
}
await writeFile(join(stage, 'xjtlu-package-files.txt'), [...await filesInside(stage), 'xjtlu-package-files.txt'].sort().join('\n') + '\n')
execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::CreateFromDirectory($env:XJTLU_PACKAGE_DIR, $env:XJTLU_PACKAGE_ZIP, [System.IO.Compression.CompressionLevel]::Optimal, $true)"], { env:{...process.env,XJTLU_PACKAGE_DIR:stage,XJTLU_PACKAGE_ZIP:zip}, windowsHide:true, stdio:'inherit' })
compile(setup, ['/define:SETUP', `/resource:${zip},Payload.zip`])
const checksums = []
for (const artifact of [setup, zip]) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(artifact)) hash.update(chunk)
  const filename = artifact.slice(stage.length - name.length)
  checksums.push(`${hash.digest('hex')}  ${filename}`)
  console.log(`Packaged ${filename} (${Math.round((await stat(artifact)).size / 1024 / 1024)} MB)`)
}
await writeFile(join(root, 'dist/SHA256SUMS.txt'), checksums.join('\n') + '\n')
