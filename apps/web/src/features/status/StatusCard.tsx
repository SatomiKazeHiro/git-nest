/**
 * 详情抬头下面那一条**结论**：判决 + 依据 + 理由 + 来路，一处说完。
 *
 * ## 它为什么长这样
 *
 * 这个软件一阶段最要紧的输出是「拉不拉」，所以这里只做**一处强调**：判决。强调的
 * 方式不是铺一块底色，而是**一条语气色的细边框 + 同色的图标与判决词**——一条线足够
 * 说「这块是关于 git 的、结论是绿的」，不必让整块背景去喊。
 *
 * 图标**走左侧过滤面板同一套**（`@/components/icons` 的注册表）：`可更新 / 已同步 /
 * 不推荐 / 需要确认 / 待检查` 五个桶在左栏、清单、这里长得一样，用户学一次就够。
 * 颜色也从那一套来（`STATUS_ICON_TONE`），不在这里另配一份。
 *
 * ## 两块：顶栏只放"状态 + 两个动作"，其余全是内容
 *
 * 顶栏只有三样——**状态**（图标 + 一个词）、**联网同步**、**重读本地状态**。
 * 依据（落后多少 / 上游 / 上游最后提交 / 未提交改动）、理由、来路都在下面。
 *
 * 为什么要把它们分开：状态是**只读的结论**，两个按钮是**动作**，而"落后 22 个提交"
 * 是**证据**——三件事挤在一行里时，读起来像一串并列的碎片，也让人以为它们是同一层东西。
 *
 * ## 删掉了什么（以及为什么）
 *
 * - **整块底色**：绿色铺满一张卡会把"这是结论"喊成"这是状态区"，而结论只需要一个词
 *   加一条线。红色同理——`not-recommended` 的红边已经够醒目，不再额外加红底。
 * - **有判决时的「落后远程」**：`↓22` 说的就是它，理由那句里还有一遍。
 *   **但没判决时必须留着**：`目录不在了` / `读不出状态` 不是"建议"，却是那一行
 *   唯一该说的话；省掉它，剩下就只有一句"点联网同步问一次远程"，而那个目录根本不在。
 *
 * ## 两枚按钮不能合并
 *
 * | | 联网同步 | 重读本地状态 |
 * |---|---|---|
 * | 接口 | `POST /updates/check`（只这一个 id） | `GET /projects/:id/status?fresh=true` |
 * | 联网 | **会** fetch 远程（只动 `refs/remotes/*`） | **绝不** |
 * | 改什么 | 写 `repo_state`：落后数 / 判决 / 要拉的提交 | 只重读本机 git（分支 / 脏 / 本地 refs） |
 *
 * 数据源本来就是两条（远程事实入库、本地事实现场读）。合成一个按钮的话，
 * 用户永远不知道"更新"指的是问远程还是重读磁盘。图标也分开（`Globe` vs `RefreshCw`）。
 *
 * **依赖方向**：只往下依赖 `@git-nest/core`、`@/components/ui`、`@/components/icons`、
 * `@/lib/format` 与同目录的 `text` / `badges`；不许反向依赖 `features/projects` 或 `pages`。
 */
import { Globe, RefreshCw } from 'lucide-react'
import {
  VERDICT_LABEL,
  deriveStatus,
  isRemoteCheckStatus,
  type RepoStatus,
  type UpdateStatus,
} from '@git-nest/core'
import { Button } from '@/components/ui'
import { Icon, STATUS_ICON_TONE, type IconName } from '@/components/icons'
import { formatRelative } from '@/lib/format'
import { freshnessOf, statusTitle, textFor } from './text'
import { Delta } from './badges'

/**
 * 判决 → 左栏那五个桶里的一员。**这是唯一一处映射**：图标、颜色、边框色都由它决定，
 * 于是「可更新」在左栏、清单、详情抬头长得一模一样。
 *
 * 没有判决（还没联网问过、目录不在了、读不出来）落在 `pending-check`（中性灰）：
 * 那不是"一种结论"，而是"还没有结论"。
 */
function bucketOf(status: RepoStatus): IconName {
  const r = status.recommendation
  if (!r) return 'pending-check'
  switch (r.verdict) {
    case 'safe':
      // safe 且真的能拉 → 可更新；safe 但没东西可拉（已是最新 / 本地领先）→ 已同步
      return r.canPull ? 'updatable' : 'synced'
    case 'rewritten':
    case 'unrelated':
      return 'not-recommended'
    case 'diverged':
      return 'needs-decision'
    default:
      // gone / no_upstream：上游那边有问题，不是"别拉"，给中性的待检查
      return 'pending-check'
  }
}

