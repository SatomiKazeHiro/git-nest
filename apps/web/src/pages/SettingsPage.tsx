import { useState } from 'react'
import { useCreateTag, useRemoveTag, useTags } from '@/features/projects/queries'
import { Button, ErrorNote, Field, Input } from '@/components/ui'
import { ApiError } from '@/lib/api'

export function SettingsPage() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8 px-6 py-6">
      <div>
        <h1 className="text-[22px] font-semibold leading-tight text-ink">设置</h1>
        <p className="mt-1 text-[13px] text-ink-2">这一版先管标签和清单本身，扫描目录在 M4 接上。</p>
      </div>

      <TagSection />

      <section className="border border-dashed border-line px-4 py-3">
        <h2 className="text-[13px] font-semibold text-ink">待接上</h2>
        <ul className="mt-1.5 flex flex-col gap-1 text-[13px] text-ink-2">
          <li>M2 · git 状态列、提交图</li>
          <li>M3 · 批量检查更新、勾选后 ff-only 更新</li>
          <li>M4 · 扫描目录导入、git 超时与并发参数</li>
        </ul>
      </section>
    </div>
  )
}

function TagSection() {
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
      <h2 className="text-[15px] font-semibold text-ink">标签</h2>
      <p className="mt-0.5 text-[13px] text-ink-2">自由命名。删掉标签不会影响项目本身。</p>

      {error ? (
        <div className="mt-3">
          <ErrorNote message="读不到标签列表。" />
        </div>
      ) : null}
      {banner ? (
        <div className="mt-3">
          <ErrorNote message={banner} />
        </div>
      ) : null}

      <ul className="mt-3 flex flex-col gap-1">
        {isPending ? (
          <li className="font-mono text-[12px] text-ink-3">…</li>
        ) : tags.length === 0 ? (
          <li className="text-[13px] text-ink-3">还没有标签。</li>
        ) : (
          tags.map((t) => (
            <li
              key={t.id}
              className="flex items-center gap-2 border-b border-line-soft py-1.5 last:border-0"
            >
              <span
                className="size-2.5 shrink-0 rounded-full border border-line"
                style={t.color ? { background: t.color } : undefined}
              />
              <span className="font-mono text-[13px] text-ink">{t.name}</span>
              <span className="font-mono text-[12px] text-ink-3">
                {t.projectCount} 个项目
              </span>
              <button
                onClick={() => remove.mutate(t.id)}
                className="ml-auto text-[12px] text-ink-2 hover:text-signal-bad"
              >
                删除
              </button>
            </li>
          ))
        )}
      </ul>

      <div className="mt-4 flex flex-col gap-2 border-t border-line-soft pt-4 sm:flex-row sm:items-end">
        <Field label="名称" hint="自由命名">
          {(id) => (
            <Input
              id={id}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
              placeholder="值得回头看"
            />
          )}
        </Field>
        <Field label="颜色" hint="可留空">
          {(id) => (
            <Input
              id={id}
              value={color}
              onChange={(e) => setColor(e.target.value)}
              placeholder="#14506E"
              className="!w-28"
            />
          )}
        </Field>
        <Button variant="primary" onClick={submit} disabled={!name.trim() || create.isPending}>
          新建标签
        </Button>
      </div>
    </section>
  )
}
