import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router'
import { AlertTriangle, Pencil, RefreshCw } from 'lucide-react'
import { categoryLabel, type ProjectDetail, type RepoStatus } from '@git-nest/core'
import { Button, ErrorNote } from '@/components/ui'
import { formatRelative } from '@/lib/format'
import { registerCommand } from '@/lib/commands'
import { useUiStore } from '@/store/ui'
import { useProjectStatus } from '@/features/status/queries'
import { AttentionBadge } from '@/features/status/StatusCell'
// 判决卡住在状态域（`features/status/StatusPanel`），页面只负责把它摆进来。
// 那三条状态政策（只有 safe 配绿、不是仓库就不重算、脏标记降级）跟着它一起走。
import { StatusPanel } from '@/features/status/StatusPanel'
import { UpdatePanel } from '@/features/updates/UpdatePanel'
import { useProject } from '@/features/projects/queries'
import { ReadmeView } from '@/features/readme/ReadmeView'

export function ProjectDetailPage() {
  const { id } = useParams()
  const projectId = Number(id)
  const openEdit = useUiStore((s) => s.openEdit)
  const [updating, setUpdating] = useState(false)
  /*
    详情栏的两页。**默认落在概览**——打开一个项目最常见的需求是看它现在什么状态，
    而「这个仓库是讲什么的」是第二问。

    **切换不改 URL**（理由见 `TabBar`）。换个项目时这个组件重挂载，
    于是自然回到概览——这正是该有的行为。
  */
  const [tab, setTab] = useState<'overview' | 'readme'>('overview')
  const validId = Number.isFinite(projectId) ? projectId : null
  const { data: project, isPending, error } = useProject(validId)
  // 状态提到页面这一层：missing 的提示要出现在页面最上面，不只是状态面板里
  const { data: status, refresh } = useProjectStatus(validId)

  /*
    F5 = 重读本地状态（不联网）。

    在浏览器里 F5 是刷新页面，所以这条快捷键现在被浏览器抢着——但那只是
    「还没打包成桌面软件」的临时状态。包成应用之后窗口里没有地址栏，
    F5 再没人接手就变成了一个纯空的键，而「重读本机状态」恰好是最该一键
    可做的事（它绕开服务端那 3 秒短缓存，是本地最快的刷新）。
  */
  useEffect(() => registerCommand('refresh-local', () => refresh.mutate()), [refresh])

  if (error) {
    return (
      <div className="p-6">
        <ErrorNote message="读不到这个项目。它可能已经从清单里移除了。" />
        <Link to="/" className="mt-3 inline-block text-[13px] text-accent hover:underline">
          回到清单
        </Link>
      </div>
    )
  }
  if (isPending || !project) {
    return <p className="p-6 font-mono text-[13px] text-ink-3">正在读项目…</p>
  }

  return (
    <div className="flex h-full flex-col">
      {status?.status === 'missing' ? <MissingNotice /> : null}

      {/*
        抬头：名字 + 动作 + 路径。

        **路径在这里，不在下面的键值表里，而且不截断。**
        它是「哪一份」的唯一凭据——清单里可能有两个同名仓库，只有路径能分开它们。
        原来它是个 `truncate` 的表格单元，栏一窄就变成「D:/…/…」，正是本仓库
        早就判定过的「断头话」；窄栏里该做的是让它换行，不是把它砍掉
        （WCAG 对「区分性名称」的要求是完整可读，不是为了排版整齐而裁掉）。

        `min-w-0` 配 `wrap-anywhere`：路径是不可预测的长串（深目录、Windows 的
        超长前缀、目录里有空格），必须允许在任何位置断开，否则会把整个栏撑宽。
        不用 `break-all` ——那会把正常汉字也逐个拆开。
      */}
      <header className="flex flex-wrap items-start gap-x-3 gap-y-2 px-4 py-3">
        {/*
          行动分类的药丸放在**抬头跟着名字**，不是下面「推不推荐更新」那一节的标题行。
          那节的 `Recommendation` 面板隔二十来像素就写着「可更新 / 别拉 / 要你决定」
          （`VERDICT_LABEL`，讲判决），药丸讲的是分类（`ATTENTION_TEXT`）——挨着放，
          同一个状态出现两个词（「可更新」重复、「不推荐」对「别拉」），读者得自己
          判断它们是不是一回事。抬头这份是「现在这个仓库什么状态」，和清单里
          那一行的状态列**逐字相同**（同一份 `attention`，同一套降级）。
        */}
        <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2">
          <h1 className="min-w-0 text-[17px] font-semibold leading-tight text-ink [overflow-wrap:anywhere]">
            {project.name}
          </h1>
          <AttentionBadge
            attention={project.attention}
            checkedAt={project.latestCheck?.checkedAt ?? null}
          />
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button onClick={() => openEdit(project.id)}>
            <Pencil size={14} aria-hidden />
            编辑资料
          </Button>
          <Button
            variant="primary"
            onClick={() => setUpdating(true)}
            title="联网 fetch 远程，再分析落后多少、推不推荐更新"
          >
            <RefreshCw size={14} aria-hidden />
            联网检查更新
          </Button>
        </div>
        <p
          className="w-full min-w-0 font-mono text-[12px] leading-5 text-ink-2 [overflow-wrap:anywhere]"
          title={project.path}
        >
          {project.path}
        </p>
      </header>

      <TabBar tabs={TABS} value={tab} onChange={setTab} />

      {/*
        两个 panel **都渲染**，未选中的用 `hidden` 藏起来。

        原来这里是二选一渲染，于是任何时刻未选中的那个标签，它的 `aria-controls`
        都指向一个**不存在的**元素——ARIA 规范要求它引用真实存在的 id，
        读屏软件查「这个标签控制哪块内容」会拿到一个查不到的 id。
        `hidden` 的元素不参与布局也不进无障碍树，代价接近零。

        panel 上的 `tabIndex={0}`：README 若被协议闸门全拦成纯文字
        （一个满是 `javascript:` 链接的仓库），面板里一个可聚焦元素都没有，
        Tab 键会直接跳出面板。这个落点让键盘永远进得来。
      */}
      <div role="tabpanel" id="panel-overview" aria-labelledby="tab-overview" tabIndex={0} hidden={tab !== 'overview'}>
        <OverviewPanel
          project={project}
          status={status}
          refresh={() => refresh.mutate()}
          isRefreshing={refresh.isPending}
        />
      </div>
      <div
        role="tabpanel"
        id="panel-readme"
        aria-labelledby="tab-readme"
        tabIndex={0}
        hidden={tab !== 'readme'}
        className="min-h-0 flex-1 overflow-hidden"
      >
        <ReadmeView projectId={project.id} />
      </div>

      {/* 添加时间是整栏里最不重要的一个事实：沉到最底下，用最小的字。
          顺带它终于不用等宽了——那不是代码。
          **它在标签栏外面**：它说的是这个项目，不是「这一页」。 */}
      <footer className="mt-auto border-t border-line px-4 py-2 text-[11px] text-ink-3">
        加入清单于 {formatRelative(project.addedAt)}
      </footer>

      {/* 「编辑资料」弹窗挂在窗口外壳上（整个应用只此一份），这里不再挂。
          报告是弹窗：插在流里会把上面的判断切开。 */}
      {updating ? <UpdatePanel ids={[project.id]} onClose={() => setUpdating(false)} /> : null}
    </div>
  )
}

