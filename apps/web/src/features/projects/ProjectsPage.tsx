import { useState, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router'
import { useDebounce } from 'ahooks'
import type { ProjectListItem } from '@git-nest/core'
import { Button, ErrorNote } from '@/components/ui'
import { ApiError } from '@/lib/api'
import { useUiStore } from '@/store/ui'
import { useProjects } from './queries'
import { useStatuses } from '@/features/status/queries'
import { UpdatePanel } from '@/features/updates/UpdatePanel'
import { ListHeader, Toolbar } from './ListToolbar'
import { ProjectTable } from './ProjectTable'
import { RemoveDialog } from './RemoveDialog'

/**
 * 清单页：**取数 + 摆放**。工具条、表格、删除弹窗各自成文件。
 *
 * 这里留着的是它作为页面必须拥有的东西：
 * 1. **取数**：清单与状态的两次查询（状态错误要能在这里说清并重试）；
 * 2. **摆放**：`detail` 那一轨落在哪——见下面 `.list-scroll` 那段；
 * 3. **命令注册**：`check-updates` 要知道「当前筛出的全部」是谁。
 *
 * `detail` 是**路由给的内容**（`Workspace` 把当前子路由元素取出来传进来）。
 * 为什么摆放由这一层决定、而不是由布局决定：详情是**清单区内部的第二轨**，
 * 这件事写在 CSS 里（`.list-scroll` 的两列），只有渲染 `.list-scroll` 的组件
 * 知道它该落在哪。以前这里用 `useOutlet()` 自己去上下文里捞——同样是决定摆放，
 * 但那是一个藏在 hook 里的隐式契约（读的人得先知道布局没渲染 `<Outlet/>`）。
 * 现在它写在 props 上：谁给内容、谁定位置，一眼看得到。
 */
export function ProjectsPage({ detail }: { detail?: ReactNode }) {
  const navigate = useNavigate()
  /*
    「右栏正在看谁」住在 URL 里（`/projects/:id`），不是 store。
    理由是它和「勾选了哪些」是两件不同的事：勾选决定批量动作作用于谁，
    URL 决定详情栏显示谁——一个是工作集，一个是游标。混进同一个 Set 的话，
    点开一个项目就会把它算进「已选」，接着点「联网检查更新」就带上了一个
    用户没勾过的项目。
  */
  const { id } = useParams()
  const currentId = Number(id) || null
  // 没选中项目就没有详情
  const showDetail = currentId !== null
  const filters = useUiStore((s) => s.filters)
  const openSettings = useUiStore((s) => s.openSettings)
  const [pendingRemoval, setPendingRemoval] = useState<ProjectListItem | null>(null)
  const [panelOpen, setPanelOpen] = useState(false)

  const debouncedQuery = useDebounce(filters.q, { wait: 200 })
  /*
    **整个 `filters` 传下去**，只把 `q` 换成防抖后的那个。

    它的形状与 `ListParams` 是同一个（store 里那份就是为这个查询准备的），所以
    以后再加一个筛选 / 排序字段，这里不需要有人记得补一行。

    以前这里是**逐字段手写**的，加 `dir` 时就没人记得补——症状是「箭头翻了、行没动」：
    缓存键里没有 `dir`，于是方向一变**不重发请求**，而箭头是按 store 画的，
    界面在宣称一个并没有生效的排序。逐字段清单就是这种漏的来源。
  */
  const { data: projects, isPending, error } = useProjects({ ...filters, q: debouncedQuery })

  const {
    data: statuses,
    error: statusesError,
    isFetching: statusesLoading,
    refetch: refetchStatuses,
  } = useStatuses((projects ?? []).map((p) => p.id))

  if (error) {
    return (
      <div className="p-6">
        <ErrorNote message="读不到项目清单。后端可能没启动——在仓库根目录跑 pnpm dev，再刷新这个页面。" />
      </div>
    )
  }

  return (
    <div className="pane-list">
      <Toolbar
        total={projects?.length ?? 0}
        onCheckUpdates={() => setPanelOpen(true)}
        onScan={openSettings}
      />

      <ListHeader />

      {/*
        清单区：**清单表 + 详情并排**，选中项目时右边那一轨才长出来。

        详情的内容是**路由给的**（`Workspace` 用 `<Outlet/>` 取出来当 `detail`
        传进来），落在哪是**这里决定的**——因为「详情是清单区内部的第二轨」
        这件事写在 CSS 里（`.list-scroll` 的两列）。
        **不渲染时是真的不渲染**，不是留一块空壳。
      */}
      <div className={`list-scroll ${showDetail ? 'list-scroll-has-detail' : ''}`}>
        {/*
          清单那一轨。**收列断点的基准是这一层**（`.list-pane` 上的
          `container-type`），不是外面那个 `.list-scroll`——详情打开时整个清单区
          没变窄，变窄的是表格那一轨。基准放错的话，表格已经挤到要收列了、
          断点却还没触发。
        */}
        <div className="list-pane px-4 pb-6 h-full overflow-auto">
          {/*
            状态那一列读不出来时必须说出来。原来这个错误被丢掉了（只解构了 data），
            于是超过服务端上限、后端挂了、超时——用户看到的都是每一行「读状态…」，
            永远不恢复，也没有任何解释。清单本身是好的，所以这里只挂一条可重试的
            提示，不把整页变成错误页。
          */}
          {statusesError && projects && projects.length > 0 ? (
            <div className="mt-3 flex flex-wrap items-center gap-3 border-l-2 border-signal-bad bg-panel px-3 py-2">
              <span className="text-[13px] text-signal-bad">
                读不到仓库状态：{statusesError instanceof ApiError ? statusesError.message : '服务端没应答'}
                <span className="text-ink-3">（清单本身没问题，只有「落后 / 远程更新 / 上次检查」这几列是空的）</span>
              </span>
              <Button onClick={() => void refetchStatuses()} disabled={statusesLoading}>
                {statusesLoading ? '重试中…' : '重试'}
              </Button>
            </div>
          ) : null}

          <ProjectTable
            projects={projects}
            statuses={statuses}
            currentId={currentId}
            isPending={isPending}
            onOpen={(projectId) => navigate(`/projects/${projectId}`)}
            onRemove={(p) => setPendingRemoval(p)}
          />
        </div>

        {showDetail ? <aside className="detail border-l border-line bg-panel h-full overflow-hidden">{detail}</aside> : null}
      </div>

      {pendingRemoval ? (
        <RemoveDialog project={pendingRemoval} onClose={() => setPendingRemoval(null)} />
      ) : null}
      {/* 报告是弹窗，不再插进页面流里（插进去会推移清单表，而且和表是同一套盒子语汇，
          屏幕上就同时出现两张「表」）。 */}
      {panelOpen ? (
        <UpdatePanel
          targets={(projects ?? []).map((p) => ({ id: p.id, name: p.name, isOwn: p.isOwn }))}
          onClose={() => setPanelOpen(false)}
        />
      ) : null}
    </div>
  )
}
