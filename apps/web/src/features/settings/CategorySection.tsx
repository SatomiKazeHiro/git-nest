import { useState, type ComponentType } from 'react'
import { Archive, BookOpen, FlaskConical, Wrench } from 'lucide-react'
import type { Category } from '@git-nest/core'
import { Button, ErrorNote, Input } from '@/components/ui'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { IconPicker } from '@/features/categories/IconPicker'
import { ApiError } from '@/lib/api'
import {
  useCategoriesQuery,
  useCreateCategory,
  useRemoveCategory,
  useUpdateCategory,
} from '@/features/categories/queries'

/**
 * 分类：**一份名单 + 一行新建**，形态跟着上面「标签」那一段走。
 *
 * 内置四个（知识库 / 备份 / 试验 / 工具）**不给改名、不给删**：它们的 key 写在每个
 * 项目的 `category` 里，是这个软件自带的四个桶。用户自己加的可以改名、可以删——
 * 删掉时引用它的项目退回「未分类」，所以删除要过确认框，而且「会影响几个」写在天明处。
 *
 * 图标这一轮**只展示不选**（服务端已经有 `icon` 字段）：名字认不出来就什么都不显示，
 * 不拿一个占位图标凑数——那会让人以为这个分类本来就有个图标。
 */
const CATEGORY_ICONS: Record<string, ComponentType<{ size?: number; className?: string }>> = {
  'book-open': BookOpen,
  archive: Archive,
  'flask-conical': FlaskConical,
  wrench: Wrench,
}

