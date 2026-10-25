/**
 * 详情抬头下面那一条**结论**：判决 + 依据 + 理由 + 条件，一处说完。
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
 * **词也一样**：卡顶那个词取自 `ATTENTION_TEXT`（和清单那枚药丸、左栏那一段同一份
 * 词表），不取 `VERDICT_LABEL`。图标、颜色、词、边框色四样因此永远指着同一件事——
 * 判决的锋利度由下面那句理由承担。
 *
 * ## 两块：顶栏只放"状态 + 动作"，其余全是内容
 *
 * 顶栏是**状态**（图标 + 一个词）加上你能对它做的事：**更新**（只有算得出「能干净
 * 快进」时才出现）、**联网同步**、**重读本地状态**。依据（落后多少 / 上游 / 上游
 * 最后提交 / 未提交改动）、理由、条件都在下面。
 *
 * 为什么要把它们分开：状态是**只读的结论**，按钮是**动作**，而"落后 22 个提交"
 * 是**证据**——三件事挤在一行里时，读起来像一串并列的碎片，也让人以为它们是同一层东西。
 *
 * ## 下面那三行各占一个字号，不靠字重凑层次
 *
 * | 行 | 说的是 | 排版 |
 * |---|---|---|
 * | **依据** | 差多少、跟谁比 | 12px，数字与 ref 走等宽 |
 * | **理由** | 为什么是这个判决 | 13px / 1.65，整块里唯一像句子的一行，用正文的 `ink` |
 * | **条件** | 这组依据有多新、周围是什么情况 | 11px，最轻的一档 |
 *
 * 这一块原来三行分别写在 12 / 12.5 / 11.5px 上——**0.5px 的差别眼睛分不出来**，
 * 于是「差多少」「为什么」「什么时候查的」在眼里是同一层，读起来是一串并列的
 * 碎片，最要紧的那句理由也没有比旁边的数字重半分。
 *
 * 行距只有 4px：三行都在解释顶栏那一个判决，是**一块**东西。拉开行距会把它们
 * 拆成三块互不相干的说明，反而要多花一次眼神去拼。
 *
 * ## 删掉了什么（以及为什么）
 *
 * - **整块底色**：绿色铺满一张卡会把"这是结论"喊成"这是状态区"，而结论只需要一个词
 *   加一条线。红色同理——`not-recommended` 的红边已经够醒目，不再额外加红底。
 * - **把「落后远程」当主语**：有判决时，要被扫到的是 `↓22` 那个数字，「落后远程」退成
 *   它的标签（12px 灰、和数字贴在一起）。没判决时（`目录不在了` / `读不出状态`）反过来
 *   ——它就是那一行唯一该说的话，一个字都不能省；省掉，剩下就只有一句"点联网同步问
 *   一次远程"，而那个目录根本不在。
 * - **「…查的。数字来自上次检查 fetch 到的…」那一整句方法论**：它把上一条已经说过的
 *   数字又说了一遍，还占着三行最小号的字。现在可见的只有一个时间点（`27 分钟前联网
 *   查的`），整句挪进 `title`。**限定语没有丢**——「没联网确认」那层限定本来就写在
 *   状态词里（`textFor`），而陈旧的时间点自己就写着 1 天前。
 * - **理由里那些上面已经说过的东西**：不用动时的「已是最新，没有要拉的。」、能快进
 *   时的「到远程的 22 个提交」。这两句都由 `text.ts` 的 `reasonFor()` 一处决定
 *   （判据是数据，不是匹配文案）。
 *
 * ## 三枚按钮不能合并
 *
 * | | 更新 | 联网同步 | 重读本地状态 |
 * |---|---|---|---|
 * | 接口 | `POST /updates/apply`（只这一个 id） | `POST /updates/check`（只这一个 id） | `GET /projects/:id/status?fresh=true` |
 * | 联网 | **会**（pull 自己先 fetch） | **会** fetch（只动 `refs/remotes/*`） | **绝不** |
 * | 改什么 | **写工作区**（`pull --ff-only`） | 写 `repo_state`：落后数 / 判决 / 要拉的提交 | 只重读本机 git（分支 / 脏 / 本地 refs） |
 * | 什么时候有 | 只有 `canPull`（能干净快进）时**才出现** | 一直有 | 一直有 |
 *
 * 前两枚的区别不是"联网的强度"，而是**动不动你的文件**：联网同步只问远程、只写库，
 * 你随时点都安全；更新会改工作区，所以它只在算得出「不破坏本地仓库」时出现
 * （判据 `canPull`：判决 safe 且确实落后）。三枚都做成一枚的话，用户永远不知道
 * "更新"指的是问远程、重读磁盘，还是把代码拉下来。图标也分开
 * （`ArrowDownToLine` / `Globe` / `RefreshCw`）。
 *
 * **更新不弹确认框**：它只 fast-forward，工作区脏或有改写嫌疑时服务端直接跳过并
 * 说明原因（`refuseReason` + `pull` 的 preflight），不会产生 merge commit。
 * 清单行内那颗「更新」是同一条路。
 *
 * **依赖方向**：只往下依赖 `@git-nest/core`、`@/components/ui`、`@/components/icons`、
 * `@/lib/format` 与同目录的 `text` / `badges`；不许反向依赖 `features/projects` 或 `pages`。
 */
