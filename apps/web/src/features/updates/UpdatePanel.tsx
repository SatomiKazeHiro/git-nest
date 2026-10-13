import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import {
  MAX_BATCH_IDS,
  VERDICT_LABEL,
  type UpdateRecommendation,
  type UpdateReport,
} from '@git-nest/core'
import { Button, ErrorNote, Meta } from '@/components/ui'
import { Dialog } from '@/components/Dialog'
import { Delta, RecommendationCell } from '@/features/status/badges'
import { statusText, statusTone } from '@/features/status/text'
import { isPull, isReport, useUpdateTask, type TaskItem, type TaskSnapshot } from './taskStream'
import { useSettings } from '@/features/settings/queries'
import { useInvalidate } from '@/lib/invalidate'

/**
 * 这一条能不能勾（＝能不能安全快进）。
 *
 * **不能只看 `status === 'behind'`**：作者 force push 改写历史时，本地 refs 看到的
 * 只是「落后 N 个」，判决却是 `rewritten`；作者删库重建时是 `unrelated`。
 * 这两种正是这个软件要防的「更新到作者重置/删掉的东西」，
 * 而 `behind` 恰恰是它们的表象。判据用判决自己的 `canPull`。
 */
function canPullNow(report: UpdateReport | null): boolean {
  return report?.recommendation?.canPull === true
}

/** 「别拉」的两种判决：理由必须在行里写全，不能只塞进 tooltip。 */
function isDontPull(r: UpdateRecommendation | null): r is UpdateRecommendation {
  return r?.verdict === 'rewritten' || r?.verdict === 'unrelated'
}

/**
 * 「这一轮正在做哪件事」用哪个词：检查 → 「检查中…」，更新 → 「更新中…」。
 *
 * 判据取**服务端任务快照自带的 `kind`**（`/updates/check`、`/updates/apply`
 * 各自在 `taskSnapshot()` 里给一个），面板不另存一份本地状态：
 * 断线重连时服务端从头重放快照，自己记的那份不会跟着走，
 * 反而会出现「词和真事不一致」——正是原来那个 bug 的形态。
 *
 * 行里与底部按钮**共用这一个函数**：两边各写一次三元，
 * 就是当初「更新跑起来了，行里和按钮都还在说检查中」的来路。
 *
 * 底部那枚主按钮**只在更新真的跑着时**改写文案（那时它换成「更新中…（N/M）」，
 * 见 `applyLabel`）；检查那一档照旧用这里的词——它的行为不该被这次改动碰。
 */
function runningText(kind: TaskSnapshot['kind'] | null | undefined): string {
  return kind === 'apply' ? '更新中…' : '检查中…'
}

/**
 * 更新报告：检查 → 看报告 → 勾选 → 更新 → 结果汇总。
 *
 * 原则是**绝不自动更新**。检查完只是给建议，
 * 真正动工作区的只有用户点了「更新选中的」之后的那一次。
 *
 * **容器是一个宽版弹窗**（原来是一块插进页面流的区域）。理由：它是一次性的任务，
 * 不是页面内容——插在流里时会推移下面的清单表 / 把详情页的「身份信息」和「git 状态」
 * 切开，而且它和清单表是同一套盒子语汇（外框 + 分隔行），屏幕上就同时出现两张「表」。
 * 弹窗还顺手统一了清单页与详情页：同一个动作在哪儿都是同一个形态。
 * 代价是关掉窗口＝放弃这次查看（`reset()` 清掉本地快照）；服务端任务会照跑完并
 * 写进 `update_checks`，这一句写在弹窗说明里，不含糊。
 */
/** 一个「将要被检查」的项目：弹窗在开跑之前就要把它们列出来。 */
export interface CheckTarget {
  id: number
  name: string
  /** 我自己写的项目：设置里没打开「自己的项目也参与检查」时，整批不参与 */
  isOwn: boolean
}

