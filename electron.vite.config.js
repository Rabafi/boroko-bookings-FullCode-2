import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

const allowedRendererHost = process.env.ELECTRON_RENDERER_ALLOWED_HOST?.trim()

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    server: allowedRendererHost ? { allowedHosts: [allowedRendererHost] } : {},
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [react()],
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules/react') || id.includes('node_modules/react-dom') || id.includes('node_modules/react-router-dom')) {
              return 'react-vendor'
            }
            if (id.includes('node_modules/lucide-react')) {
              return 'icons'
            }
            if (id.includes('node_modules/date-fns')) {
              return 'dates'
            }
            if (id.includes('node_modules/@supabase/supabase-js')) {
              return 'supabase'
            }
            if (id.includes('node_modules/@e965/xlsx') || id.includes('node_modules/xlsx')) {
              return 'xlsx'
            }
            return undefined
          }
        }
      }
    }
  }
})