import { ArrowDownToLine, Globe, RefreshCw } from 'lucide-react'
import {
  deriveStatus,
  isRemoteCheckStatus,
  type Attention,
  type RepoStatus,
  type UpdateStatus,
} from '@git-nest/core'
import { Button } from '@/components/ui'
import { Icon, STATUS_ICON_TONE, type IconName } from '@/components/icons'
import { formatRelative } from '@/lib/format'
import { freshnessOf, reasonFor, statusTitle, textFor, worktreeNote } from './text'
import { ATTENTION_TEXT, Delta } from './badges'

/** 五个状态桶。图标注册表里还有「全部仓库」「我自己的」两枚，它们不是状态 */
type StatusIconName = Exclude<IconName, 'all-repositories' | 'mine'>

/**
 * 判决 → 左栏那五个桶里的一员。**这是唯一一处映射**：图标、颜色、边框色都由它决定，
 * 于是「可更新」在左栏、清单、详情抬头长得一模一样。
 *
 * 没有判决（还没联网问过、目录不在了、读不出来）落在 `pending-check`（中性灰）：
 * 那不是"一种结论"，而是"还没有结论"。
 */
function bucketOf(status: RepoStatus): StatusIconName {
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

/**
 * 桶 → 行动分类。**卡顶那个词不再是判决的声音，而是行动分类的声音**——和它头顶
 * 那枚图标、那道边框色、以及清单里同一行的药丸是同一套话（`ATTENTION_TEXT`）。
 *
 * 原来卡顶取的是 `VERDICT_LABEL`，于是 `safe 但没东西可拉` 那一档自相矛盾：
 * 图标是青色的「已同步」勾、清单写「已同步」、卡顶写「可更新」。判决的锋利度没有
 * 丢——`别拉` 那一层风险本来就写在下面那句理由里，而且说得更具体（谁改了历史、
 * 拉了会怎样）。
 */
const BUCKET_ATTENTION: Record<StatusIconName, Attention> = {
  updatable: 'ready',
  synced: 'synced',
  'not-recommended': 'blocked',
  'needs-decision': 'decide',
  'pending-check': 'unchecked',
}

/**
 * 上游 ref：`origin/` 只是「哪台远程」，`main` 才是你在跟的那个分支。
 *
 * 整串一样亮时，眼睛得从头读到尾才知道跟的是哪个分支；把远程那段压灰一档，
 * 落点直接落在分支名上。切在**第一个**斜杠——远程名里不会带斜杠，分支名会
 * （`origin/feature/x` 是 `origin/` + `feature/x`）。没有斜杠的（本地分支配的
 * 本地上游）整串正常显示，不硬拆。
 */
function UpstreamRef({ name }: { name: string }) {
  const cut = name.indexOf('/')
  return (
    <span
      className="font-mono text-[11.5px]"
      title={`跟的上游：${name}。它指向上次 fetch 到的那个远程分支的位置`}
    >
      {cut < 0 ? (
        <span className="text-ink-2">{name}</span>
      ) : (
        <>
          <span className="text-ink-3">{name.slice(0, cut + 1)}</span>
          <span className="text-ink-2">{name.slice(cut + 1)}</span>
        </>
      )}
    </span>
  )
}

export function StatusCard({
  status,
  isFetching,
  onRefresh,
  onSync,
  syncing,
  onUpdate,
  updateState,
  lastCheckAt,
  lastCheckStatus,
}: {
  status: RepoStatus | undefined
  isFetching: boolean
  onRefresh: () => void
  /** 联网同步这一个仓库（fetch + 算，会写库） */
  onSync?: () => void
  syncing?: boolean
  /**
   * 更新这一个仓库（`pull --ff-only`，**会写工作区**）。不传 = 不给这个入口。
   *
   * 只在算得出「能干净快进」时才调用方会给：`recommendation.canPull`（判决 safe
   * 且确实落后）。和清单行内那颗「更新」是同一个判据的两种读法——行内读库里的
   * `attention === 'ready'`，这里读现场现算的 recommendation。
   */
  onUpdate?: () => void
  /** 这一次更新跑到哪了（按仓库取，不是全局）；没跑过 = null */
  updateState?: { busy: boolean; failed: boolean; text?: string } | null
  lastCheckAt: string | null
  lastCheckStatus: UpdateStatus | null
}) {
  /*
    **读状态的时候要先占住位置。**

    读一次 git 要几个进程 + 磁盘，慢的时候一两秒；而这张卡一出现就把下面的标签栏
    整个推下去 100 来 px。那一下的抖动比等待本身更烦人——它让你以为界面出错了。

    所以这里不是一行字，而是**一个先占住卡片位置的框**：同样的宽度、同样的圆角与
    内边距，高度先按最常见的那一档占住（有判决 + 一句理由，量出来是 120px = 7.5rem）。

    两个刻意的选择：

    - **虚线描边，不是实线**。虚线是这个界面里「这里还没有东西」的说法（`Meta` 的
      placeholder、`EmptyState` 都是虚线）；换成实线灰框，就会先装成一张「没有判决
      的卡」，等真卡片来了再变颜色。
    - **不铺骨架条、不加动画**。全仓的读中状态都是一行等宽灰字（清单 / README /
      项目都是），这里再引入一套跳动的骨架条，等于为了 0.5 秒另开一种视觉语言；
      而静态的它也不会在慢加载里一直闪。

    真实高度会差一档：已同步那种没有理由，矮 26px；「别拉」的长理由会更高。所以
    抖动没有归零，但从「一行字撑成一张卡」降到了几十 px。

    **7.5rem 这个数是量出来的，不是猜的**（有判决 + 一句理由，120px）。它跟着上面
    那张字号表走：哪天改了字号或行高，这里要重量一次——量法就是拿一张最常见的卡
    截图，看像素高度。
  */
  if (!status) {
    return (
      <div
        role="status"
        className="flex min-h-[7.5rem] w-full min-w-0 items-center rounded-[4px] border border-dashed border-line px-3 py-2.5"
      >
        <p className="font-mono text-[12px] text-ink-3">正在读 git 状态…</p>
      </div>
    )
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
        // 它只是「拉了会不会踩到你」的一句提醒，退到条件那一行。
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
  /*
    没有判决时（目录不在了 / 读不出来 / 还没查过）没东西可分类，卡顶就直说那句
    状态词：`目录不在了` 比一个笼统的「待检查」有用得多。
  */
  const primary = status.recommendation
    ? ATTENTION_TEXT[BUCKET_ATTENTION[bucket]]
    : statusWord
  /*
    「能不能动手」的判据是 `canPull`——判决 safe **且**真的落后。不是「落后 > 0」：
    本地领先、已是最新、上游被删这些都不该给更新按钮；也不能只看判决 safe，
    因为「已是最新」也是 safe。清单行内那颗按钮用的是同一件事的另一份读数
    （`attention === 'ready'`，读库），这里读现场。
  */
  const canUpdate = Boolean(status.recommendation?.canPull)

  /*
    下面三行**按需出现，空行不出空位**。

    `missing` / `不是 git 仓库` 这两个状态下三行全是空的，而原来那个 `mt-2` 的盒子
    照样渲染——卡片底部于是多出 8px 谁也不负责的空白，看起来像少了点东西。
  */
  /*
    什么时候才允许出现「…联网查的」这一格：**只有这张卡正在比较远程的时候**。

    `hasRemoteCheck` 只说明「库里有过一次合格的远程检查」，而那次检查可能属于很久
    以前那个还存在的仓库。目录不在了 / 上游被删了 / 游离 HEAD 之后，那些数字已经不
    适用——把「13 分钟前联网查的」挂在「目录不在了」旁边，读起来像是我刚查过这个目录
    却得出这么个结论。所以再守一道：这次展示的结论本身得是远程比较（`isRemoteCheckStatus`）。
  */
  const checkNote =
    hasRemoteCheck && lastCheckAt && isRemoteCheckStatus(verdict) ? formatRelative(lastCheckAt) : null
  /*
    这一行到底写哪句话——**只有一处决定**：
    - 有判决：问 `reasonFor()`。它决定「写不写、写 core 的哪一份」：不用动的那档
      不写，「可以快进」那档换成 core 不带数字的说法（数字上面已经印着了）；
    - 没判决（目录不在了 / 读不出来 / 没上游…）：写 `provenance`，也就是这类状态
      唯一能说的那句解释。它不能借用判决的理由，因为压根没有判决。
  */
  const reasonText = status.recommendation ? reasonFor(status.recommendation) : provenance
  /*
    两个数字**任何时候都不许被省掉**（它们是这一块最该被扫到的东西），所以
    `hasFacts` 除了状态词和 ref，也把 ahead/behind 算进来——万一哪天判决的短标签
    和状态词变成了同一个词，这一行也不至于整块消失。
  */
  const hasFacts =
    statusWord !== primary ||
    Boolean(status.behind) ||
    Boolean(status.ahead) ||
    status.upstream !== null
  const hasReason = reasonText !== ''
  const worktree = worktreeNote(status)
  const hasConditions = checkNote !== null || status.lastCommit !== null || worktree !== null

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
        顶栏：状态（图标 + 一个词）+ 你能对它做的事（更新 / 联网同步 / 重读本地状态）。

        上一版把"落后多少 / 上游 / 上游最后提交 / 未提交改动"也挤在这一行里，于是
        这一行同时承担「结论」和「依据」两件事，读起来像一堆并列的碎片。现在这条线
        只回答"这个仓库现在算哪一档、能不能动手"，依据整块挪到下面。
      */}
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <Icon name={bucket} size={16} className={`shrink-0 ${tone}`} aria-hidden />
        <span className={`text-[15px] font-medium ${tone}`}>{primary}</span>

        <span className="ml-auto flex shrink-0 items-center gap-1">
          {/*
            **更新**：能干净快进时才出现（`canPull`），不出现禁用态——一个按下去
            只会被服务端跳过的按钮，就是死控件。它是这三枚里唯一**会写工作区**的，
            所以用主按钮的蓝（这个应用里蓝 = 你能点的），另外两枚保持灰。
            顺序：动手的（更新）→ 先问远程的（联网同步）→ 只重读的（重读本地状态）。
          */}
          {onUpdate && canUpdate ? (
            <Button
              size="sm"
              /* 失败那一下要看得出来：蓝底白字说「更新失败」等于没说。红边（danger
                 那档就是鬼影红）和清单行内那颗按钮的做法一致。 */
              variant={updateState?.failed ? 'danger' : 'primary'}
              disabled={updateState?.busy}
              onClick={onUpdate}
              title={
                updateState?.text ??
                '把这一个仓库快进到远程（只做 fast-forward，不产生 merge commit；工作区有改动时会被跳过）'
              }
            >
              <ArrowDownToLine size={12} aria-hidden />
              {updateState?.busy ? '更新中…' : updateState?.failed ? '更新失败' : '更新'}
            </Button>
          ) : null}
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

      {/* 内容：依据 → 理由 → 条件（三个字号，见文件头那张表） */}
      {hasFacts || hasReason || hasConditions ? (
        <div className="mt-2.5 flex flex-col gap-y-1">
          {/*
            依据。**两组、两种间距**：「落后远程 ↓22」是标签与值，`origin/main` 是
            「跟谁比」——另一件事。原来五样东西等距（gap-x-3）排成一串，读起来像
            五个并列的碎片；而且窄栏换行时，被挤下去的那一样会落到不相干的事实底下。
            现在组内 8px、组间 12px，换行至少按「组」换。
          */}
          {hasFacts ? (
            <div
              className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5"
              title={detailTitle}
            >
              <span className="inline-flex flex-wrap items-baseline gap-x-2">
                {/*
                  状态词只在**和顶栏那个词不同**时出现：顶栏是行动分类（可更新 /
                  已同步 / 不推荐 / 需要确认 / 待检查），这里是 git 的事实（落后远程 /
                  已是最新）。同一个词不写两遍。
                */}
                {statusWord !== primary ? (
                  <span className="text-[12px] text-ink-2">{statusWord}</span>
                ) : null}
                {status.behind ? <Delta n={status.behind} dir="behind" /> : null}
                {status.ahead ? <Delta n={status.ahead} dir="ahead" /> : null}
              </span>
              {status.upstream ? <UpstreamRef name={status.upstream} /> : null}
            </div>
          ) : null}

          {/*
           理由：**整块里唯一按正文排的一句**——13px、行高 1.65、用的是正文的 `ink`
           而不是旁边那两档的 `ink-2`。依据和条件是用来扫的，这一句是要**读**的
           （很多情况下它是「别拉」背后唯一让人停手的说明）。

           这不会把判决喊下去：判决是 15px + 一枚图标 + 全卡唯一的一处颜色，
           三样一起压着；而深色的正文在这个应用里本来就是常态，不是强调手段。
          */}
          {hasReason ? (
            <p className="max-w-[80ch] text-[13px] leading-[1.65] text-ink [overflow-wrap:anywhere]">
              {reasonText}
            </p>
          ) : null}

          {/*
           条件：一个**可能改变答案**的本地事实（工作区里的改动）+ 这组依据有多新
           （上游最后一次提交 / 什么时候联网查的）。**都是「前提」，不是结论**，
           所以整行压在 11px。

           顺序与深浅不是随手定的：工作区那句排第一、并且单独深一档（`ink-2`）。
           判决本身**故意不管脏**（见上面 `skipDirty`），而更新遇到脏工作区会**跳过**
           （`pull.ts` 的 preflight），所以「这次更新可能动不了」只在这里出现——把它
           混在两个时间戳中间、还同一档灰，就等于让它自生自灭。时间戳是来路，
           这句是**提醒**：提醒该配得上更重的那一档。

           它说的也是**具体的**那一类改动，不是「有未提交的改动」这一句笼统话
           （见 `worktreeNote`）：改过的已跟踪文件会被更新踩到，未跟踪的新文件多半
           只是构建产物——两者被同一句话盖住，用户就会觉得这工具在没事拦路。

           第三个时间点是**我们什么时候看的**，不是仓库什么时候变的。这一格原来
           还驮着一整句方法论（为什么要这样算），现在那句话在 `detailTitle` 里，
           鼠标停一下能看全。
          */}
          {hasConditions ? (
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[11px] leading-4 text-ink-3">
              {worktree ? (
                <span className="text-ink-2" title={worktree.title}>
                  {worktree.text}
                </span>
              ) : null}
              {status.lastCommit ? (
                <span title="上游分支上最后一个提交距今多久——它就是这次要拉到的终点">
                  上游最后提交 {formatRelative(status.lastCommit.date)}
                </span>
              ) : null}
              {checkNote ? (
                <span title={detailTitle}>{checkNote}联网查的</span>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
