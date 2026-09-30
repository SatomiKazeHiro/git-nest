import { Route, Routes } from 'react-router'
import { AppShell } from '@/components/AppShell'
import { Sidebar } from '@/components/Sidebar'
import { ProjectsPage } from '@/features/projects/ProjectsPage'
import { ProjectDetailPage } from '@/pages/ProjectDetailPage'
import { SettingsPage } from '@/pages/SettingsPage'
import { EmptyState } from '@/components/ui'

export function App() {
  return (
    <AppShell sidebar={<Sidebar />}>
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
    </AppShell>
  )
}
