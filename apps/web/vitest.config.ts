import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    // 依赖里可能有 `import './x.css'`（提交图用的 react-git-log 就自带样式）。
    // 默认这类 import 会被外部化，Node 直接去加载 .css 会抛
    // "Unknown file extension"。打开 css 处理后交给 Vite 接管。
    css: true,
    server: { deps: { inline: ['@tomplum/react-git-log'] } },
  },
})
