import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router'
import { AlertTriangle, CheckCircle2, HelpCircle, Pencil, RefreshCw } from 'lucide-react'
import { categoryLabel, isRemoteCheckStatus, deriveStatus, VERDICT_LABEL, type ProjectDetail, type RepoStatus, type UpdateRecommendation, type UpdateStatus, type UpdateVerdict } from '@git-nest/core'
import { Button, ErrorNote, Meta } from '@/components/ui'
import { formatRelative } from '@/lib/format'
import { registerCommand } from '@/lib/commands'
import { useUiStore } from '@/store/ui'
import { useProjectStatus } from '@/features/status/queries'
import { AttentionBadge, Delta, VERDICT_TONE, statusTitle, textFor, toneFor, freshnessOf } from '@/features/status/StatusCell'
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
 * 「推不推荐更新」在详情页的样子：判决 + 完整理由。
 *
 * 清单页只有一格宽度，所以那边只给短标签、理由放 title；这里地方够，把话说全——
 * **尤其是 `rewritten` / `unrelated` 这两种「别拉」**，用户需要知道为什么，
 * 否则只会觉得这软件在拦他。
 */
/**
 * 判决块的「长相」：底色 + 图标。
 *
 * **绿色只给 `safe` 一个判决。** 这一点很容易写坏：曾经写成
 * `bad ? 红底 : 绿底`，于是 `diverged`（要你决定）、`gone`（上游已被删）、
 * `no_upstream`（没有上游）全被涂成了绿色——而绿色在这个应用里只表示
 * 「可以安全快进」。「上游已被删」涂成绿色，正是本仓库反复要避免的
 * **用颜色替用户下结论**。
 *
 * 那三个判决既不是「可以」也不是「别拉」，是**「你自己看一眼」**：
 * 不着色（跟卡片一个底）、配一个中性的问号图标，让它既不绿也不红。
 */
const VERDICT_LOOK: Record<UpdateVerdict, { wash: string; Icon: typeof CheckCircle2 }> = {
  safe: { wash: 'bg-wash-ok', Icon: CheckCircle2 },
  rewritten: { wash: 'bg-wash-bad', Icon: AlertTriangle },
  unrelated: { wash: 'bg-wash-bad', Icon: AlertTriangle },
  diverged: { wash: '', Icon: HelpCircle },
  gone: { wash: '', Icon: HelpCircle },
  no_upstream: { wash: '', Icon: HelpCircle },
}

function Recommendation({ recommendation }: { recommendation: UpdateRecommendation | null }) {
  if (!recommendation) {
    return (
      <div className="px-3 py-2.5" data-testid="recommendation">
        <p className="flex items-center gap-1.5 text-[15px] font-semibold text-ink-3">
          <HelpCircle size={15} aria-hidden />
          还没查过
        </p>
        <p className="mt-1 text-[12.5px] leading-5 text-ink-2">
          所以给不出「推不推荐」——作者有没有改写历史，本地是看不出来的。点上面「联网检查更新」问一次远程。
        </p>
      </div>
    )
  }
  const { wash, Icon } = VERDICT_LOOK[recommendation.verdict]
  return (
    // 「别拉」这块整块换成浅红底，而不是只给一根红竖线：一根线在密集的等宽字里
    // 很容易看漏，而这是全应用唯一会拦住你动作的地方。
    // 颜色之外始终有文字与图标（判决词本身），所以不靠颜色单独传意。
    <div className={`px-3 py-2.5 ${wash}`} data-testid="recommendation">
      <p
        className={`flex items-center gap-1.5 text-[15px] font-semibold ${VERDICT_TONE[recommendation.verdict]}`}
      >
        <Icon size={15} aria-hidden />
        {VERDICT_LABEL[recommendation.verdict]}
      </p>
      <p className="mt-1 text-[12.5px] leading-5 text-ink-2 [overflow-wrap:anywhere]">
        {recommendation.reason}
      </p>
    </div>
  )
}

/**
 * 脏标记在摘要里的短标签与提示。
 *
 * **分开说「你改过的」和「未跟踪的新文件」**——前者更新可能覆盖，后者多半是
 * 构建产物。一律说「有 N 处未提交改动」会让人以为工具在无理由地拦他。
 * （措辞与 core `pull.ts` 的 `describeWorktree` 同一个口径，但那边是给 pull
 * 结果用的整句，这边是摘要里的一小格，所以没有直接共用那个函数。）
 */
