import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import type { ProjectListItem } from '@git-nest/core'
import { ErrorNote } from '@/components/ui'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { ApiError } from '@/lib/api'
import { useRemoveProject } from './queries'

/**
 * 「移出清单」的确认弹窗。
 *
 * 它删的**只是清单里这一条记录**，磁盘上的仓库与 git 历史一个字节都不动——
 * 这句话必须写在弹窗里，因为「删除」这个词在这里和一个真正的删除长得一样，
 * 而用户最怕的正是「它会不会把我的仓库删了」。
 *
 * 形状交给 `ConfirmDialog`：标题措辞、`留下`/`移出清单` 的文案、危险色、忙碌态
 * 都只有一份（另一个「移出清单」在扫描弹窗里，用的是同一个组件）。
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
    <ConfirmDialog
      title={`把 ${project.name} 移出清单？`}
      description={
        <>
          只删掉清单里这一条。磁盘上的{' '}
          <span className="font-mono text-[12px]">{project.path}</span>{' '}
          和它的 git 历史都不动，你写的那段记录和标签关联会一起清掉。
        </>
      }
      confirmText="移出清单"
      cancelText="留下"
      confirmIcon={<Trash2 size={14} aria-hidden />}
      danger
      loading={remove.isPending}
      onConfirm={() =>
        remove.mutate(project.id, {
          onSuccess: onClose,
          onError: (e) => setBanner(e instanceof ApiError ? e.message : '移除失败'),
        })
      }
      onClose={onClose}
    >
      {/* 删除失败不能一声不响地关门：用户会以为删掉了 */}
      {banner ? (
        <div className="mt-3">
          <ErrorNote message={banner} />
        </div>
      ) : null}
    </ConfirmDialog>
  )
}