/** 分类与标签共用的那一枚小标记 */
function Chip({ children }: { children: string }) {
  return (
    <span className="rounded-[2px] border border-line px-1.5 py-px font-mono text-[11.5px] text-ink-2">
      {children}
    </span>
  )
}

/**
 * 「这个目录不在了」。
 *
 * 原来是页面顶部一条左边框的横幅，路径挤在句子中间。现在路径已经单独成行了，
 * 所以这里只说**发生了什么、怎么办**，并把那个动词（编辑资料 / 移出清单）
 * 直接说成动作名——用户照着做就行，不必自己翻译。
 */
function MissingNotice() {
  return (
    <div className="border-b border-signal-bad bg-wash-bad px-4 py-3">
      <p className="flex items-center gap-1.5 text-[13px] font-medium text-signal-bad">
        <AlertTriangle size={14} aria-hidden />
        这个目录不在了
      </p>
      <p className="mt-1 text-[12.5px] text-ink-2">
        清单里这一条还在（你写的记录、标签都留着），只是磁盘上找不到这个路径。
        仓库如果是搬了家或改了名，在上面「编辑资料」里把路径指到新位置；
        要是不用了就「移出清单」。
      </p>
    </div>
  )
}

/**
 * 远程那一行：**能点开才占一行，否则整行不出**。
 *
 * - `https://…` 的 remote 是网页地址 → 一行链接，点了去仓库页面。
 * - `git@github.com:owner/repo.git` 这种 SSH 形式**不是 URL**：浏览器当相对路径，
 *   拼成 `http://localhost:5174/projects/git@github.com:…`，点一下跳进本应用里一个
 *   不存在的地址（用户报过的 bug）。它也不能点开任何网页 → **不占这一行**。
 *   （用户的要求：给不出真的就别占位，「信息少了总比垃圾信息好」。）
 * - 没有 remote → 也不占行：「git 状态」那边会写「这个仓库没有配置 origin」。
 *
 * 没做「从 SSH 推算出 `https://host/owner/repo`」：自建 host、非标准端口、嵌套路径
 * 都推不准，猜出来的链接比没有链接更坏。
 */
