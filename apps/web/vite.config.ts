import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

const apiTarget = process.env['GIT_NEST_API'] ?? 'http://127.0.0.1:5174'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    // core 包以源码形式被引入，位于 monorepo 上层目录
    fs: { allow: ['..'] },
    proxy: {
      '/api': { target: apiTarget, changeOrigin: false },
    },
  },
})
