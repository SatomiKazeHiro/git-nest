import { FilterPanel } from './FilterPanel'
import { ProjectsPage } from './ProjectsPage'

/**
 * 清单工作区：**过滤面板 + 清单**。
 *
 * 详情**不是这里的一列**——它在清单表下面，点开才渲染（见 `ProjectsPage`）。
 * 所以这个组件现在只负责把过滤面板与清单表拼起来，布局上是两列。
 *
 * 路由上仍然只有一个 workspace：`/` 与 `/projects/:id` 渲染同一个界面，
 * 区别只在清单下面有没有详情。深链（书签、外部跳转、浏览器前进后退）照旧有效。
 */
export function Workspace() {
  return (
    <div className="split">
      {/*
        过滤面板在清单左边。**它属于清单页，不是导航**——这一列是清单页自己的
        控件（仓库状态 / 我自己的 / 分类 / 标签，点了只筛眼前这张表）。
      */}
      <FilterPanel />
      <ProjectsPage />
    </div>
  )
}