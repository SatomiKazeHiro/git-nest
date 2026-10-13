import { Link } from 'react-router'
import { AlertTriangle, Pencil, Trash2 } from 'lucide-react'
import type { ProjectListItem, RepoStatus } from '@git-nest/core'
import { formatRelative } from '@/lib/format'
import { useUiStore } from '@/store/ui'
import { AttentionBadge, Diff, type Comparability } from '@/features/status/badges'
import { ProjectLogo } from './ProjectLogo'
import { ProjectTypeBadge } from './ProjectTypeBadge'
import folderUrl from '@/assets/folder.svg'

/**
 * 「上次检查」那一格的悬停说明。
 *
 * 这一格显示的时间**来自更早一次成功的检查**（`latestCheck.checkedAt`）——
 * 库里的失败记录不能刷新它，否则断网后点一次检查，清单页反而会显示刚刚确认过的
 * 绿色「已是最新」。而最近一次尝试失败时又必须说出来，不然用户看到的是
 * 「42 分钟前 / 落后 631」配上一片安静，无从知道那是个旧结论。
 *
 * 所以措辞把**两件事分开写**，并点明时间的来源：先说是哪一次尝试失败了、为什么，
 * 再说显示的那个时间是哪一次的。只说「检查失败」会被读成「这一格的时间不可信」
 * 或者「没有数据」，而它其实是**上一次成功的结论仍然有效**。
 */
function checkedCellTitle(p: ProjectListItem): string {
  const reason = failureReason(p)
  if (reason === null) return p.latestCheck ? `上次检查结果：${p.latestCheck.status}` : '还没检查过'
  const at = formatRelative(p.lastAttempt?.at ?? null)
  // 「没有一次成功」和「有更早一次成功」是两种事实，指错方向比不说更坏
  return p.latestCheck
    ? `最近一次检查失败（${at}）：${reason}；上面显示的时间来自更早一次成功的检查`
    : `最近一次检查失败（${at}）：${reason}；还没有过一次成功的检查`
}

/**
 * 最近一次尝试的失败归因——**有原因就显示**（`missing` / `not_a_repo` 这类状态
 * 本来也带着 error，见 `classifyError`，所以它们一起照顾到了）。
 *
 * 只认 `message`：它是给人看的那一句。旧记录、或者只有 `{ kind: 'network' }`
 * 那种半条记录会在服务端被守卫读成 `error: null`，这里也就跟着没有原因——
 * 那时**不加标记**，一枚说不出原因的警示只会让人更慌，而它旁边那个时间一点也不假。
 *
 * 标题与那枚警示图标**读同一个函数**，所以不会出现「有警示却没写原因」。
 */
function failureReason(p: ProjectListItem): string | null {
  return p.lastAttempt?.error?.message ?? null
}

/**
 * 那两个数字有没有可比的对象。**四种情况分开写**，因为它们都回答「有没有依据」，
 * 而依据缺在哪一步完全不同——把 `null` 当 0 就会说出没依据的话
 * （刷新时「同步状态」先显示「一致」那个 bug 就是这么来的；只分出「读没读到」
 * 一种，它会从「读到了但没有上游」这个门回来）。
 */
function comparabilityOf(s: RepoStatus | undefined): Comparability {
  if (!s) return 'reading'
  if (!s.isRepo) return 'unreadable'
  return s.upstream === null ? 'no-upstream' : 'ready'
}

/**
 * 清单里的一行。
 *
 * 一整行可点：桌面软件的清单表是「点哪一行就选中哪一行」，只让名称那几个像素
 * 可点是网页的做法。三列 git 事实（状态 / 同步 / 差异）都是**读服务端算好的值**，
 * 这一层不按 verdict 重算——算的地方只有一个，在服务端。
 */
