import { Link } from 'react-router'
import { Pencil, Trash2 } from 'lucide-react'
import type { ProjectListItem, RepoStatus } from '@git-nest/core'
import { formatRelative } from '@/lib/format'
import { useUiStore } from '@/store/ui'
import { AttentionBadge, Diff, SyncBadge, type Comparability } from '@/features/status/badges'
import { ProjectLogo } from './ProjectLogo'
import { folderUrl } from './folderIcon'

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

            默认图用的是 `docs/folder.svg`（32×32，与 logo 同尺寸），不再是 lucide
            的图标——同一格里两种东西长得完全不一样，会显得像两个不同的字段。
          */}
          {p.hasLogo ? (
            <ProjectLogo projectId={p.id} />
          ) : (
            <img
              src={folderUrl}
              alt=""
              aria-hidden
              width={32}
              height={32}
              className="shrink-0 rounded-[3px]"
            />
          )}
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 items-center gap-1.5">
              {/*
                「我自己的」在**清单里不再出现**（原来这里有一枚小人的图标）。
                它不是被丢了：详情页的概览里仍有「身份 · 我自己的」那枚 chip，
                而批量检查跳过谁，检查弹窗顶部会点名说清楚。
              */}
              <Link
                to={`/projects/${p.id}`}
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

      {/* 同步状态：全中性灰，刻意比左边那列低调——它是上下文，不是行动项。
          没有可比对象时它给「—」或「没有上游」，**不给「一致」**（说明见 SyncBadge）。 */}
      <td className="col-sync">
        <SyncBadge
          ahead={status?.ahead ?? null}
          behind={status?.behind ?? null}
          upstreamGone={status?.upstreamGone ?? false}
          hasCheck={p.attention !== 'unchecked'}
          comparable={comparabilityOf(status)}
        />
      </td>

      {/* 差异：两个方向都给。↓ 绿是「远程有新东西」，与状态列的「可更新」对得上 */}
      <td className="col-delta text-right">
        <Diff
          ahead={status?.ahead ?? null}
          behind={status?.behind ?? null}
          hasCheck={p.attention !== 'unchecked'}
          comparable={comparabilityOf(status)}
        />
      </td>

      <td
        className="col-checked truncate text-right font-mono text-[12px] text-ink-3"
        title={p.latestCheck ? `上次检查结果：${p.latestCheck.status}` : '还没检查过'}
      >
        {p.latestCheck ? formatRelative(p.latestCheck.checkedAt) : '没查过'}
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
