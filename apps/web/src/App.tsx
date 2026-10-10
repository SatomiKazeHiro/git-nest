import { Route, Routes } from 'react-router'
import { AppShell } from '@/components/AppShell'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { Workspace } from '@/features/projects/Workspace'
import { ProjectDetailPage } from '@/pages/ProjectDetailPage'
import { SettingsPage } from '@/pages/SettingsPage'
import { EmptyState } from '@/components/ui'

export function App() {
  return (
    <AppShell>
      {/* 兜住页面渲染期的异常：只炸内容区，外壳（标题栏）还能用，
          所以用户仍然点得回清单，而不是白屏。 */}
      <ErrorBoundary>
        <Routes>
          {/*
            清单工作区是**一个布局路由**：`/` 与 `/projects/:id` 渲染同一个界面，
            区别只在右边那栏有没有内容。这样深链（书签、外部跳转、浏览器前进后退）
            照旧有效——打开 `/projects/5` 就是「清单 + 5 号项目的详情」，
            而不是另一个页面。
          */}
          <Route element={<Workspace />}>
            {/*
              `/` 没有子路由元素：**没选中项目时清单下面就是什么都不渲染**。
              原来的「还没选中项目」占位说的是右边那一栏，而那一栏已经没有了。
            */}
            <Route path="/" element={null} />
            <Route path="/projects/:id" element={<ProjectDetailPage />} />
          </Route>
          <Route path="/settings" element={<SettingsPage />} />
          <Route
            path="*"
            element={
              <div className="p-6">
                <EmptyState title="没有这个页面" body="地址栏里的路径不对。回清单看看。" />
              </div>
            }
          />
        </Routes>
      </ErrorBoundary>
    </AppShell>
  )
}