export function UpdatePanel({
  targets,
  onClose,
  includeOwn: includeOwnOverride,
}: {
  /**
   * 要检查的项目，**按调用方给的顺序**——服务端也按这个顺序返回，
   * 所以开跑前画的那张列表在开跑后不会重排。
   */
  targets: CheckTarget[]
  onClose: () => void
  /**
   * **调用方显式表态**：这一轮要不要连「我自己的」一起查。
   *
   * 不传 = 照旧读设置里那个默认（批量面板就是这样）。详情页对单个项目点「检查」
   * 时传 true——用户点名要查这一个，不该被批量默认挡掉。
   *
   * 它同时决定**预告**（下面 `willCheck` / `skipped`）与**请求**，两处共用一个值：
   * 否则会出现「预告说跳过、实际却查了」——这个软件一路在防的就是那类假话。
   */
  includeOwn?: boolean
}) {
  const invalidate = useInvalidate()
  const { task, busy, error, connected, startCheck, startApply, reset } = useUpdateTask(() => {
    // 任务跑完可能改了检查时间与状态，统一走同一个失效入口
    invalidate()
  })
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [confirming, setConfirming] = useState(false)
  const { data: settings, isPending: settingsPending } = useSettings()

  /*
    这一轮会检查谁。规则与服务端**同一条**（判据是 `is_own` 这个布尔，不是分类）：
    设置里没打开时，你自己写的项目整批不参与。

    **设置读回来之前不下判断**：否则会先画一遍「全都要查」的列表、再把几行抽掉。
    这个请求读的是本机数据库，通常几毫秒就回来，等它比看那次闪烁划算。
  */
  /*
    这一轮会检查谁：**先看调用方有没有显式表态，再读设置**。规则与服务端同一条
    （判据是 `is_own` 这个布尔，不是分类）：没打开时，你自己写的项目整批不参与。

    **设置读回来之前不下判断**：否则会先画一遍「全都要查」的列表、再把几行抽掉。
    这个请求读的是本机数据库，通常几毫秒就回来，等它比看那次闪烁划算。
    （调用方显式表态时不必等设置——那时设置根本不参与。）
  */
  const includeOwn = includeOwnOverride ?? settings?.includeOwn ?? false
  const waitingForSettings = includeOwnOverride === undefined && settingsPending
  const willCheck = waitingForSettings ? [] : targets.filter((t) => includeOwn || !t.isOwn)
  const skipped = waitingForSettings ? [] : targets.filter((t) => !includeOwn && t.isOwn)
  /*
    请求里发**全部**目标 id：服务端会按同一条规则再滤一遍，并把它跳过了谁回给我们
    ——那是它的事，不该由前端替它决定（前端也滤一遍只是为了让**开跑之前**那张列表
    和那句话有东西可依；服务端此刻还没机会说话）。
  */
  const ids = targets.map((t) => t.id)

  /*
    报告跑完了才有那条动作带子。先把它取成一个局部量：`footer` 是在 props 位置
    求值的，那个位置没有被内容区那层 `task ? …` 的收窄兜着。
  */
  const finished = task?.status === 'done' ? task : null

  /**
   * 这一轮**检查还是更新**——行里那句词据此选，不再写死「检查中」。
   *
   * 行里出现 `pending` / `running` 的，必然属于**当前这一轮**（一次任务把它的项目
   * 从 pending 起步带来，跑完的都落成 done），所以拿当前快照的 `task.kind` 给它们定词是对的。
   * `task` 还没有时（POST 在路上，行里不会有这两个状态）退回检查，与默认语义一致。
   */
  const runKind = task?.kind ?? null

  /*
    这一屏上**每个项目最近一次的结果**，按项目 id 攒着。

    以前渲染的是「当前这个任务的 items」——一次任务就是一张表，于是「单独重试」
    无从下手：重试一个会把别的行一起抹掉。改成累积之后，一次任务只覆盖它自己带到
    的那几行，其余行留着上一次的结论；全部重查时服务端照样把每个项目都带来
    （从 pending 起步），整张表自然被刷成新的。
  */
  const [rows, setRows] = useState<Map<number, TaskItem>>(new Map())

  useEffect(() => {
    if (!task) return
    setRows((prev) => {
      const next = new Map(prev)
      for (const item of task.items) next.set(item.projectId, item)
      return next
    })
  }, [task])

  const rowItems = [...rows.values()]
  const reports = rowItems.filter((i) => isReport(i.result))
  const results = reports.map((i) => i.result).filter(isReport)
  const failedCount = rowItems.filter((i) => i.state === 'failed').length
  // 「全选可更新的」也得用同一个判据，否则会把「别拉」的那些一起勾上
  const updatable = reports.filter((i) => isReport(i.result) && canPullNow(i.result))
  /** 判定为「别拉」的仓库名——报告列表上方单独提示一句，免得埋在 20 行里 */
  const dontPullNames = reports
    .filter((i) => isReport(i.result) && isDontPull(i.result.recommendation))
    .map((i) => i.name)
  /**
   * 这一轮**更新**刚起步时的范围：勾了哪几个。
   *
   * 它只回答「这一轮的分母是多少、谁在里边」——两个字段在 `startApply` 那一刻定下来、
   * 之后不再变；「已经几个」一律从上面这份累积行里数（见 `applyProgress`）。
   * 所以它不是第二份进度真相，而是缺了就没法知道分母的那个数：任务快照的 `total`
   * 只覆盖这一轮带到的行，而按钮要报的是「用户勾的那一批」有几个。
   *
   * 它的**寿命**由 `applyPending` 那句推导管着：这一轮有了结果就跑完，POST 一起步就
   * 失败则由下面那个 effect 放掉。每次 `startApply` 重新开跑时覆盖。
   */
  const [applyRun, setApplyRun] = useState<{ ids: Set<number>; startingTotal: number } | null>(null)

  /*
    POST 在路上、任务快照还没回来的那一小段：`task` 仍是上一轮的**检查**快照。
    这段时间里底部不能按「`finished` 是不是检查」或「`runKind` 是不是 apply」来判，
    两个判据此刻都还说「这是检查」——于是刚点下去就会掉回那个禁用的检查按钮，
    等快照到了再跳回来。判据加上 `applyRun`（点下去那一刻就有了），这条带子从点击
    起就锁在更新这一档，中途不再换。

    **但这一轮一旦有了结果就要交回去**（`applyFinished`）：`busy` 落回 false 时
    `applyRunning` 已经不成立，若还把 `applyPending` 算作真，文案就永久停在
    「更新中…启动中」——底部锁死、按钮可点却点不出下一步。这里把「有没有结果」
    并进同一个推导，渲染期就正确，不留一帧的旧状态。
  */
  const applyFinished = task !== null && task.kind === 'apply' && task.status !== 'running'
  const applyPending = applyRun !== null && !applyFinished

  /*
    更新正在跑：只有这种时候才把「更新选中的 N 个」留在原地并换成进度文案。
    判据取任务快照的 `kind`，不另记一个「我在更新」的本地开关——断线重连时服务端
    从头重放快照，自己记的那份不会跟着走，正是行里那句词当初出错的来路。
  */
  const applyRunning = busy && runKind === 'apply'

  /**
   * 起跑就没跑起来（服务端拒了 / 网络断了）：把这一轮放掉。
   *
   * `run()` 自己把异常收成 `error` 而不抛出（见 `taskStream.ts`），所以这里只能看
   * `error`。这条与上面 `applyFinished` 各管一头，缺一条底部就锁死：
   * - POST 失败时任务快照根本没换成 apply，`applyFinished` 永远不成立 → 靠这条；
   * - 正常跑完时 `error` 是空的 → 靠 `applyFinished`。
   */
  useEffect(() => {
    if (error && applyRun) setApplyRun(null)
  }, [error, applyRun])

  /*
    更新中那枚按钮的文案。三种状态：
    - 快照还没回来（`applyPending` 但还不是 `applyRunning`）：说「启动中…」，
      因为**此刻一个都还没开始跑**，报「0/2」是抢先替服务端说话；
    - 跑起来了：分子是这批里已经跑完的，分母是**这一轮开头勾的那批**；
    - 其余（含更新收尾后）：交回原来的文案，数仍由现有汇总逻辑给（`picked.size`）。
  */
  const applyProgressNow = applyProgress(rowItems, applyRun)
  const applyLabel = applyRunning
    ? `更新中…（${applyProgressNow.done}/${applyProgressNow.total}）`
    : applyPending
      ? '更新中…启动中'
      : `更新选中的 ${picked.size} 个`

  // 数量多时先确认范围：检查会联网 fetch 十几个仓库，不能一点就开跑
  const threshold = settings?.confirmThreshold ?? 20
  const overThreshold = ids.length > threshold
  /*
    服务端的硬上限（core 的 `limits.ts`，前端读同一个常量）。
    原来前端不知道这个数：项目超过它时点「开始检查」直接吃一个 422「参数有误」，
    用户根本看不出是数量问题。现在提前说清，并给出可操作的两条路。
  */
  const overLimit = ids.length > MAX_BATCH_IDS

  const toggle = (projectId: number) =>
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(projectId)) next.delete(projectId)
      else next.add(projectId)
      return next
    })

  /**
   * 只重查这一个。**不走「整批再来一遍」**：那是一次真实的联网 fetch，
   * 几十个仓库要跑几十秒，而用户要修的往往只是其中一个（网络抖动、代理抽风）。
   */
  const retryOne = (projectId: number) => {
    // 先把这一行清掉：它要重跑，界面上就不该还挂着上一次的结论
    setRows((prev) => {
      const next = new Map(prev)
      next.delete(projectId)
      return next
    })
    // 勾选也一起撤：那是对**旧结论**的勾，新结论出来之前不该保留
    setPicked((prev) => {
      const next = new Set(prev)
      next.delete(projectId)
      return next
    })
    void startCheck([projectId], includeOwn)
  }

  /**
   * 离开「更新中」这一档：回到检查档时把这一轮的范围一并丢掉。
   *
   * 不然它会一直躺在那儿——下一次更新开跑时被覆盖是没错，可「上一轮的分母」和
   * 「这一轮勾了谁」在概念上不该同时存在。
   */
  const leaveApplyRun = () => {
    reset()
    setApplyRun(null)
  }

  const startCheckNow = () => {
    if (overLimit) return
    if (overThreshold && !confirming) {
      setConfirming(true)
      return
    }
    setConfirming(false)
    leaveApplyRun()
    setPicked(new Set())
    void startCheck(ids.length > 0 ? ids : undefined, includeOwn)
  }

  /**
   * 开一轮更新。
   *
   * 开跑这一刻把**分母**记下来（勾了几个），这就是 `applyRun` 存在的唯一理由：
   * 任务快照只报它自己带到的那几行，按钮要报的却是「我勾的这一批」。
   * 「已经几个」不在这里记——那是从累积行里现数的（见 `applyProgress`）。
   */
  const startApplyNow = () => {
    const applyIds = [...picked]
    setApplyRun({ ids: new Set(applyIds), startingTotal: applyIds.length })
    void startApply(applyIds)
  }

  return (
    <Dialog
      size="wide"
      title="联网检查更新"
      description="检查会联网 fetch 远程；更新只在你勾选之后执行，且只做 fast-forward。关掉窗口＝放弃这次查看，服务端仍会跑完并记下结果。"
      onClose={() => {
        leaveApplyRun()
        onClose()
      }}
      /*
        底部那条带子**一直在**，主按钮在右下角——不是躲在头部右上角。
        那是市面上弹窗的样子，也是用户找「我要开始 / 提交」的地方。
        左半边放状态（跑着时是进度与连接，读完后是这一轮的摘要），右半边放动作。

        报告读完时主按钮换成「更新选中的 N 个」，**重新检查退成次要按钮**——
        这一刻用户要做的是更新，不是再查一次。

        **更新跑起来之后这枚按钮不换位置、不消失**：它留在原地禁用，文案改成
        「更新中…（已完成/这一轮总数）」（见 `applyLabel`）。原来它整段时间不见了，
        用户在这一刻恰恰最想知道「正在更新几个 / 已经几个」——底部那个检查按钮上的
        「更新中…」只说在跑，不说跑到哪了。
      */
      footer={
        <div className="flex flex-wrap items-center gap-3">
          {busy ? (
            <>
              <Meta label="进度" value={task ? `${task.done}/${task.total}` : '启动中'} />
              {connected ? null : <Meta label="连接" value="重连中" placeholder />}
            </>
          ) : finished ? (
            <span className="text-[13px] text-ink-2">
              {finished.kind === 'check'
                ? checkSummary(results, failedCount)
                : applySummary(finished)}
            </span>
          ) : null}

          <div className="ml-auto flex flex-wrap items-center gap-3">
            {/*
              报告读完（`finished?.kind === 'check'`）进这一档；**点了更新之后也一直留在这里**
              （`applyPending`）——原来只在检查读完时进，而「点了更新」到「更新快照回来」
              之间 `task` 还是那张检查快照（`finished?.kind === 'check'` 和 `runKind` 都还
              指着检查），于是刚点下去就掉回下面那个禁用的检查按钮，快照到了再跳回来：
              按钮跳一下、用户点的那一刻最想看的进度整段时间看不见。
              更新这一轮走完，`finished` 又成立，这一档自然回到它正常的样子。
            */}
            {finished?.kind === 'check' || applyPending ? (
              <>
                {/* 更新这段（含快照还没回来的那一小段）两个「勾选」动作没有意义——
                    勾选已经交给这一轮了，按原样让位 */}
                {!applyPending && updatable.length > 0 && picked.size < updatable.length ? (
                  <button
                    onClick={() => setPicked(new Set(updatable.map((i) => i.projectId)))}
                    className="text-[12.5px] text-accent hover:underline"
                  >
                    全选可更新的 {updatable.length} 个
                  </button>
                ) : null}
                {!applyPending && picked.size > 0 ? (
                  <button
                    onClick={() => setPicked(new Set())}
                    className="text-[12.5px] text-ink-3 hover:text-ink"
                  >
                    清空勾选
                  </button>
                ) : null}
                {/*
                  这枚按钮**留在原地**：更新进行中它只是禁用 + 报进度，不再消失。
                  文案里的分子分母见 `applyProgress` / `applyRun`。
                */}
                <Button
                  variant="primary"
                  disabled={picked.size === 0 || busy}
                  onClick={startApplyNow}
                >
                  {applyLabel}
                </Button>
                <Button onClick={startCheckNow} disabled={busy || ids.length === 0 || overLimit}>
                  重新检查
                </Button>
              </>
            ) : (
              <Button
                variant="primary"
                onClick={startCheckNow}
                disabled={busy || ids.length === 0 || overLimit}
              >
                {/* 跑着的时候这个词也得按这一轮是什么给——说「检查中」是假话。
                    更新跑着时这枚按钮根本不该出现（那一档由上面 `applyRunning` 接管），
                    这里的 `runningText(runKind)` 是给检查那一档兜底的。 */}
                {busy ? runningText(runKind) : task ? '重新检查' : '开始检查'}
              </Button>
            )}
          </div>
        </div>
      }
    >
      {/* 超过服务端一次能处理的量：说清数字与两条出路，而不是让他去撞那个 422 */}
      {overLimit ? (
        <p className="mb-3 border-l-2 border-signal-ahead bg-panel px-3 py-2 text-[12.5px] text-signal-ahead">
          一次最多检查 {MAX_BATCH_IDS} 个仓库，现在选中了 {ids.length} 个。
          先在清单页勾选一部分再点这里，或者把筛选条件收窄一些。
        </p>
      ) : null}
      {confirming && overThreshold ? (
        <p className="flex flex-wrap items-center gap-3 border-b border-line-soft pb-3">
          <span className="text-[13px] text-signal-ahead">
            要对 {ids.length} 个项目联网 fetch（超过确认阈值 {threshold}），确认吗？
          </span>
          <Button variant="primary" onClick={startCheckNow} disabled={busy}>
            确认，检查这 {ids.length} 个
          </Button>
          <Button onClick={() => setConfirming(false)}>再想想</Button>
        </p>
      ) : null}

      {error ? <ErrorNote message={error} /> : null}

      {/*
        跳过谁、为什么——这件事在**开跑之前**就成立，所以它不在任何分支里。
        原来那句话是「跳过了 X（我自己的）：你自己写的项目默认不参与检查」：
        名字里已经带着「我自己的」，后面又解释一遍，同一句话说两遍。
      */}
      {skipped.length > 0 ? (
        <p className="mb-3 text-[12.5px] text-ink-3">{skipNote(skipped.map((t) => t.name))}</p>
      ) : null}

      {/* 整轮跑不起来（服务端拒了 / 流断了）：说清楚，列表照旧在下面 */}
      {task?.status === 'failed' ? <ErrorNote message={task.error ?? '任务失败'} /> : null}

      {settingsPending ? (
        // 还不知道「自己的项目要不要一起查」，此刻画出来的列表一定是错的
        <p className="py-10 text-center font-mono text-[12px] text-ink-3">…</p>
      ) : targets.length === 0 ? (
        /*
          `targets` 为空只可能是**清单是空的**（列表页没勾选时是「全部筛选结果」，
          非空清单永远不会是 0）。这里不能再说「先去清单里勾选」——弹窗盖着清单，
          那句话在弹窗里做不到；「开始检查」同时是禁用的。
        */
        <p className="text-[13px] text-ink-2">
          清单里还没有项目。先在清单页添加一个（或扫描一个目录），再回来检查。
        </p>
      ) : willCheck.length === 0 ? (
        <p className="text-[13px] text-ink-2">
          这批项目都是你自己写的，一个都不在检查范围内——想查它们，去设置里打开「自己的项目也参与检查」。
        </p>
      ) : (
        <>
          {/*
            「推不推荐更新」不能只藏在每一行的短标签里：20 个仓库里混进两个「别拉」，
            红字会被埋掉。这里单独报一句，名字点出来。
          */}
          {dontPullNames.length > 0 ? (
            <p className="mb-2 border-l-2 border-signal-bad bg-panel px-3 py-2 text-[12.5px] text-signal-bad">
              {dontPullNames.length} 个判定为「别拉」，不能勾选（理由在各自那一行）：
              {dontPullNames.slice(0, 3).join('、')}
              {dontPullNames.length > 3 ? ` 等 ${dontPullNames.length} 个` : ''}
            </p>
          ) : null}

          {/*
            列表**一直在**：开跑前每行是「待检查」，跑起来之后按项目 id 原地换内容。
            单独重试也只换那一行——这正是把结果攒在 `rows` 里、而不是直接渲染
            `task.items` 的原因。
          */}
          <ul>
            {willCheck.map((t) => {
              const item = rows.get(t.id)
              return item ? (
                <TaskRow
                  key={t.id}
                  item={item}
                  runKind={runKind}
                  checked={picked.has(t.id)}
                  onToggle={() => toggle(t.id)}
                  onRetry={() => retryOne(t.id)}
                />
              ) : (
                <PendingRow key={t.id} name={t.name} />
              )
            })}
          </ul>
        </>
      )}
    </Dialog>
  )
}

