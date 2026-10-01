import { Route, Routes } from 'react-router'
import { AppShell } from '@/components/AppShell'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { Sidebar } from '@/components/Sidebar'
import { ProjectsPage } from '@/features/projects/ProjectsPage'
import { ProjectDetailPage } from '@/pages/ProjectDetailPage'
import { SettingsPage } from '@/pages/SettingsPage'
import { EmptyState } from '@/components/ui'

export function App() {
  return (
    <AppShell sidebar={<Sidebar />}>
      {/* 兜住页面渲染期的异常：只炸内容区，外壳（顶栏 / 侧栏）还能用，
          所以用户仍然点得回清单，而不是白屏。 */}
      <ErrorBoundary>
        <Routes>
          <Route path="/" element={<ProjectsPage />} />
          <Route path="/projects/:id" element={<ProjectDetailPage />} />
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
