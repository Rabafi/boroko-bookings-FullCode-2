/* global process */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootPackage = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf8'))
const sourceBuildId = [
  process.env.VERCEL_GIT_COMMIT_SHA,
  process.env.COMMIT_REF,
  process.env.GITHUB_SHA
].find((value) => typeof value === 'string' && value.trim())
const buildId = process.env.VITE_BUILD_ID?.trim()
  || `${sourceBuildId?.trim().slice(0, 12) || 'vite'}-${Date.now().toString(36)}`

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    __BOROKO_APP_VERSION__: JSON.stringify(rootPackage.version),
    __BOROKO_APP_BUILD_ID__: JSON.stringify(buildId)
  },
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, '../src/shared')
    }
  },
  server: {
    fs: {
      allow: ['..']
    }
  }
})