/**
 * 「跳过了谁、为什么」——**一整句字符串**，不要拆成 JSX 里的几段文字。
 *
 * 拆开写的话，`{names}` 与后面的中文之间那个空格会被 JSX 的空白规则吃掉，
 * 屏幕上就成了「visperse是你自己写的项目」。这种坏法没有报错，只是读起来别扭。
 */
function skipNote(names: string[]): string {
  const who =
    names.length > 3
      ? `${names.slice(0, 3).join('、')} 等 ${names.length} 个`
      : names.length > 1
        ? `${names.join('、')} 这 ${names.length} 个`
        : (names[0] ?? '')
  return `${who} 是你自己写的项目，跳过不查。批量检查默认不带它们；设置里打开「自己的项目也参与检查」就会带上。`
}

/**
 * 还没开跑时的那一行：只报「谁会被检查」。
 *
 * 它刻意与 `TaskRow` 共用一套骨架（勾选框的占位 + 固定宽的名字 + 右边一句状态），
 * 这样点下「开始检查」之后是**行里换内容**，而不是换一个形状。
 */
function PendingRow({ name }: { name: string }) {
  return (
    <li className="border-b border-line-soft py-2 last:border-b-0">
      <div className="flex items-center gap-2.5">
        <span className="w-3.5 shrink-0" />
        <span className="w-40 min-w-0 shrink-0 truncate text-[13px] font-medium text-ink">
          {name}
        </span>
        <span className="font-mono text-[12px] text-ink-3">待检查</span>
      </div>
    </li>
  )
}