function RemoteRow({ url }: { url: string | null }) {
  if (!url || !isWebUrl(url)) return null
  return (
    <div className="flex items-baseline gap-2">
      <span className="shrink-0 text-[11px] text-ink-3">远程</span>
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="min-w-0 font-mono text-[12px] text-accent hover:underline [overflow-wrap:anywhere]"
      >
        {url}
      </a>
    </div>
  )
}

/** http(s) 才算网页地址；其余（SSH / file / 本地路径）一律不给链接 */
function isWebUrl(url: string): boolean {
  return /^https?:\/\//i.test(url)
}

/**
 * 「记录」：这个项目**唯一**由你写的地方 —— 但这一页只**看**，写是在
 * 「编辑资料」弹窗里（那是它唯一的编辑器，见 ProjectFormDialog）。
 *
 * 渲染在身份信息那个 `<dl>` 里，和 路径 / 分类 / 标签 同一级——它在库里就是
 * `projects` 表上的一列，不该比那几行高一级（曾经是「git 状态」旁边的 `<h2>` 分区，
 * 那是沿用旧「备注」列表的位置，属于没重新想过）。
 *
 * 之前这里直接放了一个带保存按钮的文本框，结果是「记录在外面、别的字段在弹窗里」，
 * 边界说不清（用户原话：「这和顶部的编辑资料不有歧义吗」）。现在这一页只读。
 *
 * 只读就**必须**让链接能点：记录里写的多是「在 B 站看到 → 顺着找到 GitHub」这类句子，
 * 链接不可点等于要手抄。
 *
 * 这里原来挂的是备注列表（N 条、各自时间戳、能逐条改删），那是个「流」，
 * 而人要的是「文档」；摘要与来源链接也一起撤了——见设计文档第 13 节第 19 条。
 */
function RecordView({ record }: { record: string }) {
  if (!record) {
    return (
      <p className="border border-dashed border-line px-3 py-3 text-[12.5px] text-ink-3">
        还没写。在上面「编辑资料」里写一句「怎么找到它的、有什么想法」——这一栏留给你，
        别的字段都是从 git 读来的。
      </p>
    )
  }
  return (
    // 正文尺寸与颜色：这是**你自己写的话**，是这个项目里唯一不是从 git 读来的
    // 内容。原来它是 `text-ink-2` 的灰字、还缩在标签列右边一格宽里，读起来像脚注。
    // 宽度上不再用 max-w-prose 压着——这一栏本来就不宽，压了只剩两三行。
    <p className="whitespace-pre-wrap text-[13px] leading-6 text-ink [overflow-wrap:anywhere]">
      {withLinks(record)}
    </p>
  )
}

/**
 * 把正文里的 http(s) 链接变成可点的 `<a>`。
 *
 * 就一个正则，不引 Markdown 解析器：记录是纯文本，唯一需要特殊对待的就是 URL。
 * 用 `split` 而不是 `replace`——带捕获组时，**奇数位正好是匹配到的 URL 本身**，
 * 不用再判断哪一段是链接。（每次新建正则：`/g` 的正则有 `lastIndex` 状态，
 * 复用会漏匹配。）
 */
function withLinks(text: string): ReactNode[] {
  return text.split(/(https?:\/\/[^\s<>()]+)/g).map((part, i) =>
    i % 2 === 1 ? (
      <a
        key={i}
        href={part}
        target="_blank"
        rel="noreferrer"
        className="break-all text-accent hover:underline"
      >
        {part}
      </a>
    ) : (
      part
    ),
  )
}

/**
 * 概览页：**原来那些内容，一处都不动**。
 *
 * 单独成组件是为了让标签页只管「切」，不管「里面是什么」——
 * 否则每加一页就要动一次这个大组件的内部结构。
 *
 * props 是搬运的结果，不是新设计：原来那几个值本来就在 `ProjectDetailPage` 的
 * 作用域里（`project`、`status`、`refresh.mutate`、`refresh.isPending`、
 * `project.latestCheck?.…`），搬进子组件后要显式收进来，仅此而已。
 */