export function ProjectRow({
  project: p,
  status,
  current,
  onOpen,
  onRemove,
}: {
  project: ProjectListItem
  status: RepoStatus | undefined
  /** 这一行是不是正显示在右边详情栏里的那个 */
  current: boolean
  onOpen: () => void
  onRemove: () => void
}) {
  const openEdit = useUiStore((s) => s.openEdit)
  // 目录没了：置灰但保留入口，让用户能改路径或移除——不自动消失
  const gone = status?.status === 'missing'

  return (
    <tr
      className={`row-link ${current ? 'row-current' : ''} ${gone ? 'opacity-50' : ''}`}
      title={gone ? '目录不在了。点「编辑资料」可以把它指到新位置。' : undefined}
      onClick={(e) => {
        /*
          整行可点，但**行里有三个自带行为的元件**：名称链接、编辑、删除。
          点到它们时不能顺带跳走——用户明明在点「删除」，却发现右栏也换了项目，
          那是在跟他抢点击。`closest` 一把排除掉。
        */
        if ((e.target as HTMLElement).closest('button, a, input')) return
        onOpen()
      }}
    >
      {/*
        「仓库」一列把名称与路径并在一起（两行），不是两个列：列宽省下来的
        地方正好给「当前分支」腾位置，而路径本来就是「哪一份」的唯一凭据，
        跟在名字下面比单开一列更好认。
      */}
      <td className="col-repo">
        <span className="flex min-w-0 items-start gap-1.5">
          {/*
            这一格原来固定是一枚文件夹图标。**认出 logo 时它就被 logo 顶掉**——
            因为它们是同一件事的两种答案（「这是哪个仓库」），并排放两个图标
            只是在占地方。没认出来就还是那枚文件夹：认不出来是常态。

            默认图用的是 `assets/folder.svg`（32×32，与 logo 同尺寸），不再是 lucide
            的图标——同一格里两种东西长得完全不一样，会显得像两个不同的字段。
          */}
          {p.hasLogo ? (
            <ProjectLogo projectId={p.id} />
          ) : (
            /* 角标要压在图的右下角，所以这一格得是定位容器 */
            <span className="relative shrink-0">
              <img
                src={folderUrl}
                alt=""
                aria-hidden
                width={32}
                height={32}
                className="shrink-0 rounded-[3px]"
              />
              <ProjectTypeBadge type={p.projectType} />
            </span>
          )}
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 items-center gap-1.5">
              {/*
                「我自己的」在**清单里不再出现**（原来这里有一枚小人的图标）。
                它不是被丢了：详情页的概览里仍有「身份 · 我自己的」那枚 chip，
                而批量检查跳过谁，检查弹窗顶部会点名说清楚。
              */}
              <Link
                /* 当前这一行：链接指回清单——**再点一次就是反选**（见 `detailPath`）。
                   名字是这一行最显眼的点击目标，它不跟着变的话，
                   用户点名字关不掉、点空白处却关得掉，那才叫怪。 */
                to={current ? '/' : `/projects/${p.id}`}
                aria-current={current ? 'page' : undefined}
                className="min-w-0 cursor-pointer truncate text-[14px] font-semibold text-ink hover:text-accent-ink"
              >
                {p.name}
              </Link>
            </span>
            <span
              className="mt-px block truncate font-mono text-[11.5px] text-ink-3"
              title={p.path}
            >
              {p.path}
            </span>
          </span>
        </span>
      </td>

      <td className="col-branch">
        <span className="block truncate font-mono text-[12px] text-ink-2">
          {status && status.isRepo ? (status.detached ? '游离 HEAD' : (status.branch ?? '—')) : '—'}
        </span>
      </td>

      {/* 状态：读服务端算好的 attention，前端不按 verdict 重算 */}
      <td className="col-attention">
        <AttentionBadge
          attention={p.attention}
          checkedAt={p.latestCheck?.checkedAt ?? null}
        />
      </td>

      {/*
        差异：两个方向都给。↓ 绿是「远程有新东西」，与状态列的「可更新」对得上。

        **「没有依据」的几种说法也在这里**（正在读 / 读不出来 / 上游被删 / 没配上游）
        ——它们原来住在「同步状态」那一列，那一列按设计文档收掉了
        （5 列：仓库 / 分支 / 状态 / 差异 / 上次检查）。少一列不等于少一句话。
      */}
      <td className="col-delta text-right">
        <Diff
          ahead={status?.ahead ?? null}
          behind={status?.behind ?? null}
          upstreamGone={status?.upstreamGone ?? false}
          hasCheck={p.attention !== 'unchecked'}
          comparable={comparabilityOf(status)}
        />
      </td>

      {/*
        「上次检查」这一格。时间来自**最近一次成功的检查**（`latestCheck`），
        而最近一次尝试失败时旁边挂一枚警示——理由见 `checkedCellTitle`。
        警示只在**有归因**时出现（见 `failureReason`）：一枚说不出原因的警示
        只会让人更慌，而它旁边那个时间一点也不假。
      */}
      <td
        className="col-checked truncate text-right font-mono text-[12px] text-ink-3"
        title={checkedCellTitle(p)}
      >
        <span className="inline-flex items-center justify-end gap-1">
          {failureReason(p) !== null ? (
            <AlertTriangle
              size={12}
              role="img"
              aria-label="最近一次检查失败"
              className="shrink-0 text-signal-bad"
            />
          ) : null}
          {p.latestCheck ? formatRelative(p.latestCheck.checkedAt) : '没查过'}
        </span>
      </td>
      <td className="col-actions">
        <span className="row-actions flex justify-end gap-1">
          <button
            onClick={() => openEdit(p.id)}
            title="编辑资料"
            aria-label={`编辑资料 ${p.name}`}
            className="cursor-pointer rounded-[3px] p-1 text-ink-2 hover:bg-paper hover:text-ink"
          >
            <Pencil size={13} aria-hidden />
          </button>
          <button
            onClick={onRemove}
            title="移出清单"
            aria-label={`移出清单 ${p.name}`}
            className="cursor-pointer rounded-[3px] p-1 text-ink-2 hover:bg-paper hover:text-signal-bad"
          >
            <Trash2 size={13} aria-hidden />
          </button>
        </span>
      </td>
    </tr>
  )
}
