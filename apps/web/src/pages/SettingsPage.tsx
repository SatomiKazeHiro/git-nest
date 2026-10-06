import { useEffect, useId, useState } from 'react'
import { ErrorNote, Input } from '@/components/ui'
import { ApiError } from '@/lib/api'
import { useSaveSettings, useSettings } from '@/features/settings/queries'
import { ScanSection } from '@/features/settings/ScanSection'
import { CommandsSection } from '@/features/settings/CommandsSection'
import { TagSection } from '@/features/settings/TagSection'
import { SettingRow, SettingSection } from '@/features/settings/SettingRow'

/**
 * 设置页。
 *
 * 分区**不按代码模块分，按「这个设置能对你机器做什么」分**。原来的四段
 * （扫描 / 批量更新 / 自动 fetch / 标签）是照着组件文件切的，扫一眼看不出
 * 它们之间是什么关系——而真正要紧的关系只有两条：
 *
 * 1. 往清单里加东西：只写本地那个 SQLite 文件，不联网、不碰仓库
 * 2. 联网检查与更新：会 fetch 远程引用；动工作区只在你勾选之后，且只 ff-only
 *
 * 这个分类不是排版需要，它就是设计文档第 1 节那两条约定（绝不自动更新、
 * 自动做的事必须留痕）在界面上的落点。所以第二组给它一道左侧竖线——
 * 颜色在这里表示「这组配错了会动你的文件」。
 */
export function SettingsPage() {
  return (
    <div>
      {/* 不要再套一层滚动容器：`.content` 已经是外层滚动区了，嵌套的滚动区
          会抢同一个滚轮，而且内层那条滚动条永远用不上（内容总是恰好一样高）。 */}
      <header className="border-b border-line px-6 py-3">
        <h1 className="text-[17px] font-semibold leading-tight text-ink">设置</h1>
        <p className="mt-1 text-[12.5px] text-ink-2">
          存在本机数据库里，不进任何会被提交的文件。改动立刻生效，不用重启服务。
        </p>
      </header>

      {/*
        封一个上限宽度。宽屏上让设置项一路铺到 1400px 并没有好处：控件离说明
        太远，眼睛要在那一行里横跨半个屏幕才能对上号。左侧对齐，不居中——
        这页全是左对齐的中文正文加等宽数字，居中会破坏那条竖直的读法。
      */}
      <div className="max-w-4xl px-6 py-6">
        <SettingSection
          title="往清单里加东西"
          note="只写本机的清单，不联网、不读仓库内容。扫出来的东西还要你挑一遍才会进清单。"
        >
          <ScanSection />
          <TagSection />
        </SettingSection>

        <SettingSection
          title="联网检查与更新"
          note="这一组会让全部仓库联网。只 fetch 远程引用，绝不碰工作区——更新永远由你勾选后触发，并且只做 fast-forward。"
          emphasis
        >
          <GitSection />
          <CommandsSection />
        </SettingSection>
      </div>
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
    <>
      {banner ? (
        <div className="mb-3">
          <ErrorNote message={banner} />
        </div>
      ) : null}

      <SettingRow
        label="personal 分类"
        hint="自己的项目自己清楚，默认不参与。打开后批量检查会带上它们，跳过了谁会在报告里说明。"
      >
        <Toggle
          label="参与检查"
          checked={settings.includePersonal}
          disabled={save.isPending}
          onChange={(v) => update({ includePersonal: v })}
        />
      </SettingRow>

      <SettingRow
        label="git 超时"
        hint="一条 git 命令超过这么久就放弃，毫秒。仓库大、网络慢的时候调高；卡死了要少等就调低。"
      >
        <NumberField
          label="git 超时"
          hint="毫秒，1000–600000"
          min={1_000}
          max={600_000}
          value={settings.gitTimeoutMs}
          onCommit={(v) => update({ gitTimeoutMs: v })}
        />
      </SettingRow>

      <SettingRow
        label="并发上限"
        hint="同时跑几个仓库。调高更快，但更容易撞上远程限流。"
      >
        <NumberField
          label="并发上限"
          hint="1–16"
          min={1}
          max={16}
          value={settings.concurrency}
          onCommit={(v) => update({ concurrency: v })}
        />
      </SettingRow>

      <SettingRow
        label="确认阈值"
        hint="一次要检查的项目超过这么多个，先问一句再开跑。检查会让这些仓库全部联网。"
      >
        <NumberField
          label="确认阈值"
          hint="1–200"
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
 * 数字框给固定宽度：控件列右边空着是故意的（所有控件左边缘对齐成一条竖线），
 * 但输入框本身跟着列拉宽就会变成一条难按的细长条。
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
    <div className="max-w-52">
      {/*
        这里**不再重复行标签**——左边那列已经写着「git 超时」了，控件里再印
        一遍就成了同一句话出现两次。控件区只留两样东西：输入框，和它下面那行
        范围提示（出错时同一个位置换成错误说明）。

        可访问名交给 `aria-label`，于是读屏读到的仍然是「git 超时」，
        `getByLabelText('git 超时')` 也照旧找得到。
      */}
      <Input
        type="number"
        aria-label={label}
        aria-describedby={describedBy}
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
      <p
        id={describedBy}
        className={`mt-1 text-[11.5px] ${localError ? 'text-signal-bad' : 'text-ink-3'}`}
      >
        {localError ?? hint}
      </p>
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
