import { useState } from 'react'
import { FolderOpen } from 'lucide-react'
import { Button, Input } from '@/components/ui'
import { PlatformError, canPickDirectory, pickDirectory } from '@/lib/platform'

/**
 * 路径输入框：**手输永远在，「选目录」只在能选的环境里出现**。
 *
 * 两个环境差别在这里被收成一处（判定在 `lib/platform.ts`）：
 *
 * - 浏览器里开发：没有系统目录选择框，用户手输（这是正常状态，不是缺陷，
 *   所以**不画**那枚按钮——点了没反应的按钮比没有更糟）；
 * - 桌面壳里：左边手输、右边「选择目录…」，选完把绝对路径填回输入框。
 *
 * ## 失败要看得见
 *
 * 选目录失败时**不吞**：把原因显示在控件下面，并保留底层那条 message
 * （`PlatformError` 已经把「不可用」与「用户取消」分开，见 `lib/platform.ts`）。
 * 把失败显示成「用户取消了」是最坏的一种：排查时什么都看不到。
 *
 * ## `children`
 *
 * 给「输入框 + 选目录 + 自己的动作」这种行用（扫描那一行还有一枚「扫描」按钮）。
 * 不这么做的话，每个调用点都得自己再拼一次「有没有能力 → 画不画按钮」，
 * 而那正是这个组件存在的理由。
 */
export function PathField({
  id,
  value,
  onChange,
  placeholder,
  ariaLabel,
  inputClassName = '',
  pickTitle,
  disabled,
  children,
}: {
  id?: string
  value: string
  /** 拿到的是**字符串**，不是事件（选目录回来的也是字符串，两条路同一个出口） */
  onChange: (value: string) => void
  placeholder?: string
  ariaLabel?: string
  inputClassName?: string
  /** 目录选择框的标题（桌面壳里会显示在系统对话框上） */
  pickTitle?: string
  disabled?: boolean
  /** 同一行里跟在后面的其它动作（比如「扫描」） */
  children?: React.ReactNode
}) {
  const canPick = canPickDirectory()
  const [picking, setPicking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const pick = async () => {
    setError(null)
    setPicking(true)
    try {
      const picked = await pickDirectory(pickTitle)
      // null = 用户取消。**什么都不做**，也不当错误——取消是正常操作
      if (picked !== null) onChange(picked)
    } catch (e) {
      setError(
        e instanceof PlatformError ? e.message : `选择目录失败：${e instanceof Error ? e.message : String(e)}`,
      )
    } finally {
      setPicking(false)
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <Input
            id={id}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            aria-label={ariaLabel}
            className={inputClassName}
            disabled={disabled}
          />
        </div>
        {canPick ? (
          <Button className="shrink-0" onClick={() => void pick()} disabled={picking || disabled}>
            <FolderOpen size={14} aria-hidden />
            {picking ? '正在选…' : '选择目录…'}
          </Button>
        ) : null}
        {children}
      </div>
      {error ? (
        <p role="alert" className="text-[12px] text-signal-bad">
          {error}
        </p>
      ) : null}
    </div>
  )
}
