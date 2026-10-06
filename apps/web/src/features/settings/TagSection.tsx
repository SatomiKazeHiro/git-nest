import { useState } from 'react'
import { useCreateTag, useRemoveTag, useTags } from '@/features/projects/queries'
import { Button, ErrorNote, Input } from '@/components/ui'
import { ApiError } from '@/lib/api'

/** 标签管理：自由命名，删掉不影响项目本身。 */
export function TagSection() {
  const { data: tags = [], isPending, error } = useTags()
  const create = useCreateTag()
  const remove = useRemoveTag()
  const [name, setName] = useState('')
  const [color, setColor] = useState('')
  const [banner, setBanner] = useState<string | null>(null)

  const submit = () => {
    const trimmed = name.trim()
    if (!trimmed) return
    create.mutate(
      { name: trimmed, color: color.trim() || null },
      {
        onSuccess: () => {
          setName('')
          setColor('')
          setBanner(null)
        },
        onError: (e) => setBanner(e instanceof ApiError ? e.message : '建标签失败'),
      },
    )
  }

  return (
    <>
      {error ? (
        <div className="mb-3">
          <ErrorNote message="读不到标签列表。" />
        </div>
      ) : null}
      {banner ? (
        <div className="mb-3">
          <ErrorNote message={banner} />
        </div>
      ) : null}

      {/*
        标签是**一份名单加一行新建表单**，不是「一个设置项的两个值」。
        所以它整块占满卡片宽度，而不是塞进右边那块 15rem 的控件区——
        那里放不下「名称 + 颜色 + 新建标签」，硬塞只会把三个都压扁。
      */}
      <div className="border-b border-line-soft px-4 py-2.5 last:border-b-0">
        <p className="text-[13.5px] font-medium text-ink">标签</p>
        <p className="mt-0.5 text-[12.5px] leading-[1.55] text-ink-2">
          自由命名，删掉不会动到项目本身
          <span className="text-ink-3">（只影响清单里的分组与筛选）</span>
        </p>

        <div className="mt-2.5">
          {isPending ? (
            <p className="font-mono text-[12px] text-ink-3">…</p>
          ) : tags.length === 0 ? (
            <p className="text-[12.5px] text-ink-3">
              还没有标签。下面加一个，之后就能在清单里按它筛。
            </p>
          ) : (
            <ul className="flex flex-col">
              {tags.map((t) => (
                <li
                  key={t.id}
                  className="flex items-center gap-2 border-b border-line-soft py-1.5 last:border-b-0"
                >
                  <span
                    className="size-2.5 shrink-0 rounded-full border border-line"
                    style={t.color ? { background: t.color } : undefined}
                  />
                  <span className="font-mono text-[13px] text-ink">{t.name}</span>
                  <span className="font-mono text-[12px] text-ink-3">{t.projectCount} 个项目</span>
                  <button
                    onClick={() =>
                      remove.mutate(t.id, {
                        // 静默失败 = 用户以为删掉了，下次刷新它又回来了
                        onError: (e) => setBanner(e instanceof ApiError ? e.message : '删除失败'),
                      })
                    }
                    className="ml-auto cursor-pointer text-[12px] text-ink-2 hover:text-signal-bad"
                  >
                    删除
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-2.5 flex items-center gap-2">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
              placeholder="标签名"
              aria-label="新标签的名称"
              className="!w-48"
            />
            <Input
              value={color}
              onChange={(e) => setColor(e.target.value)}
              placeholder="#14506E"
              aria-label="新标签的颜色，可留空"
              className="!w-32"
            />
            <Button
              variant="primary"
              className="shrink-0"
              onClick={submit}
              disabled={!name.trim() || create.isPending}
            >
              新建标签
            </Button>
          </div>
        </div>
      </div>
    </>
  )
}