export function StatusCard({
  status,
  isFetching,
  onRefresh,
  onSync,
  syncing,
  lastCheckAt,
  lastCheckStatus,
}: {
  status: RepoStatus | undefined
  isFetching: boolean
  onRefresh: () => void
  /** 联网同步这一个仓库（fetch + 算，会写库） */
  onSync?: () => void
  syncing?: boolean
  lastCheckAt: string | null
  lastCheckStatus: UpdateStatus | null
}) {
  if (!status) {
    return <p className="w-full font-mono text-[12px] text-ink-3">正在读 git 状态…</p>
  }

  // server 侧的 latestCheck 只在「真正问到远程」时才非空；这里再用共享判定守一道。
  // 拿不到合格状态就按「从没查过」处理——宁可说不知道，也不说没依据的肯定。
  const hasRemoteCheck = Boolean(lastCheckStatus && isRemoteCheckStatus(lastCheckStatus))
  const freshness = hasRemoteCheck ? freshnessOf({ checkedAt: lastCheckAt }) : 'never'

  /*
    **不是仓库时不要重算状态。**
    `deriveStatus` 的第一条是「不是仓库就返回 not_a_repo」，而 `missing`（目录不在了）
    与 `error`（读不出来 / 路径过长）在 core 里同样是 `isRepo: false`——重算会把它们
    一起说成「不是 git 仓库」，与同屏顶部的横幅自相矛盾。是仓库才降级 dirty 重算。
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
        // 这一条要回答的是「跟远程差多少、该不该拉」，所以**脏标记不当主角**：
        // 它只是「拉了会不会踩到你」的一句提醒，退到依据那一行的末尾。
        skipDirty: true,
      })
    : status.status

  const detailTitle = statusTitle(
    { ...status, status: verdict },
    { checkedAt: hasRemoteCheck ? lastCheckAt : null },
  )

  /** 状态词（落后远程 / 已是最新 / 目录不在了…）。**没有判决时它就是主行** */
  const statusWord = textFor(verdict, freshness)
  const provenance = detailTitle === statusWord ? '' : detailTitle
  const bucket = bucketOf(status)
  const tone = STATUS_ICON_TONE[bucket]
  const primary = status.recommendation ? VERDICT_LABEL[status.recommendation.verdict] : statusWord

  return (
    /*
      一个盒子，**边框取语气色**（`border-current` 吃下面那个 `tone`），不铺底色：
      一条线 + 一枚图标 + 一个词，三样同色，就是这整块的强调。
    */
    <section
      role="status"
      aria-atomic="true"
      data-testid="status-summary"
      className={`w-full min-w-0 rounded-[4px] border border-current px-3 py-2.5 ${tone}`}
    >
      {/*
        顶栏**只有三样**：状态（图标 + 一个词）、联网同步、重读本地状态。

        上一版把"落后多少 / 上游 / 上游最后提交 / 未提交改动"也挤在这一行里，于是
        这一行同时承担「结论」和「依据」两件事，读起来像一堆并列的碎片。现在这条线
        只回答"这个仓库现在算哪一档"，依据整块挪到下面。
      */}
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <Icon name={bucket} size={16} className={`shrink-0 ${tone}`} aria-hidden />
        <span className={`text-[15px] font-medium ${tone}`}>{primary}</span>

        <span className="ml-auto flex shrink-0 items-center gap-1">
          {onSync ? (
            <Button
              size="sm"
              disabled={syncing}
              onClick={onSync}
              title="联网 fetch 这个仓库（只动 refs/remotes/*），再重算落后多少、推不推荐更新"
            >
              <Globe size={12} aria-hidden className={syncing ? 'animate-spin' : ''} />
              {syncing ? '同步中…' : '联网同步'}
            </Button>
          ) : null}
          <Button
            size="sm"
            disabled={isFetching}
            onClick={onRefresh}
            title="不联网：只重读本机的 git 状态（绕开几秒缓存）。要问远程用左边那个「联网同步」"
          >
            <RefreshCw size={12} aria-hidden className={isFetching ? 'animate-spin' : ''} />
            {isFetching ? '重读中…' : '重读本地状态'}
          </Button>
        </span>
      </div>

      {/* 内容：依据 → 理由 → 来路。三行各说一件事，行距比行内间距大一点 */}
      <div className="mt-2 flex flex-col gap-1">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
          {/*
            状态词只在**和顶栏那个词不同**时出现：顶栏是判决（可更新 / 别拉），
            这里是事实（落后远程 / 已是最新）。同一个词不写两遍。
          */}
          {statusWord !== primary ? (
            <span className="text-[12px] text-ink-2">{statusWord}</span>
          ) : null}
          {status.behind ? <Delta n={status.behind} dir="behind" /> : null}
          {status.ahead ? <Delta n={status.ahead} dir="ahead" /> : null}
          {status.upstream ? (
            <span className="font-mono text-[11.5px] text-ink-2">{status.upstream}</span>
          ) : null}
          {status.lastCommit ? (
            <span className="text-[11.5px] text-ink-3">
              上游最后提交 {formatRelative(status.lastCommit.date)}
            </span>
          ) : null}
          {status.dirty ? (
            <span
              className="text-[11.5px] text-ink-3"
              title="工作区有未提交的改动；拉到会碰到它们的提交时会被拦下"
            >
              有未提交的改动
            </span>
          ) : null}
        </div>

        {status.recommendation || provenance ? (
          <p className="max-w-[80ch] text-[12.5px] leading-5 text-ink-2 [overflow-wrap:anywhere]">
            {status.recommendation ? status.recommendation.reason : provenance}
          </p>
        ) : null}

        {/* 来路：只在**有判决**时出现——没判决时上面那句已经把话说完了 */}
        {status.recommendation && provenance ? (
          <p className="text-[11.5px] leading-5 text-ink-3">
            {hasRemoteCheck ? (
              <>
                <span className="font-mono">{formatRelative(lastCheckAt!)}</span> 查的。
              </>
            ) : null}
            {provenance}
          </p>
        ) : null}
      </div>
    </section>
  )
}
