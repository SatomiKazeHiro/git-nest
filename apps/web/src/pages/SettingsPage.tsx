import { useState } from 'react'
import { ErrorNote, Field, Input } from '@/components/ui'
import { ApiError } from '@/lib/api'
import { useSaveSettings, useSettings } from '@/features/settings/queries'
import { ScanSection } from '@/features/settings/ScanSection'
import { TagSection } from '@/features/settings/TagSection'

export function SettingsPage() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8 px-6 py-6">
      <div>
        <h1 className="text-[22px] font-semibold leading-tight text-ink">设置</h1>
        <p className="mt-1 text-[13px] text-ink-2">影响批量检查更新与 git 执行的参数。</p>
      </div>

      <ScanSection />

      <GitSection />

      <TagSection />

      <section className="border border-dashed border-line px-4 py-3">
        <h2 className="text-[13px] font-semibold text-ink">待接上</h2>
        <p className="mt-1 text-[13px] text-ink-2">
          M5 · 错误归因打磨与 Windows 兼容验证。扫描结果页直接改元数据在 M5。
        </p>
      </section>
    </div>
  )
}

function GitSection() {
  const { data: settings, isPending, error } = useSettings()
  const save = useSaveSettings()
  const [banner, setBanner] = useState<string | null>(null)

  if (error) {
    return (
      <div className="mt-3">
        <ErrorNote message="读不到设置。" />
      </div>
    )
  }
  if (isPending || !settings) {
    return <p className="font-mono text-[12px] text-ink-3">…</p>
  }

  const update = (patch: Parameters<typeof save.mutate>[0]) =>
    save.mutate(patch, {
      onSuccess: () => setBanner(null),
      onError: (e) => setBanner(e instanceof ApiError ? e.message : '保存失败'),
    })

  return (
    <section>
      <h2 className="text-[15px] font-semibold text-ink">批量更新</h2>
      <p className="mt-0.5 text-[13px] text-ink-2">
        更新永远由你勾选后触发，并且只做 fast-forward——不会产生 merge commit，也不会动你没提交的东西。
      </p>

      {banner ? (
        <div className="mt-3">
          <ErrorNote message={banner} />
        </div>
      ) : null}

      <div className="mt-3 flex flex-col gap-3">
        <Toggle
          label="personal 分类也参与检查"
          hint="默认关闭：自己的项目自己清楚。批量检查时会在面板里说明跳过了谁"
          checked={settings.includePersonal}
          disabled={save.isPending}
          onChange={(v) => update({ includePersonal: v })}
        />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="git 超时" hint="毫秒">
            {(id) => (
              <Input
                id={id}
                type="number"
                min={1000}
                max={600000}
                step={1000}
                value={settings.gitTimeoutMs}
                onChange={(e) => update({ gitTimeoutMs: Number(e.target.value) })}
              />
            )}
          </Field>
          <Field label="并发上限" hint="同时跑几个仓库">
            {(id) => (
              <Input
                id={id}
                type="number"
                min={1}
                max={16}
                value={settings.concurrency}
                onChange={(e) => update({ concurrency: Number(e.target.value) })}
              />
            )}
          </Field>
          <Field label="确认阈值" hint="超过几个先确认">
            {(id) => (
              <Input
                id={id}
                type="number"
                min={1}
                max={200}
                value={settings.confirmThreshold}
                onChange={(e) => update({ confirmThreshold: Number(e.target.value) })}
              />
            )}
          </Field>
        </div>
      </div>
    </section>
  )
}

function Toggle({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string
  hint: string
  checked: boolean
  disabled?: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="flex items-start gap-2.5">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 size-3.5 shrink-0 accent-[#14506e]"
      />
      <span>
        <span className="text-[13px] text-ink">{label}</span>
        <span className="block text-[12px] text-ink-3">{hint}</span>
      </span>
    </label>
  )
}