function TaskRow({
  item,
  runKind,
  checked,
  onToggle,
  onRetry,
}: {
  item: TaskItem
  /** 这一轮跑的是检查还是更新——决定「running」那一格说什么词 */
  runKind: TaskSnapshot['kind'] | null
  checked: boolean
  onToggle: () => void
  onRetry: () => void
}) {
  const rep = isReport(item.result) ? item.result : null
  const recommendation = rep?.recommendation ?? null
  const pullable = canPullNow(rep)
  const dontPull = isDontPull(recommendation)

  /**
   * 这一行**没拿到结论**吗？没拿到才给「重试」。
   *
   * **不能只看 `item.state === 'failed'`**：网络失败根本不会让任务项失败——
   * `analyze` 自己把 git 的报错收成一个带 `error` 的报告（状态 `error`），服务端
   * 照样 `markDone`。`state === 'failed'` 只在 `analyze` 抛异常时出现，很罕见。
   * 第一版就挂在这个条件上：按钮写好了、测试也过了（我那条测试恰好用了
   * `state: 'failed'` 这个假形状），而真机上一个都不显示。
   */
  const noConclusion = item.state === 'failed' || rep?.error != null

  return (
    <li className="border-b border-line-soft py-2 last:border-b-0">
      <div className="flex items-center gap-2.5">
        {rep ? (
          <input
            type="checkbox"
            checked={checked}
            onChange={onToggle}
            disabled={!pullable}
            title={
              pullable
                ? '勾上就会 ff-only 更新到远程'
                : (recommendation?.reason ?? '这个状态不能安全快进，勾了也没用')
            }
            aria-label={`选择 ${item.name}`}
            className={`list-check shrink-0 ${
              pullable ? '' : 'cursor-not-allowed opacity-40'
            }`}
          />
        ) : (
          <span className="w-3.5 shrink-0" />
        )}

        <Link
          to={`/projects/${item.projectId}`}
          className="w-40 min-w-0 shrink-0 truncate text-[13px] font-medium text-ink hover:text-accent"
        >
          {item.name}
        </Link>

        {/*
          「正在做」与「还没轮到」都要说话。
          `running` 那句词原来写死成「检查中…」——用户点的是「更新选中的 N 个」，
          行里却在说检查，与事实不符。现在按这一轮是什么给（见 `runningText`）。
          `pending` 原来什么都不画：检查受并发限流（默认 4）会排队，更新更是严格串行，
          于是「还没轮到」的那些行整行空白，看起来像卡住了。视觉沿用 running 那一档
          （同样的次级灰 + 等宽），行不会因为这两个词来回跳。
        */}
        {item.state === 'running' ? (
          <span className="font-mono text-[12px] text-ink-3">{runningText(runKind)}</span>
        ) : item.state === 'pending' ? (
          <span className="font-mono text-[12px] text-ink-3">排队中</span>
        ) : item.state === 'failed' ? (
          <span className="text-[12.5px] text-signal-bad">{item.error ?? '失败'}</span>
        ) : rep ? (
          <ReportCell report={rep} />
        ) : isPull(item.result) ? (
          <span
            className={`text-[12.5px] ${
              item.result.outcome === 'failed' ? 'text-signal-bad' : 'text-ink-2'
            }`}
          >
            {item.result.summary}
          </span>
        ) : null}

        {/*
          单独重试：只重查这一个仓库。失败往往是网络 / 代理这类整批性的毛病，
          但重试**不该**把那些已经查好的再 fetch 一遍——那要几十秒。
        */}
        {noConclusion ? (
          <button
            onClick={onRetry}
            className="ml-auto shrink-0 text-[12px] text-accent hover:underline"
            title="只重查这一个仓库"
          >
            重试
          </button>
        ) : null}
      </div>

      {/*
        「别拉」的两种判决（作者改写过历史 / 换了仓库）必须把理由写全：
        这一行是用户决定勾不勾的地方，而这两种情况的表象恰恰是「落后 N 个」——
        只给一个短标签和 tooltip，等于让他自己去猜为什么不能勾。
      */}
      {dontPull ? (
        <p className="mt-1.5 ml-12 text-[12.5px] text-signal-bad">
          {VERDICT_LABEL[recommendation.verdict]}：{recommendation.reason}
        </p>
      ) : null}

      {rep && rep.incoming.length > 0 ? (
        <ul className="mt-1.5 ml-12 flex flex-col gap-0.5">
          {rep.incoming.slice(0, 4).map((c) => (
            <li key={c.shortHash} className="flex gap-2 text-[12.5px]">
              <span className="w-20 shrink-0 truncate font-mono text-[11.5px] text-ink-3">
                {c.shortHash}
              </span>
              <span className="min-w-0 flex-1 truncate text-ink-2">{c.subject}</span>
            </li>
          ))}
          {rep.incoming.length > 4 ? (
            <li className="text-[12px] text-ink-3">
              还有 {rep.incoming.length - 4} 个提交
            </li>
          ) : null}
        </ul>
      ) : null}
    </li>
  )
}