function OverviewPanel({
  project,
  status,
  refresh,
  isRefreshing,
}: {
  project: ProjectDetail
  status: RepoStatus | undefined
  refresh: () => void
  isRefreshing: boolean
}) {
  return (
    <div className="flex flex-1 flex-col gap-4 px-4 py-4">
      <StatusPanel
        status={status}
        isFetching={isRefreshing}
        onRefresh={refresh}
        lastCheckAt={project.latestCheck?.checkedAt ?? null}
        lastCheckStatus={project.latestCheck?.status ?? null}
      />

      <RemoteRow url={project.remoteUrl} />

      {/*
        分类与标签并成一行 chip。
        原来它们各占一个 7rem 标签列 + 右边一个 chip 盒——**包了两层**：
        「分类」两个字、然后一个等宽字、再然后一个带框的小块。
        这一行里没有真正的「值」需要和「标签」对齐，chip 自己就是值。
      */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        {/*
          「我自己的」是这个项目最重要的一条元信息——它决定批量检查会不会
          跳过它。分类可以为空，这一项不行：勾上了却看不出来，等于没勾。
        */}
        {project.isOwn ? (
          <>
            <span className="text-[11px] text-ink-3">身份</span>
            <Chip>我自己的</Chip>
          </>
        ) : null}
        <span className="text-[11px] text-ink-3">分类</span>
        <Chip>{project.category ? categoryLabel(project.category) : '未分类'}</Chip>
        {project.tags.length > 0 ? (
          <>
            <span className="ml-1 text-[11px] text-ink-3">标签</span>
            {project.tags.map((t) => (
              <Chip key={t.id}>{t.name}</Chip>
            ))}
          </>
        ) : null}
      </div>

      {/*
        记录单独立一段，且是**正文**字号与颜色。
        它原来是个 `text-ink-2` 的灰字、还缩在标签列右边那一格宽里，
        跟「添加时间」一个权重——而它是这个项目里**唯一由你写的东西**，
        剩下的字段都是从 git 读来的。自己写的话不该是这个项目里最不容易被
        读到的一块。
      */}
      <section>
        <h2 className="mb-1.5 text-[11px] font-medium text-ink-3">
          记录
        </h2>
        <RecordView record={project.record} />
      </section>
    </div>
  )
}

const TABS = [
  { key: 'overview', label: '概览' },
  { key: 'readme', label: 'README' },
] as const

/**
 * 标签栏。
 *
 * **只管「切」，不管内容。** 切换**不改 URL**：「正在看哪个项目」住在 URL 里
 * （`/projects/:id`），而「看它的哪一页」是这一次看的局部状态。改了 URL 的话
 * 浏览器的前进后退就会开始记录「我翻到第几页」，而那不是一个值得记的动作。
 *
 * 键盘：左右方向键在两个之间移动，Home / End 跳首尾；未选中的那个 `tabIndex=-1`，
 * 所以整组只占 Tab 序里的一个停靠点（与清单表那个 roving tabindex 同一套想法）。
 *
 * 选中态用**蓝**——蓝在这个应用里表示「你能点的 / 当前选中的」。
 */
function TabBar<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: readonly { key: T; label: string }[]
  value: T
  onChange: (v: T) => void
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const at = tabs.findIndex((t) => t.key === value)
  const go = (next: number) => {
    const t = tabs[next]
    if (!t) return
    onChange(t.key)
    refs.current[next]?.focus()
  }

  return (
    <div role="tablist" className="flex shrink-0 gap-1 border-b border-line px-4">
      {tabs.map((t, i) => (
        <button
          key={t.key}
          role="tab"
          ref={(el) => {
            refs.current[i] = el
          }}
          aria-selected={t.key === value}
          aria-controls={`panel-${t.key}`}
          id={`tab-${t.key}`}
          tabIndex={t.key === value ? 0 : -1}
          onClick={() => onChange(t.key)}
          onKeyDown={(e) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); go((at + 1) % tabs.length) }
    if (e.key === 'ArrowLeft') { e.preventDefault(); go((at - 1 + tabs.length) % tabs.length) }
    if (e.key === 'Home') { e.preventDefault(); go(0) }
    if (e.key === 'End') { e.preventDefault(); go(tabs.length - 1) }
          }}
          className={`-mb-px cursor-pointer border-b-2 px-2 py-1.5 text-[12.5px] ${
            t.key === value
              ? 'border-accent font-medium text-accent-ink'
              : 'border-transparent text-ink-3 hover:text-ink-2'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}
