import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const source = join(root, 'codex-plugin')
const plugin = 'plugins/xjtlu-campus'
const manifest = `${plugin}/.codex-plugin/plugin.json`
const { version } = JSON.parse(readFileSync(join(source, manifest), 'utf8'))
const output = join(root, 'dist', `XJTLU-Codex-Plugin-${version}`)
const zip = `${output}.zip`
if (existsSync(output) || existsSync(zip)) throw new Error(`Output already exists: ${output}`)

for (const name of ['README.md', '.agents/plugins/marketplace.json', manifest, `${plugin}/.mcp.json`]) {
  const target = join(output, name)
  mkdirSync(dirname(target), { recursive: true })
  cpSync(join(source, name), target, { errorOnExist: true, force: false })
}
execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
  'Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::CreateFromDirectory($env:XJTLU_PLUGIN_STAGE, $env:XJTLU_PLUGIN_ZIP, [IO.Compression.CompressionLevel]::Optimal, $true)'
], { env: { ...process.env, XJTLU_PLUGIN_STAGE: output, XJTLU_PLUGIN_ZIP: zip }, windowsHide: true, stdio: 'inherit' })
console.log(zip)
