import { Link } from 'react-router'
import { FolderGit2, Pencil, Trash2, UserRound } from 'lucide-react'
import type { ProjectListItem, RepoStatus } from '@git-nest/core'
import { formatRelative } from '@/lib/format'
import { useUiStore } from '@/store/ui'
import { AttentionBadge, Diff, SyncBadge } from '@/features/status/badges'

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
          <FolderGit2 size={15} aria-hidden className="mt-[3px] shrink-0 text-ink-3" />
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 items-center gap-1.5">
              {/*
                「我自己的」用图标而不是圆点：清单里已经有两列用颜色编码 git
                事实（状态 / 差异），再来一个圆点会让人以为是某种状态。
                灰色也是刻意的——它是你自己的标注，不是 git 报出来的事实。
                读屏读到的是「我自己的 bilibili-digest」。
                它**不是按钮**：可写字段只在「编辑资料」里改。
              */}
              {p.isOwn ? (
                <>
                  {/* title 挂在外层 span 上：lucide 图标不接 title 属性 */}
                  <span className="shrink-0 text-ink-3" title="我自己的项目：批量检查默认跳过它">
                    <UserRound size={12} aria-hidden />
                  </span>
                  <span className="sr-only">我自己的</span>
                </>
              ) : null}
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
          状态还没读回来时它给「—」，**不给「一致」**（说明见 SyncBadge）。 */}
      <td className="col-sync">
        <SyncBadge
          ahead={status?.ahead ?? null}
          behind={status?.behind ?? null}
          upstreamGone={status?.upstreamGone ?? false}
          hasCheck={p.attention !== 'unchecked'}
          hasStatus={status !== undefined}
        />
      </td>

      {/* 差异：两个方向都给。↓ 绿是「远程有新东西」，与状态列的「可更新」对得上 */}
      <td className="col-delta text-right">
        <Diff
          ahead={status?.ahead ?? null}
          behind={status?.behind ?? null}
          hasCheck={p.attention !== 'unchecked'}
          hasStatus={status !== undefined}
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