function ReportCell({ report }: { report: UpdateReport }) {
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-1.5">
      <span className={`text-[12.5px] ${statusTone(report.status)}`}>
        {statusText(report.status)}
      </span>
      {report.behind ? <Delta n={report.behind} dir="behind" /> : null}
      {report.ahead ? <Delta n={report.ahead} dir="ahead" /> : null}
      {/* 「推荐」这一格：清单页有这一列、详情页有一段，唯独这个**决定勾不勾**的
          弹窗原来没有。短标签在这里，理由在 title 里；「别拉」的两种在下面
          单独用一行写全理由（见 TaskRow）。 */}
      <RecommendationCell recommendation={report.recommendation} />
      {report.tags.map((t) => (
        <span
          key={t}
          className="rounded-[2px] border border-line px-1 font-mono text-[11px] text-ink-2"
        >
          {t}
        </span>
      ))}
      {report.error ? (
        <span className="text-[12px] text-signal-bad">{report.error.message}</span>
      ) : null}
    </span>
  )
}

/**
 * 更新进行中那枚按钮的进度：`done` 个已经跑完 / `startingTotal` 个这一轮开头勾下的。
 *
 * **分子从累积的任务行里数**，与下面 `checkSummary` 是同一份真相——弹出这个弹窗
 * 本来就把每行的状态攒在 `rows` 里，进度没有第二个来源。数的口径是「这一行有更新结论
 * 了」：更新的结果是一条 `PullResult`（`incoming` 那些才是检查报告），所以
 * `isPull` 就是「这行的更新已经落地」。
 *
 * 分母不能取任务快照的 `total`——那个数说的是「这一轮带到了几行」，而按钮要报的是
 * 「用户勾了几个」；今天两者恰好相等，但这是巧合，不是这条逻辑的前提。
 *
 * `!applyRun`（理论上点不出：能点这枚按钮就说明刚开跑）退回 0/N，不编数。
 */
