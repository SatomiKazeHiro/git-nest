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
    <section>
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
        标签本身是一个**列表**，不是一个设置项：它是已经存在的东西，不是可以
        拨动的开关。所以它不套 `SettingRow`（那会把它伪装成一个配置项），
        自己用一张窄的名单，占住左侧的标签列。
      */}
      <div className="grid gap-x-8 gap-y-1.5 border-b border-line-soft py-3.5 sm:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] sm:items-start">
        <div>
          <p className="text-[13px] font-medium text-ink">标签</p>
          <p className="mt-1 max-w-prose text-[12.5px] leading-[1.6] text-ink-2">
            自由命名，删掉标签不会动到项目本身。标签只影响清单里的分组与筛选。
          </p>
        </div>

        <div className="min-w-0">
          {isPending ? (
            <p className="font-mono text-[12px] text-ink-3">…</p>
          ) : tags.length === 0 ? (
            // 空状态要给出下一步动作，而不是只陈述「什么都没有」
            <p className="border border-dashed border-line px-3 py-2.5 text-[12.5px] text-ink-3">
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

          <div className="mt-3 flex items-center gap-2">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
              placeholder="标签名"
              aria-label="新标签的名称"
              className="!w-40"
            />
            <Input
              value={color}
              onChange={(e) => setColor(e.target.value)}
              placeholder="#14506E"
              aria-label="新标签的颜色，可留空"
              className="!w-28"
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
    </section>
  )
}
