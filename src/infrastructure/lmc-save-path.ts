import { constants } from 'node:fs'
import { copyFile, lstat, mkdtemp, realpath, rm, stat } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, sep } from 'node:path'

export class LmcSavePathError extends Error {
  readonly code: 'invalid_save_path' | 'save_path_exists' | 'save_path_unavailable'
  constructor(code: LmcSavePathError['code'], message: string) {
    super(message)
    this.code = code
  }
}

const existing = () => new LmcSavePathError('save_path_exists', '目标路径已有文件或文件夹，请指定其他文件名。')
const unavailable = () => new LmcSavePathError('save_path_unavailable', '无法保存到目标目录，请确认目录存在且可写。')
const errorCode = (error: unknown) => (error as NodeJS.ErrnoException)?.code
const localPath = (path: string) => process.platform === 'win32' ? /^[a-z]:[\\/]/i.test(path) : isAbsolute(path)

export async function prepareLmcSavePath(path: string, tempRoot: string) {
  const segments = process.platform === 'win32' ? path.slice(3).split(/[\\/]/) : path.slice(1).split('/')
  if (!localPath(path) || path.length > 1024 || /[\x00-\x1f]/.test(path)
    || segments.some(part => !part || part === '.' || part === '..'
      || process.platform === 'win32' && (/[<>:"|?*]|[. ]$/.test(part)
        || /^(?:con|prn|aux|nul|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])\s*(?:\.|$)/i.test(part)))) {
    throw new LmcSavePathError('invalid_save_path', '请提供包含文件名的本机绝对路径。')
  }

  let parent: string
  try {
    parent = await realpath(dirname(path))
    if (!localPath(parent) || !(await stat(parent)).isDirectory()) throw unavailable()
  } catch { throw unavailable() }
  const target = join(parent, basename(path))
  try {
    await lstat(target)
    throw existing()
  } catch (error) {
    if (error instanceof LmcSavePathError) throw error
    if (errorCode(error) !== 'ENOENT') throw unavailable()
  }
  const root = await realpath(tempRoot).catch(() => { throw unavailable() })
  const directory = await mkdtemp(join(root, 'xjtlu-lmc-')).catch(() => { throw unavailable() })
  const stagingPath = join(directory, 'payload')
  return {
    target,
    stagingPath,
    async save(): Promise<void> {
      try {
        if (await realpath(parent) !== parent) throw unavailable()
        await copyFile(stagingPath, target, constants.COPYFILE_EXCL)
      } catch (error) { throw errorCode(error) === 'EEXIST' ? existing() : unavailable() }
    },
    async cleanup(): Promise<void> {
      // Only remove the private directory created for this download.
      if (directory.startsWith(root.endsWith(sep) ? root : root + sep) && dirname(directory) === root) {
        await rm(directory, { recursive: true, force: true }).catch(() => {})
      }
    }
  }
}

export type LmcSaveTarget = Awaited<ReturnType<typeof prepareLmcSavePath>>