function dirtyLabel(s: RepoStatus): string {
  if (s.dirtyTracked > 0 && s.dirtyUntracked > 0) {
    return `${s.dirtyTracked} 个文件被改 · ${s.dirtyUntracked} 个未跟踪`
  }
  if (s.dirtyTracked > 0) return `${s.dirtyTracked} 个文件被改`
  return `${s.dirtyUntracked} 个未跟踪文件`
}

function dirtyHint(s: RepoStatus): string {
  const parts: string[] = []
  if (s.dirtyTracked > 0) {
    parts.push(`${s.dirtyTracked} 个已跟踪文件被改过——更新可能覆盖它们，建议先提交或 stash`)
  }
  if (s.dirtyUntracked > 0) {
    parts.push(`${s.dirtyUntracked} 个未跟踪文件（多半是构建产物、依赖目录这类，更新通常踩不到）`)
  }
  return parts.join('；')
}

/**
 * git 状态摘要。
 *
 * 原来是 6 行仪表盘（状态 / 当前分支 / 上游分支 / 领先落后 / 远程地址 / 最后提交），
 * 但那里面混了三种东西：**这个软件要回答的**（跟远程差多少）、**git 客户端的事**
 * （当前分支）、**别处已经有的**（远程地址：能点开的在身份信息 dl 里占一行，
 * 点不开的（SSH）两处都不放，这里只负责说清有没有 origin、上游叫什么）。
 *
 * 收敛成一行：结论 + 上游分支 + 上游最后一次提交时间。
 * 分支名不再显示——设计文档第 1 节写明不做 git 客户端，用户也从没问过自己在哪个分支。
 */
