import { randomBytes } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export interface McpCipher {
  available(): Promise<boolean>
  encrypt(value: string): Promise<Uint8Array>
  decrypt(value: Buffer): Promise<string>
}
export class McpKeyStore {
  private file: string
  private directory: string
  private cipher: McpCipher
  constructor(directory: string, cipher: McpCipher) { this.directory = directory; this.cipher = cipher; this.file = join(directory, 'mcp-access.bin') }
  async readOrCreate(): Promise<string> {
    if (!await this.cipher.available()) throw new Error('MCP 访问密钥加密不可用。')
    try {
      const encrypted = await readFile(this.file)
      const token = await this.cipher.decrypt(encrypted)
      if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('Invalid MCP key')
      return token
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('MCP 访问密钥无法读取，请在 Agent 连接页重置密钥。')
      return this.rotate()
    }
  }
  async rotate(): Promise<string> {
    if (!await this.cipher.available()) throw new Error('MCP 访问密钥加密不可用。')
    const token = randomBytes(32).toString('hex')
    const encrypted = await this.cipher.encrypt(token)
    await mkdir(this.directory, { recursive: true })
    await writeFile(`${this.file}.tmp`, encrypted, { mode: 0o600 })
    await rename(`${this.file}.tmp`, this.file)
    return token
  }
}
