import type { ReactNode } from 'react'

/**
 * 设置页的三种排版单元。
 *
 * 为什么不是「每个设置一行、左边一段说明右边一个控件」——那版读起来像一份
 * 表单说明，不像软件设置。对照成熟软件（PyCharm / VS Code / macOS 系统设置）
 * 能看出三个差别，这三个差别就是下面这三个原语：
 *
 * 1. **分组标题带一条延伸到右边缘的细横线**，控件紧贴在它下面形成一个整体。
 *    每行之间一条分隔线的话，每一行都是一座孤岛，永远聚不成组。
 * 2. **同类的设置并排放**。三个数字设置是同一件事的三次出现，就该在一行里；
 *    一Setting 一行把它们拉成了三段互不相干的文字。
 * 3. **短设置没有说明段落**，也不拆成左右两栏。复选框在**标签左边**——
 *    软件里几乎没有「标签在左、复选框在最右」这种排法，因为框和它的文字
 *    必须待在一起。
 *
 * 说明文字并非都该删掉：**确实需要解释的**（目录怎么扫、自动 fetch 的安全
 * 边界）留一个「左说明 / 右控件」的行，其余的靠分组注释和一行短提示就够。
 */

/** 分组标题，右侧拖一条细线到边缘。这是「软件设置页」最好认的一个信号。 */
export function GroupHeading({ children }: { children: ReactNode }) {
  return (
    <h2 className="flex items-center gap-3 text-[13px] font-semibold text-ink">
      <span className="shrink-0">{children}</span>
      <span className="h-px flex-1 bg-line" aria-hidden />
    </h2>
  )
}

/** 一条解释：这个分组整体在做什么。写在标题下方、控件上方。 */
export function GroupNote({ children }: { children: ReactNode }) {
  return (
    <p className="mt-1.5 max-w-prose text-[12.5px] leading-[1.6] text-ink-2">{children}</p>
  )
}

/**
 * 「左说明 / 右控件」的一行。**只给确实需要解释的设置用**——
 * 段落会占两三行高度，用多了整页就散成一堆文字岛。
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
    <div className="grid gap-x-8 gap-y-1.5 border-b border-line-soft py-3.5 last:border-b-0 sm:grid-cols-[minmax(20rem,20rem)_minmax(0,1fr)] sm:items-start">
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
 * 一个**紧凑**的行：标签在左、控件紧跟在右，同一行。
 *
 * 同一行的几个用 `pack` 一起给，它们就并排铺开——这是把「三段互不相干的
 * 文字」变回「一行里的一件事」的关键。提示文字放在下面一行，不占横向空间。
 */
export function FieldRow({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <div className="flex items-start gap-2">
      {/* 4.5rem 装得下四个汉字，又留得出输入框的位置。宽了会把并排的几列
          挤出各自的轨道，控件于是不再对齐（每列宽 208，标签 88 + 输入框 160
          就已经超了）。 */}
      <span className="w-[4.5rem] shrink-0 pt-[7px] text-[12.5px] text-ink-2">{label}</span>
      <div className="min-w-0">
        {children}
        {hint ? <p className="mt-1 text-[11.5px] leading-4 text-ink-3">{hint}</p> : null}
      </div>
    </div>
  )
}

/** 几个 FieldRow 并排。列宽相等，短的那几列不会跟着拉伸。 */
export function FieldPack({ children }: { children: ReactNode }) {
  return <div className="grid gap-x-8 gap-y-3 sm:grid-cols-3">{children}</div>
}

/**
 * 复选框行：**框在标签左边**。
 *
 * 软件里几乎没有「标签在左、框在最右」那种排法——框和它的文字必须待在一起，
 * 否则框到底管的是哪一条文字要靠位置去猜。
 */
export function CheckRow({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string
  hint?: string
  checked: boolean
  disabled?: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2 py-1">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="list-check mt-[3px] shrink-0"
      />
      <span className="min-w-0">
        <span className="text-[13px] text-ink">{label}</span>
        {hint ? <span className="mt-0.5 block text-[12px] text-ink-2">{hint}</span> : null}
      </span>
    </label>
  )
}

/**
 * 分区。`emphasis` 给左侧一道 2px 的强调线，用在**唯一能动你工作区的那一组**上。
 * 这不是装饰：颜色在这里表示「这组设置配错了会动你的文件」，与全应用
 * 「颜色只用来编码事实」那条约定同源。
 */
export function SettingSection({
  title,
  note,
  emphasis,
  children,
}: {
  title: string
  note: string
  emphasis?: boolean
  children: ReactNode
}) {
  return (
    <section className={`mb-9 ${emphasis ? 'border-l-2 border-accent pl-4' : ''}`}>
      <GroupHeading>{title}</GroupHeading>
      <GroupNote>{note}</GroupNote>
      <div className="mt-3">{children}</div>
    </section>
  )
}
