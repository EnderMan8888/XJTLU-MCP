import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  main: { build: { rollupOptions: { input: {
    index: resolve('src/main/index.ts'), maintenance: resolve('src/main/release-maintenance.ts')
  } } } },
  preload: { build: { rollupOptions: { output: { format: 'cjs', entryFileNames: 'index.cjs' } } } },
  renderer: { plugins: [react()], server: { host: '127.0.0.1' } }
})
