import type { ReactNode } from 'react'

/**
 * 设置页的一行：**左边名称与说明，右边控件**。
 *
 * 原来整页是「标题 + 说明段落 + 控件」竖着堆在一列窄栏里（`max-w-2xl`），
 * 于是两件事同时变糟：那一大段解释（"服务启动 30 秒后自动跑一轮 fetch…"）
 * 被压成一条难读的窄行，而横向空间全部浪费。桌面软件的设置页反过来——
 * 说明放在它所描述的那个控件**旁边**，两边各拿到该有的宽度。
 *
 * **两列的宽度是写死的，不看窗口。** 外面那层 `.settings-body` 已经是固定
 * 宽度（见 `index.css`），行内不需要任何断点：标签列给 `minmax(22rem,22rem)`
 * 是因为**最小值不能是 0**——`minmax(0, …)` 允许这一列塌掉，于是窗口一窄
 * 控件列就被挤成一条缝（输入框溢出、按钮压成两行、底部冒出横向滚动条）。
 *
 * `sm:` 那个断点只是**浏览器里的兜底**：桌面包了最小宽度之后根本走不到它。
 */
export function SettingRow({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <div className="grid gap-x-8 gap-y-1.5 border-b border-line-soft py-3.5 last:border-b-0 sm:grid-cols-[minmax(22rem,22rem)_minmax(0,1fr)] sm:items-start">
      <div className="min-w-0">
        <p className="text-[13px] font-medium text-ink">{label}</p>
        {hint ? (
          <p className="mt-1 max-w-prose text-[12.5px] leading-[1.6] text-ink-2">{hint}</p>
        ) : null}
      </div>
      {/* 控件顶端与**名称**顶端对齐，不是与说明的底边对齐——后者会让控件
          在带说明的行上比不带说明的行低一截，整列控件就不在一条线上了。 */}
      <div className="min-w-0 sm:pt-px">{children}</div>
    </div>
  )
}

/**
 * 一个分区。
 *
 * `emphasis` 给左侧一道 2px 的强调线，用在**唯一能动你工作区的那一组**上。
 * 这不是装饰：颜色在这里表示「这组设置配错了会动你的文件」，与全应用
 * 「颜色只用来编码事实」那条约定同源。别的分区一律安静。
 */
export function SettingSection({
  title,
  note,
  emphasis,
  children,
}: {
  title: string
  /** 一句话说明这组设置**会做什么**——按后果写，不按功能名写 */
  note: string
  emphasis?: boolean
  children: ReactNode
}) {
  return (
    <section
      className={`mb-8 ${emphasis ? 'border-l-2 border-accent pl-4' : ''}`}
    >
      <header className="mb-1">
        <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
        <p className="mt-1 max-w-prose text-[12.5px] leading-[1.6] text-ink-2">{note}</p>
      </header>
      <div className="mt-1">{children}</div>
    </section>
  )
}