export function CategorySection() {
  const { data, isPending, error } = useCategoriesQuery()
  const create = useCreateCategory()
  const update = useUpdateCategory()
  const remove = useRemoveCategory()

  const [name, setName] = useState('')
  const [banner, setBanner] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<{ key: string; label: string; icon: string | null } | null>(
    null,
  )
  const [removing, setRemoving] = useState<Category | null>(null)
  /** 新增表单里选中的图标（可空：图标是可选的）。 */
  const [newIcon, setNewIcon] = useState<string | null>(null)

  const categories = data ?? []
  const report = (e: unknown, fallback: string) =>
    setBanner(e instanceof ApiError ? e.message : fallback)

  const submit = () => {
    const trimmed = name.trim()
    if (!trimmed) return
    create.mutate(
      { label: trimmed, icon: newIcon },
      {
        onSuccess: () => {
          setName('')
          setNewIcon(null)
          setBanner(null)
        },
        onError: (e) => report(e, '建分类失败'),
      },
    )
  }

  const saveRename = () => {
    if (!renaming) return
    const trimmed = renaming.label.trim()
    if (!trimmed) return
    update.mutate(
      { key: renaming.key, label: trimmed, icon: renaming.icon },
      {
        // 失败**不关掉输入框**：用户刚敲的名字还在，可以改一改再试
        onSuccess: () => {
          setRenaming(null)
          setBanner(null)
        },
        onError: (e) => report(e, '改分类失败'),
      },
    )
  }

  return (
    <>
      {error ? (
        <div className="mb-3">
          <ErrorNote message="读不到分类列表。" />
        </div>
      ) : null}
      {banner ? (
        <div className="mb-3">
          <ErrorNote message={banner} />
        </div>
      ) : null}

      <div className="border-b border-line-soft px-4 py-2.5 last:border-b-0">
        <p className="text-[13.5px] font-medium text-ink">分类</p>
        <p className="mt-0.5 text-[12.5px] leading-[1.55] text-ink-2">
          内置的四个改不了也删不掉
          <span className="text-ink-3">
            （它们的值写在每个项目上）；自己加的可以改名、可以删——删掉时那些项目退回「未分类」
          </span>
        </p>

        <div className="mt-2.5">
          {isPending ? (
            <p className="font-mono text-[12px] text-ink-3">…</p>
          ) : (
            <ul className="flex flex-col">
              {categories.map((c) => {
                const Icon = c.icon ? CATEGORY_ICONS[c.icon] : undefined
                const isRenaming = renaming?.key === c.key
                return (
                  <li
                    key={c.key}
                    className="flex items-center gap-2 border-b border-line-soft py-1.5 last:border-b-0"
                  >
                    {Icon ? <Icon size={14} className="shrink-0 text-ink-3" /> : null}

                    {isRenaming ? (
                      <>
                        <Input
                          value={renaming.label}
                          onChange={(e) =>
                            setRenaming({ key: c.key, label: e.target.value, icon: renaming.icon })
                          }
                          onKeyDown={(e) => e.key === 'Enter' && saveRename()}
                          aria-label="分类的新名称"
                          className="!w-40"
                        />
                        <Button variant="primary" onClick={saveRename} disabled={update.isPending}>
                          保存
                        </Button>
                        <Button onClick={() => setRenaming(null)}>取消</Button>
                        {/* 触发控件只占一行高，所以这里不再需要 w-full 换行——改名的行高
                            与平时一样（上一版是常显网格，才非得换到下一行） */}
                        <IconPicker
                          value={renaming.icon}
                          onChange={(icon) => setRenaming({ key: c.key, label: renaming.label, icon })}
                        />
                      </>
                    ) : (
                      <>
                        <span className="font-mono text-[13px] text-ink">{c.label}</span>
                        {c.builtin ? (
                          <span className="rounded-[3px] bg-flat-bg px-1.5 py-px text-[11px] text-flat">
                            内置
                          </span>
                        ) : null}
                        <span className="font-mono text-[12px] text-ink-3">
                          {c.projectCount} 个项目
                        </span>
                        {c.builtin ? null : (
                          <span className="ml-auto flex items-center gap-2">
                            <button
                              onClick={() => setRenaming({ key: c.key, label: c.label, icon: c.icon })}
                              className="cursor-pointer text-[12px] text-ink-2 hover:text-ink"
                            >
                              改名
                            </button>
                            <button
                              onClick={() => setRemoving(c)}
                              className="cursor-pointer text-[12px] text-ink-2 hover:text-signal-bad"
                            >
                              删除
                            </button>
                          </span>
                        )}
                      </>
                    )}
                  </li>
                )
              })}
            </ul>
          )}

          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
              placeholder="新分类的名称"
              aria-label="新分类的名称"
              className="!w-48"
            />
            <Button
              variant="primary"
              className="shrink-0"
              onClick={submit}
              disabled={!name.trim() || create.isPending}
            >
              新建分类
            </Button>
          </div>
          {/* 图标是可选的（也可以「不设图标」清掉），所以它排在名字下面一行 */}
          <div className="mt-2">
            <IconPicker value={newIcon} onChange={setNewIcon} />
          </div>
          <p className="mt-1.5 text-[12px] text-ink-3">
            名称随便起（「AI 项目」这种也行）；标识由服务端生成，不会重复。
          </p>
        </div>
      </div>

      {removing ? (
        <ConfirmDialog
          title={`删除分类「${removing.label}」？`}
          description={
            removing.projectCount > 0 ? (
              <>
                会从{' '}
                <span className="font-mono text-[12px]">{removing.projectCount}</span>{' '}
                个项目上摘掉这个分类——项目本身不动，它们会变成「未分类」。
              </>
            ) : (
              <>这个分类现在没有项目在用，删掉它不影响任何项目。</>
            )
          }
          confirmText="删除分类"
          danger
          loading={remove.isPending}
          onConfirm={() =>
            remove.mutate(removing.key, {
              onError: (e) => report(e, '删除失败'),
              // 成败都关：失败时让外面的横幅露出来，别被这一层盖住
              onSettled: () => setRemoving(null),
            })
          }
          onClose={() => setRemoving(null)}
        />
      ) : null}
    </>
  )
}
