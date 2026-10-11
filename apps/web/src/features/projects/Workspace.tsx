import { Outlet } from 'react-router'
import { useUiStore } from '@/store/ui'
import { FilterPanel } from './FilterPanel'
import { FilterToggle } from './FilterToggle'
import { ProjectsPage } from './ProjectsPage'

/**
 * 清单工作区：**过滤面板 + 清单**。这是个布局路由。
 *
 * 详情**不是这里的一列**——它是清单区内部的第二轨（见 `ProjectsPage` 的
 * `.list-scroll`），所以这里只负责三件事：拼出过滤面板与清单、把**当前子路由的
 * 元素**交给清单（那就是详情的内容：概览 / README），以及路由本身。
 *
 * 路由上仍然只有一个 workspace：`/` 与 `/projects/:id` 渲染同一个界面，
 * 区别只在清单下面有没有详情。深链（书签、外部跳转、浏览器前进后退）照旧有效。
 */
export function Workspace() {
  const filterPanelOpen = useUiStore((s) => s.filterPanelOpen)

  return (
    /*
      三列：过滤面板 / 收起开关的槽 / 清单区。收起时只是面板那一列归零
      （`--w-filter: 0`），**槽不动**——开关得一直留在同一个位置，
      否则收起来之后它自己跳走了，用户找不回展开的入口。
    */
    <div className={`split ${filterPanelOpen ? '' : 'split-filters-collapsed'}`}>
      {/*
        过滤面板在清单左边。**它属于清单页，不是导航**——这一列是清单页自己的
        控件（仓库状态 / 我自己的 / 分类 / 标签，点了只筛眼前这张表）。
      */}
      <FilterPanel />
      <FilterToggle />
      {/*
        `detail` 是**内容**，摆放位置由清单决定：详情那一轨长在 `.list-scroll`
        里面（CSS 的两列），而那层网格是清单渲染的。**内容归路由，位置归布局
        里那一层真正渲染容器的人**——这样两边都不用猜对方做了什么。
      */}
      <ProjectsPage detail={<Outlet />} />
    </div>
  )
}
