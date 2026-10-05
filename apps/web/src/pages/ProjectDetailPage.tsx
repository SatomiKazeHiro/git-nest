import { useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router'
import { ArrowLeft, Pencil, RefreshCw } from 'lucide-react'
import { isRemoteCheckStatus, deriveStatus, VERDICT_LABEL, type RepoStatus, type UpdateRecommendation, type UpdateStatus } from '@git-nest/core'
import { Button, ErrorNote, Meta } from '@/components/ui'
import { formatRelative } from '@/lib/format'
import { useUiStore } from '@/store/ui'
import { ProjectFormDialog } from '@/features/projects/ProjectFormDialog'
import { useProjectStatus } from '@/features/status/queries'
import { Delta, statusTitle, textFor, toneFor, freshnessOf } from '@/features/status/StatusCell'
import { UpdatePanel } from '@/features/updates/UpdatePanel'
import { useProject } from '@/features/projects/queries'

export function ProjectDetailPage() {
  const { id } = useParams()
  const projectId = Number(id)
  const openEdit = useUiStore((s) => s.openEdit)
  const [updating, setUpdating] = useState(false)
  const validId = Number.isFinite(projectId) ? projectId : null
  const { data: project, isPending, error } = useProject(validId)
  // 状态提到页面这一层：missing 的提示要出现在页面最上面，不只是状态面板里
  const { data: status, refresh } = useProjectStatus(validId)

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
    <div className="mx-auto flex max-w-3xl flex-col gap-7 px-6 py-6">
      {status?.status === 'missing' ? (
        <div className="border-l-2 border-signal-bad bg-panel px-4 py-3">
          <p className="text-[13.5px] font-medium text-signal-bad">这个目录不在了</p>
          <p className="mt-1 text-[13px] text-ink-2">
            清单里这一条还在（你写的记录、标签都留着），只是磁盘上找不到
            <span className="font-mono text-[12px]"> {project.path}</span>。
            仓库如果是搬了家或改了名，点「编辑资料」把路径指到新位置就行；要是不用了就「移出清单」。
          </p>
        </div>
      ) : null}

      <div>
        <Link
          to="/"
          className="inline-flex items-center gap-1 font-mono text-[12px] text-ink-3 hover:text-accent hover:underline"
        >
          <ArrowLeft size={13} aria-hidden />
          清单
        </Link>
        <div className="mt-1.5 flex items-start gap-2">
          <h1 className="text-[22px] font-semibold leading-tight text-ink">{project.name}</h1>
          <Button onClick={() => openEdit(project.id)}>
            <Pencil size={14} aria-hidden />
            编辑资料
          </Button>
          <Button
            onClick={() => setUpdating(true)}
            title="联网 fetch 远程，再分析落后多少、推不推荐更新"
          >
            <RefreshCw size={14} aria-hidden />
            联网检查更新
          </Button>
        </div>
      </div>

      <dl className="grid grid-cols-[7rem_1fr] gap-y-2 border-y border-line-soft py-4 text-[13px]">
        <dt className="text-ink-3">本地路径</dt>
        <dd className="min-w-0 truncate font-mono text-[12.5px] text-ink">{project.path}</dd>

        <RemoteRow url={project.remoteUrl} />

        <dt className="text-ink-3">分类</dt>
        <dd className="font-mono text-[12.5px] text-ink">{project.category || '未分类'}</dd>

        <dt className="text-ink-3">标签</dt>
        <dd className="flex flex-wrap items-center gap-1">
          {project.tags.length === 0 ? (
            <span className="text-ink-3">—</span>
          ) : (
            project.tags.map((t) => (
              <span
                key={t.id}
                className="rounded-[2px] border border-line px-1 font-mono text-[11.5px] text-ink-2"
              >
                {t.name}
              </span>
            ))
          )}
        </dd>

        {/* 记录排在标签之后、添加时间之前：它在库里就是 `projects` 表上的一列，
            和上面这几行**同级**。原来它是个和「git 状态」并排的 `<h2>` 分区——
            那是沿用了旧的「备注」列表的位置（列表配得上分区标题），
            换成单列之后就不该再抬一级。 */}
        <dt className="text-ink-3">记录</dt>
        <dd>
          <RecordView record={project.record} />
        </dd>

        <dt className="text-ink-3">添加时间</dt>
        <dd className="font-mono text-[12.5px] text-ink-2">{formatRelative(project.addedAt)}</dd>
      </dl>

      <StatusPanel
        status={status}
        isFetching={refresh.isPending}
        onRefresh={() => refresh.mutate()}
        lastCheckAt={project.latestCheck?.checkedAt ?? null}
        lastCheckStatus={project.latestCheck?.status ?? null}
      />

      <ProjectFormDialog />
      {/* 报告是弹窗：插在流里会把「身份信息」和「git 状态」切开（而且那时它还是个
          与「git 状态」同级的区域） */}
      {updating ? <UpdatePanel ids={[project.id]} onClose={() => setUpdating(false)} /> : null}
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
function Recommendation({ recommendation }: { recommendation: UpdateRecommendation | null }) {
  if (!recommendation) {
    return (
      <p className="mt-2 text-[12.5px] text-ink-3">
        还没检查过更新，所以给不出「推不推荐」——作者有没有改写历史，本地是看不出来的。
      </p>
    )
  }
  const bad = recommendation.verdict === 'rewritten' || recommendation.verdict === 'unrelated'
  return (
    <div
      className={`mt-2 border-l-2 pl-3 ${bad ? 'border-signal-bad' : 'border-line-soft'}`}
      data-testid="recommendation"
    >
      <p className={`text-[13px] font-medium ${bad ? 'text-signal-bad' : 'text-ink'}`}>
        推不推荐更新：{VERDICT_LABEL[recommendation.verdict]}
      </p>
      <p className="mt-0.5 max-w-prose text-[12.5px] text-ink-2">{recommendation.reason}</p>
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
    <section>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h2 className="text-[15px] font-semibold text-ink">git 状态</h2>
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
          disabled={isFetching}
          onClick={onRefresh}
          title="不联网：只重读本机的 git 状态（绕开几秒缓存）。要问远程用上面的「联网检查更新」"
        >
          <RefreshCw size={14} aria-hidden className={isFetching ? 'animate-spin' : ''} />
          {isFetching ? '重读中…' : '重读本地状态'}
        </Button>
      </div>

      <div
        data-testid="status-summary"
        className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-y border-line-soft py-3"
      >
        <span className={`text-[15px] font-medium ${toneFor(verdict, freshness)}`}>
          {textFor(verdict, freshness)}
        </span>
        {status.behind ? <Delta n={status.behind} dir="behind" /> : null}
        {status.ahead ? <Delta n={status.ahead} dir="ahead" /> : null}
        {status.upstream ? (
          <span className="font-mono text-[12px] text-ink-3">上游 {status.upstream}</span>
        ) : null}
        {status.lastCommit ? (
          <span className="font-mono text-[12px] text-ink-3">
            上游最后提交 {formatRelative(status.lastCommit.date)}
          </span>
        ) : null}
        {status.dirty ? (
          <span
            className="font-mono text-[12px] text-ink-3"
            title={dirtyHint(status)}
          >
            · {dirtyLabel(status)}
          </span>
        ) : null}
      </div>

      {/*
        「推不推荐更新」单独一行——它比上面那串事实更需要被看见，
        而且它的依据（上次检查）和上面那些本地 refs 不是一回事，混在一行会说不清。
      */}
      <Recommendation recommendation={status.recommendation} />

      {/*
        说明行只在**真的有额外信息**时才显示（比如「这是本地看到的，没联网确认」）。
        新鲜度刚查过时 statusTitle 返回的就是上面那行结论本身，再印一遍纯属噪音。
      */}
      {detailTitle === textFor(verdict, freshness) ? null : (
        <p className="mt-2 text-[12.5px] text-ink-2" title={detailTitle}>
          {detailTitle}
        </p>
      )}
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
    <>
      <dt className="text-ink-3">远程</dt>
      <dd className="min-w-0 truncate font-mono text-[12.5px] text-ink">
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="text-accent hover:underline"
        >
          {url}
        </a>
      </dd>
    </>
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
    return <p className="text-[13px] text-ink-3">还没写。点上方「编辑资料」写。</p>
  }
  return (
    <p className="max-w-prose whitespace-pre-wrap text-[13.5px] leading-6 text-ink-2">
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
