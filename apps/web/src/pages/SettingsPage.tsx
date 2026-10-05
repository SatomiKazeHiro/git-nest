import { useEffect, useState } from 'react'
import { ErrorNote, Field, Input } from '@/components/ui'
import { ApiError } from '@/lib/api'
import { useSaveSettings, useSettings } from '@/features/settings/queries'
import { ScanSection } from '@/features/settings/ScanSection'
import { CommandsSection } from '@/features/settings/CommandsSection'
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

      <CommandsSection />

      <TagSection />

      <section className="border border-dashed border-line px-4 py-3">
        <h2 className="text-[13px] font-semibold text-ink">接下来</h2>
        <p className="mt-1 text-[13px] text-ink-2">
          五个里程碑都做完了：清单、git 状态、批量更新、扫描导入、异常与 Windows 验证。
          往后要么接 Agent，要么就把用不顺手的地方磨一磨。
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
          <NumberField
            label="git 超时"
            hint="毫秒，1000–600000"
            min={1_000}
            max={600_000}
            value={settings.gitTimeoutMs}
            onCommit={(v) => update({ gitTimeoutMs: v })}
          />
          <NumberField
            label="并发上限"
            hint="同时跑几个仓库，1–16"
            min={1}
            max={16}
            value={settings.concurrency}
            onCommit={(v) => update({ concurrency: v })}
          />
          <NumberField
            label="确认阈值"
            hint="超过几个先确认，1–200"
            min={1}
            max={200}
            value={settings.confirmThreshold}
            onCommit={(v) => update({ confirmThreshold: v })}
          />
        </div>
      </div>
    </section>
  )
}

/**
 * 数字设置项：**本地草稿 + 失焦/回车才提交**。
 *
 * 原来是「每次按键就 PATCH」+ 显示值直接来自服务端回值，两个后果都很糟：
 * 1. 中间值必然越界（想从 120000 改成 60000，清空后第一个字符是 `6`）→ 服务端 422
 *    → mutation 状态一变就重渲染 → 受控值被写回旧值 → **用户敲的字符被吞掉**，
 *    那个输入框根本没法正常改；
 * 2. 打一个字发一次请求，还把「正在输入」的语义交给了服务端。
 * 现在输入期间只动本地 state，按回车或失焦时才发一次；越界在前端就拦下来并说明。
 */
function NumberField({
  label,
  hint,
  min,
  max,
  value,
  onCommit,
}: {
  label: string
  hint: string
  min: number
  max: number
  value: number
  onCommit: (v: number) => void
}) {
  const [draft, setDraft] = useState(String(value))
  const [localError, setLocalError] = useState<string | null>(null)
  // 服务端的值变了（别处改的、或保存成功后回读）就同步回草稿
  useEffect(() => {
    setDraft(String(value))
    setLocalError(null)
  }, [value])

  const commit = () => {
    if (draft.trim() === '') {
      setDraft(String(value))
      setLocalError(null)
      return
    }
    const n = Number(draft)
    if (!Number.isFinite(n)) {
      setLocalError('要填一个数字')
      return
    }
    const rounded = Math.round(n)
    if (rounded < min || rounded > max) {
      setLocalError(`要在 ${min} – ${max} 之间`)
      return
    }
    setLocalError(null)
    if (rounded !== value) onCommit(rounded)
  }

  return (
    <Field label={label} hint={hint} error={localError ?? undefined}>
      {(id) => (
        <Input
          id={id}
          type="number"
          min={min}
          max={max}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commit()
            }
          }}
        />
      )}
    </Field>
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
        className="list-check mt-0.5 shrink-0"
      />
      <span>
        <span className="text-[13px] text-ink">{label}</span>
        <span className="block text-[12px] text-ink-3">{hint}</span>
      </span>
    </label>
  )
}
