import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App } from './App'
import { notifyAppMounted } from './lib/platform'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // 本地单机应用：不做窗口聚焦重取，状态由用户操作驱动
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 10_000,
    },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)

// 壳的看门狗在等这一声：收不到就把系统标题栏还回来（页面没起来时窗口没有关闭按钮）。
// 浏览器环境里它是静默 no-op。
notifyAppMounted()