export function StatusPanel({
  status,
  isFetching,
  onRefresh,
  lastCheckAt,
  lastCheckStatus,
}: {
  status: RepoStatus | undefined
  isFetching: boolean
  onRefresh: () => void
  lastCheckAt: string | null
  lastCheckStatus: UpdateStatus | null
}) {
  if (!status) {
    return <p className="font-mono text-[12px] text-ink-3">正在读 git 状态…</p>
  }
  // server 侧的 latestCheck 只在「真正问到远程」时才非空；这里再用共享判定守一道。
  // 拿不到合格状态就按「从没查过」处理——宁可说不知道，也不说没依据的肯定。
  const hasRemoteCheck = Boolean(lastCheckStatus && isRemoteCheckStatus(lastCheckStatus))
  const freshness = hasRemoteCheck ? freshnessOf({ checkedAt: lastCheckAt }) : 'never'

  /*
    **不是仓库时不要重算状态。**
    `deriveStatus` 的第一条是「不是仓库就返回 not_a_repo」，而 `missing`（目录不在了）
    与 `error`（读不出来 / 路径过长）在 core 里同样是 `isRepo: false`
    ——重算会把它们一起变成「不是 git 仓库」，摘要行就这么说了：
    同屏顶部横幅写着「这个目录不在了」，这里却说「不是 git 仓库」，
    而 path_too_long 那种更是把一个「读不出来」说成了确定的结论。
    所以：是仓库才降级 dirty 重算，不是仓库就原样用它自己的状态说话。
  */
  const verdict = status.isRepo
    ? deriveStatus({
        isRepo: true,
        dirty: status.dirty,
        detached: status.detached,
        hasCommits: status.status !== 'no_commits',
        upstream: status.upstream !== null,
        ahead: status.ahead,
        behind: status.behind,
        upstreamGone: status.upstreamGone,
        hasRemote: status.remoteUrl !== null,
        // 摘要要回答的是「跟远程差多少、该不该拉」，所以**脏标记不当主角**：
        // `deriveStatus` 的优先级会把 dirty 顶到最前面（那对「最紧急的一件事」是对的），
        // 但在这里它只是「拉了会不会踩到你」的一个提醒，降级成旁边一句灰字。
        skipDirty: true,
      })
    : status.status

  const detailTitle = statusTitle(
    { ...status, status: verdict },
    { checkedAt: hasRemoteCheck ? lastCheckAt : null },
  )

  return (
    /*
      一张卡。**边框而不是阴影**——阴影在这么窄的一栏里会往外糊，
      而一条 1px 的线就够把「这块是关于 git 的」圈出来（极简主义那条
      「clean borders, no box-shadow unless necessary」就是指这个）。

      卡里分三层，从上到下是「结论 → 依据 → 说明」：
      判决在最上面，因为它是这个软件一阶段最要紧的一条输出；
      事实行给它当依据；说明行只在真的有额外信息时才有。
    */
    <section className="overflow-hidden rounded-[4px] border border-line">
      {/*
        这一行**不铺底色**。原来给卡片头和判决块都上了一层极浅的灰绿
        （#eef1f3 与 #eaf0ec，三个通道各差 4–5，肉眼等于同色），
        于是「可更新」那块有颜色的判决和它上面的标题糊成一片。
        现在卡里**只有判决那一块着色**——颜色于是只表示一件事：
        拉了会不会出事。
      */}
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        <h2 className="text-[11px] font-medium text-ink-3">
          推不推荐更新
        </h2>
        {hasRemoteCheck ? (
          <Meta
            label="远程检查"
            value={`${formatRelative(lastCheckAt!)}查的`}
            title="最近一次联网 fetch 远程的时间"
          />
        ) : (
          <Meta
            label="远程检查"
            value="没查过"
            placeholder
            title="还没点过「联网检查更新」，所以下面的远程数字没有联网核实过"
          />
        )}
        <Button
          className="ml-auto"
          size="sm"
          disabled={isFetching}
          onClick={onRefresh}
          title="不联网：只重读本机的 git 状态（绕开几秒缓存）。要问远程用上面的「联网检查更新」"
        >
          <RefreshCw size={12} aria-hidden className={isFetching ? 'animate-spin' : ''} />
          {isFetching ? '重读中…' : '重读本地状态'}
        </Button>
      </div>

      {/*
        判决会随一次后台检查异步变掉，所以它是**一个完整的状态区域**而不是
        几段飘着的字：读屏用户听到的是「3 个仓库可安全快进」这样一句完整的话，
        而不是先念「2」再跳到别处去。
      */}
      <div role="status" aria-atomic="true">
        <Recommendation recommendation={status.recommendation} />
      </div>

      {/*
        事实行与下面那句说明是**一组**，不是两块：说明就是在解释上面这些数字
        的来路（「它们来自上次 fetch，不联网」）。所以它们共用一个容器、共用
        一条上边框，中间不插任何分隔线——插了就是在暗示「这是另一件事」。

        主次靠字号与颜色分开，而不是靠线：事实 14px 带语气色，说明 11.5px 灰。
        原来两行都是 12.5px/ink-2，挨在一起糊成一段，读者分不清哪句是结论、
        哪句是补充。
      */}
      <div className="border-t border-line px-3 py-2.5">
        <div
          data-testid="status-summary"
          className="flex flex-wrap items-baseline gap-x-3 gap-y-1"
        >
          <span className={`text-[14px] font-medium ${toneFor(verdict, freshness)}`}>
            {textFor(verdict, freshness)}
          </span>
          {status.behind ? <Delta n={status.behind} dir="behind" /> : null}
          {status.ahead ? <Delta n={status.ahead} dir="ahead" /> : null}
          {status.upstream ? (
            <span className="font-mono text-[11.5px] text-ink-3">上游 {status.upstream}</span>
          ) : null}
          {status.lastCommit ? (
            <span className="text-[11.5px] text-ink-3">
              上游最后提交 {formatRelative(status.lastCommit.date)}
            </span>
          ) : null}
          {status.dirty ? (
            <span className="text-[11.5px] text-ink-3" title={dirtyHint(status)}>
              · {dirtyLabel(status)}
            </span>
          ) : null}
        </div>

        {/*
          说明行只在**真的有额外信息**时才显示（比如「这是本地看到的，没联网确认」）。
          新鲜度刚查过时 statusTitle 返回的就是上面那行结论本身，再印一遍纯属噪音。
        */}
        {detailTitle === textFor(verdict, freshness) ? null : (
          <p className="mt-1.5 text-[11.5px] leading-5 text-ink-3">{detailTitle}</p>
        )}
      </div>
    </section>
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
export function RemoteRow({ url }: { url: string | null }) {
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
export function isWebUrl(url: string): boolean {
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
export function RecordView({ record }: { record: string }) {
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
