import { fileURLToPath } from 'node:url'
import { DEFAULT_PORTS } from '@git-nest/core'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

const apiTarget = process.env['GIT_NEST_API'] ?? `http://127.0.0.1:${DEFAULT_PORTS.api}`

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: DEFAULT_PORTS.web,
    /*
      **strictPort 不能去掉。** 不加它时，web 端口被占（上一次 dev 留下的残留进程
      很常见）vite 会**悄悄换一个端口**，而它很可能挑到 API 的那个：
      API 随即 `EADDRINUSE` 退出，但 `pnpm -r --parallel` 不会因此收摊，
      日志里「web ready」和「server EADDRINUSE」并排出现，页面能开、业务全废
      （`/api` 打到 vite 自己身上）。加了它就直接报错退出，问题一眼可见。
    */
    strictPort: true,
    // core 包以源码形式被引入，位于 monorepo 上层目录
    fs: { allow: ['..'] },
    proxy: {
      '/api': { target: apiTarget, changeOrigin: false },
    },
  },
})
