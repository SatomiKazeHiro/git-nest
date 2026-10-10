/**
 * 详情页那张「推不推荐更新」卡：判决 + 依据 + 说明。
 *
 * **它属于状态域，不属于项目详情页。** 卡里那几条判断都是状态域的**政策**，
 * 换一个地方显示这张卡也必须照做，所以它们不该跟着页面走：
 *
 * 1. 只有 `safe` 一个判决配绿底（`VERDICT_LOOK`），`rewritten` / `unrelated`
 *    配红，其余三个**不着色**——绿色在这个应用里只表示「可以安全快进」。
 * 2. 不是仓库时**不重算** `deriveStatus`：`missing`（目录不在了）与
 *    `path_too_long`（读不出来）在 core 里同样是 `isRepo: false`，
 *    重算会把它们一起说成「不是 git 仓库」，跟同屏顶部的横幅自相矛盾。
 * 3. 脏标记按 `skipDirty` 降级成旁边一句灰字：这张卡要回答的是
 *    「跟远程差多少、该不该拉」，不是「你工作区脏没脏」。
 *
 * **依赖方向**：本文件只往下依赖 `@git-nest/core`、`@/components/ui`、
 * `@/lib/format` 与同目录的 `text` / `badges`。**不许反向依赖
 * `features/projects` 或 `pages`**——那会让状态域认识「项目详情页」，
 * 正是把这块搬出来要断掉的边。
 */
import { AlertTriangle, CheckCircle2, HelpCircle, RefreshCw } from 'lucide-react'
import {
  VERDICT_LABEL,
  deriveStatus,
  isRemoteCheckStatus,
  type RepoStatus,
  type UpdateRecommendation,
  type UpdateStatus,
  type UpdateVerdict,
} from '@git-nest/core'
import { Button, Meta } from '@/components/ui'
import { formatRelative } from '@/lib/format'
import { VERDICT_TONE, freshnessOf, statusTitle, textFor, toneFor } from './text'
import { Delta } from './badges'

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
 * 分支名不再显示——这个软件不做 git 客户端，用户也从没问过自己在哪个分支。
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
