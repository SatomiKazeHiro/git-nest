import { useEffect, useId, useState } from 'react'
import { ErrorNote, Input } from '@/components/ui'
import { ApiError } from '@/lib/api'
import { useSaveSettings, useSettings } from '@/features/settings/queries'
import { ScanSection } from '@/features/settings/ScanSection'
import { CommandsSection } from '@/features/settings/CommandsSection'
import { TagSection } from '@/features/settings/TagSection'
import {
  CheckRow,
  FieldPack,
  FieldRow,
  SettingSection,
} from '@/features/settings/SettingRow'

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
    // 不要再套一层滚动容器：`.content` 已经是外层滚动区了，嵌套的滚动区
    // 会抢同一个滚轮，而且内层那条滚动条永远用不上（内容总是恰好一样高）。
    <div className="settings-body px-6 py-6">
      <header className="mb-8 border-b border-line pb-4">
        <h1 className="text-[17px] font-semibold leading-tight text-ink">设置</h1>
        <p className="mt-1 max-w-prose text-[12.5px] leading-[1.6] text-ink-2">
          存在本机数据库里，不进任何会被提交的文件。改动立刻生效，不用重启服务。
        </p>
      </header>

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

      {/*
        复选框**在标签左边**，且只有一行短说明。
        原来它是「标签在左列 / 复选框在最右列」——框和它的文字被甩到屏幕两端，
        框到底管的是哪一句得靠位置去猜。软件里几乎没有这种排法。
      */}
      <CheckRow
        label="personal 分类也参与检查"
        hint="自己的项目自己清楚，默认不参与。打开后批量检查会带上它们，跳过了谁会在报告里说明。"
        checked={settings.includePersonal}
        disabled={save.isPending}
        onChange={(v) => update({ includePersonal: v })}
      />

      {/*
        这三个是**同一件事的三次出现**——都是「批量操作怎么跑」。
        各占一整行会把它们拉成三段互不相干的文字，所以并排成一行；
        每条只留范围与取舍的提示，长解释交给上面的分组注释。
      */}
      <div className="mt-5">
        <FieldPack>
          <FieldRow label="git 超时" hint="毫秒，1000–600000">
            <NumberField
              label="git 超时"
              min={1_000}
              max={600_000}
              value={settings.gitTimeoutMs}
              onCommit={(v) => update({ gitTimeoutMs: v })}
            />
          </FieldRow>
          <FieldRow label="并发上限" hint="1–16">
            <NumberField
              label="并发上限"
              min={1}
              max={16}
              value={settings.concurrency}
              onCommit={(v) => update({ concurrency: v })}
            />
          </FieldRow>
          <FieldRow label="确认阈值" hint="1–200">
            <NumberField
              label="确认阈值"
              min={1}
              max={200}
              value={settings.confirmThreshold}
              onCommit={(v) => update({ confirmThreshold: v })}
            />
          </FieldRow>
        </FieldPack>
      </div>
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
 * 数字框给固定宽度：并排三列时，跟着列拉宽会变成一条难按的细长条。
 *
 * 它**不印范围提示**——那件事归外层 `FieldRow`（标签左边、提示在控件下面）。
 * 两个地方各印一次，同一句话会在屏幕上出现两遍。
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
    <div className="max-w-24">
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
      {/* 只在出错时占一个位置。范围提示由 FieldRow 印，避免同一句话出现两遍。 */}
      {localError ? (
        <p id={describedBy} className="mt-1 text-[11.5px] text-signal-bad">
          {localError}
        </p>
      ) : null}
    </div>
  )
}

