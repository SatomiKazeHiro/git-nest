import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import type { ProjectListItem } from '@git-nest/core'
import { ErrorNote } from '@/components/ui'
import { Dialog } from '@/components/Dialog'
import { ApiError } from '@/lib/api'
import { useRemoveProject } from './queries'

/**
 * 「移出清单」的确认弹窗。
 *
 * 它删的**只是清单里这一条记录**，磁盘上的仓库与 git 历史一个字节都不动——
 * 这句话必须写在弹窗里，因为「删除」这个词在这里和一个真正的删除长得一样，
 * 而用户最怕的正是「它会不会把我的仓库删了」。
 *
 * 底部两枚按钮交给弹窗自己排版（`cancel` / `confirm`）：它们现在是**固定的一条**，
 * 不再跟着内容滚，也就不用每个弹窗各自拼一遍 `flex justify-end`。
 */
export function RemoveDialog({
  project,
  onClose,
}: {
  project: ProjectListItem
  onClose: () => void
}) {
  const remove = useRemoveProject()
  const [banner, setBanner] = useState<string | null>(null)

  return (
    <Dialog
      title={`把 ${project.name} 移出清单？`}
      onClose={onClose}
      cancel={{ text: '留下' }}
      confirm={{
        text: '移出清单',
        icon: <Trash2 size={14} aria-hidden />,
        variant: 'danger',
        loading: remove.isPending,
        onClick: () =>
          remove.mutate(project.id, {
            onSuccess: onClose,
            onError: (e) => setBanner(e instanceof ApiError ? e.message : '移除失败'),
          }),
      }}
    >
      <p className="text-[13px] text-ink-2">
        只删掉清单里这一条。磁盘上的 <span className="font-mono text-[12px]">{project.path}</span>{' '}
        和它的 git 历史都不动，你写的那段记录和标签关联会一起清掉。
      </p>
      {/* 删除失败不能一声不响地关门：用户会以为删掉了 */}
      {banner ? (
        <div className="mt-3">
          <ErrorNote message={banner} />
        </div>
      ) : null}
    </Dialog>
  )
}
