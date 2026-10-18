import { useState, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router'
import { useDebounce } from 'ahooks'
import type { ProjectListItem } from '@git-nest/core'
import { Button, ErrorNote } from '@/components/ui'
import { ApiError } from '@/lib/api'
import { useUiStore } from '@/store/ui'
import { useProjects } from './queries'
import { useStatuses } from '@/features/status/queries'
import { detailPath } from './detailPath'
import { useSync } from '@/features/updates/sync'
import { Toolbar } from './ListToolbar'
import { ProjectTable } from './ProjectTable'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { useSettings } from '@/features/settings/queries'
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
  const openScan = useUiStore((s) => s.openScan)
  const [pendingRemoval, setPendingRemoval] = useState<ProjectListItem | null>(null)

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

  /*
    行内「更新」：单个仓库，一次 ff-only。
    状态映射与详情页那颗「联网同步」**共用同一个 hook**（features/updates/sync.ts），
    否则两处迟早会说不一样的话。
  */
  const sync = useSync()

  /*
    批量更新：**勾选 + 底部动作条**。
    勾选状态就放在这一页（它只服务这一屏），换筛选时不清空——用户挑的是一批仓库，
    不是「当前这几行」；数不对了他自己会点「清空」。
  */
  const [picked, setPicked] = useState<Set<number>>(new Set())
  /*
    「一次更太多」的那道确认：阈值就是设置里那个 confirmThreshold
    （它原来只服务扫描导入；批量更新回来之后，又多了这一个消费者）。
    单仓库更新不经过这里——它只动一个仓库。
  */
  const { data: settings } = useSettings()
  const [confirmingBulk, setConfirmingBulk] = useState(false)
  const togglePick = (id: number) =>
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
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
        onScan={openScan}
        selection={
          picked.size > 0
            ? {
                count: picked.size,
                busy: sync.busy,
                done: sync.task?.done ?? 0,
                total: sync.task?.total ?? picked.size,
                summary: sync.task?.summary ?? null,
                onClear: () => setPicked(new Set()),
                onRun: () => {
                  const threshold = settings?.confirmThreshold ?? 20
                  if (picked.size > threshold) {
                    setConfirmingBulk(true)
                    return
                  }
                  sync.updateMany([...picked])
                },
              }
            : null
        }
      />

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
        {/*
          `px-4` 留着：工具条也是 `px-4`，表格的左缘要跟「已选 N 个」那种文字对齐。
          `pb-6` 是滚到底时的一点余量。
          **`h-full` 与 `overflow-auto` 从内联挪走了**：高度现在由 `.pane-list` 的
          `minmax(0, 1fr)` 那一行给，滚动由 `.list-pane` 自己的 CSS 负责——
          两处都写一遍，改一处不改另一处的时候只有一个会生效（内联那个永远赢）。
        */}
        <div className="list-pane px-4 pb-6">
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
            onOpen={(projectId) => navigate(detailPath(currentId, projectId))}
            onRemove={(p) => setPendingRemoval(p)}
            onUpdate={sync.updateOne}
            updateOf={sync.stateOf}
            selectedIds={picked}
            onToggleSelect={togglePick}
          />
        </div>


        {showDetail ? <aside className="detail border-l border-line bg-panel h-full overflow-hidden">{detail}</aside> : null}
      </div>

      {confirmingBulk ? (
        <ConfirmDialog
          title={`要更新 ${picked.size} 个仓库`}
          description={`这会逐个 fast-forward ${picked.size} 个仓库（只动工作区、只快进、不产生 merge commit）。超过确认阈值 ${settings?.confirmThreshold ?? 20} 个，所以先问一句。`}
          confirmText={`更新 ${picked.size} 个`}
          danger={false}
          onConfirm={() => {
            setConfirmingBulk(false)
            sync.updateMany([...picked])
          }}
          onClose={() => setConfirmingBulk(false)}
        />
      ) : null}

      {pendingRemoval ? (
        <RemoveDialog project={pendingRemoval} onClose={() => setPendingRemoval(null)} />
      ) : null}
    </div>
  )
}