function applyProgress(
  rowItems: TaskItem[],
  applyRun: { ids: Set<number>; startingTotal: number } | null,
): { done: number; total: number } {
  if (!applyRun) return { done: 0, total: 0 }
  const done = rowItems.filter((i) => applyRun.ids.has(i.projectId) && isPull(i.result)).length
  return { done, total: applyRun.startingTotal }
}

/**
 * 检查完的那句话。
 *
 * **它描述的是「屏幕上这些行」，不是「刚才那一次任务」**：删掉某一行单独重试之后，
 * 一句话如果还按最后一次任务算，就会只报那一个仓库。所以这些数全从累积的行里来
 * ——只有 `failed` 得单独数（失败的仓库没有 report，是一条 item 状态）。
 *
 * 「可更新」按**判决**分，不按 status：作者 force push 过的仓库 status 同样是 `behind`，
 * 但它不能拉。原来写「N 个可更新」把这两种混在一起，和勾选框的判据自相矛盾——
 * 用户问的「有展示推荐与否的 UI 吗」就是这一条。现在分成「可安全快进」与「别拉」。
 */
function checkSummary(reports: UpdateReport[], failed: number): string {
  const parts: string[] = []
  const pullable = reports.filter(canPullNow).length
  const dontPull = reports.filter((r) => isDontPull(r.recommendation)).length
  const count = (status: UpdateReport['status']) => reports.filter((r) => r.status === status).length
  // 桶要互斥，不然「N 个没法检查」会和其它桶重复计数（与服务端同一个口径）
  const counted = count('behind') + count('diverged') + count('up_to_date') + count('ahead')
  const unassessable = reports.length - counted

  if (pullable > 0) parts.push(`${pullable} 个可安全快进`)
  if (dontPull > 0) parts.push(`${dontPull} 个别拉`)
  if (count('up_to_date') > 0) parts.push(`${count('up_to_date')} 个已是最新`)
  if (count('ahead') > 0) parts.push(`${count('ahead')} 个领先远程`)
  if (count('diverged') > 0) parts.push(`${count('diverged')} 个已分叉`)
  if (unassessable > 0) parts.push(`${unassessable} 个没法检查`)
  if (failed > 0) parts.push(`${failed} 个失败`)
  return parts.length > 0 ? `检查完：${parts.join('、')}` : '检查完了'
}

function applySummary(task: TaskSnapshot): string {
  const s = task.summary ?? {}
  const parts: string[] = []
  if (s.updated) parts.push(`已更新 ${s.updated} 个仓库，共 ${s.commits ?? 0} 个提交`)
  if (s.upToDate) parts.push(`${s.upToDate} 个已是最新`)
  if (s.skipped) parts.push(`${s.skipped} 个跳过`)
  if (s.failed) parts.push(`${s.failed} 个失败`)
  return parts.length > 0 ? parts.join(' · ') : '没有改动'
}
