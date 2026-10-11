import { Route, Routes } from 'react-router'
import { AppShell } from '@/layouts/AppShell'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { Workspace } from '@/features/projects/Workspace'
import { ProjectDetailPage } from '@/pages/ProjectDetailPage'
import { PreviewPage } from '@/pages/PreviewPage'
import { EmptyState } from '@/components/ui'
import { ProjectFormDialog } from '@/features/projects/ProjectFormDialog'
import { SettingsDialog } from '@/features/settings/SettingsDialog'

export function App() {
  /*
    组合根：外壳 + 那个「整个应用只有一份」的弹窗。

    「编辑资料」弹窗原来挂在外壳（`layouts/AppShell.tsx`）里，而它以前还被
    清单页与详情页各渲染过一次——宽窗口下两处同时可见，于是出现两个实例。
    挂一份是对的，**挂在哪一层才是问题**：`components/` 是通用层，一挂上去
    这一层就认识了 `features/projects`，而「通用层不认识业务」正是它之所以
    通用的原因。挂到组合根上，唯一性一点没变，方向正回来了。
  */
  return (
    <>
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
            {/*
              图标预览页（开发用）。**不在 Workspace 里面**：那个布局路由会渲染
              清单与详情栏，而这一页不读接口、不碰任何项目，只是把
              `assets/types/` 里现有的图标按角标的实际规格摆出来。
            */}
            <Route path="/preview" element={<PreviewPage />} />
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
      {/* 两个「整个应用只有一份」的弹窗。 */}
      <ProjectFormDialog />
      <SettingsDialog />
    </>
  )
}
