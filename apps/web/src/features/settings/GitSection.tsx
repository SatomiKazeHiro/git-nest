import { useEffect, useId, useState } from 'react'
import { ErrorNote, Input } from '@/components/ui'
import { ApiError } from '@/lib/api'
import { SettingRow } from './SettingRow'
import { useSaveSettings, useSettings } from './queries'

/** 一组「会联网」的设置。它们原来住在设置页里，页面删掉后搬到这里。 */
export function GitSection() {
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
    <>
      {banner ? (
        <div className="mb-3">
          <ErrorNote message={banner} />
        </div>
      ) : null}

      <SettingRow
        name="自己的项目也参与检查"
        desc="默认只检查你追踪的别人的仓库"
        note="在「编辑资料」里勾了「这是我自己写的项目」的，默认会被跳过"
      >
        <Toggle
          label="参与检查"
          checked={settings.includeOwn}
          disabled={save.isPending}
          onChange={(v) => update({ includeOwn: v })}
        />
      </SettingRow>

      <SettingRow
        name="git 超时"
        desc="一条 git 命令超过这么久就放弃"
        note="毫秒，1000–600000"
      >
        <NumberField
          label="git 超时"
          min={1_000}
          max={600_000}
          value={settings.gitTimeoutMs}
          onCommit={(v) => update({ gitTimeoutMs: v })}
        />
      </SettingRow>

      <SettingRow name="并发上限" desc="同时跑几个仓库" note="1–16，越高越容易撞上远程限流">
        <NumberField
          label="并发上限"
          min={1}
          max={16}
          value={settings.concurrency}
          onCommit={(v) => update({ concurrency: v })}
        />
      </SettingRow>

      <SettingRow name="确认阈值" desc="一次加入清单超过这么多个，先问一句再动手" note="1–200">
        <NumberField
          label="确认阈值"
          min={1}
          max={200}
          value={settings.confirmThreshold}
          onCommit={(v) => update({ confirmThreshold: v })}
        />
      </SettingRow>
    </>
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
 *
 * 数字框给固定宽度：它在右侧那块区域里居中，跟着内容伸缩就会变成一条难按的细长条。
 *
 * 它**不印范围**——范围是左侧那句浅灰括号的事（`note`）。两处各印一次，
 * 同一句话会在屏幕上出现两遍。
 */
function NumberField({
  label,
  min,
  max,
  value,
  onCommit,
}: {
  label: string
  min: number
  max: number
  value: number
  onCommit: (v: number) => void
}) {
  const [draft, setDraft] = useState(String(value))
  const [localError, setLocalError] = useState<string | null>(null)
  const describedBy = useId()
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
    <div className="w-32">
      {/*
        这里**不再重复行标签**——左边已经写着「git 超时」了，控件里再印一遍
        就成了同一句话出现两次。可访问名交给 `aria-label`，于是读屏读到的
        仍然是「git 超时」，`getByLabelText('git 超时')` 也照旧找得到。
      */}
      <Input
        type="number"
        aria-label={label}
        aria-describedby={localError ? describedBy : undefined}
        aria-invalid={localError ? true : undefined}
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
      {/* 只在出错时占一个位置——范围提示由左侧那句浅灰括号负责 */}
      {localError ? (
        <p id={describedBy} className="mt-1 text-[11.5px] text-signal-bad">
          {localError}
        </p>
      ) : null}
    </div>
  )
}

function Toggle({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string
  checked: boolean
  disabled?: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="list-check"
      />
      <span className="text-[13px] text-ink">{label}</span>
    </label>
  )
}
