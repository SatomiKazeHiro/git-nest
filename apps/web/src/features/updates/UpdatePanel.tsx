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
}: {
  /**
   * 要检查的项目，**按调用方给的顺序**——服务端也按这个顺序返回，
   * 所以开跑前画的那张列表在开跑后不会重排。
   */
  targets: CheckTarget[]
  onClose: () => void
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
  const includeOwn = settings?.includeOwn ?? false
  const willCheck = settingsPending ? [] : targets.filter((t) => includeOwn || !t.isOwn)
  const skipped = settingsPending ? [] : targets.filter((t) => !includeOwn && t.isOwn)
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
    void startCheck([projectId])
  }

  const startCheckNow = () => {
    if (overLimit) return
    if (overThreshold && !confirming) {
      setConfirming(true)
      return
    }
    setConfirming(false)
    reset()
    setPicked(new Set())
    void startCheck(ids.length > 0 ? ids : undefined)
  }

  return (
    <Dialog
      size="wide"
      title="联网检查更新"
      description="检查会联网 fetch 远程；更新只在你勾选之后执行，且只做 fast-forward。关掉窗口＝放弃这次查看，服务端仍会跑完并记下结果。"
      onClose={() => {
        reset()
        onClose()
      }}
      /*
        底部那条带子**一直在**，主按钮在右下角——不是躲在头部右上角。
        那是市面上弹窗的样子，也是用户找「我要开始 / 提交」的地方。
        左半边放状态（跑着时是进度与连接，读完后是这一轮的摘要），右半边放动作。

        报告读完时主按钮换成「更新选中的 N 个」，**重新检查退成次要按钮**——
        这一刻用户要做的是更新，不是再查一次。
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
            {finished?.kind === 'check' ? (
              <>
                {updatable.length > 0 && picked.size < updatable.length ? (
                  <button
                    onClick={() => setPicked(new Set(updatable.map((i) => i.projectId)))}
                    className="text-[12.5px] text-accent hover:underline"
                  >
                    全选可更新的 {updatable.length} 个
                  </button>
                ) : null}
                {picked.size > 0 ? (
                  <button
                    onClick={() => setPicked(new Set())}
                    className="text-[12.5px] text-ink-3 hover:text-ink"
                  >
                    清空勾选
                  </button>
                ) : null}
                <Button
                  variant="primary"
                  disabled={picked.size === 0 || busy}
                  onClick={() => void startApply([...picked])}
                >
                  更新选中的 {picked.size} 个
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
                {busy ? '检查中…' : task ? '重新检查' : '开始检查'}
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
  checked,
  onToggle,
  onRetry,
}: {
  item: TaskItem
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

        {item.state === 'running' ? (
          <span className="font-mono text-[12px] text-ink-3">检查中…</span>
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
