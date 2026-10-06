import type { ReactNode } from 'react'

/**
 * 设置页的排版模型：**左边说这是什么，右边居中放操作**。
 *
 * 三个决定，都是从成熟软件的设置页上比出来的：
 *
 * 1. **控件在右侧的固定区域里居中**，不是一律靠左。控件本身宽窄不一
 *    （开关 40px、输入框 120px、按钮组 240px），靠左对齐会让它们的左边缘
 *    参差成一条锯齿；居中之后右半边被读成一个「动作区」，宽窄差异就消失了。
 * 2. **一组设置装进一只带圆角的卡片**，行与行之间用卡内分隔线。行与行之间
 *    用通栏分隔线的话，读起来是「一份有横线的文档」；装进卡片才是「一组设置」。
 * 3. **描述一行，补充信息用浅灰括号接在后面**。整段两三行的说明会把页面
 *    撑成散文；承重的那半句在前面，范围、快捷键这类补充挂在后面。
 */

/** 一组设置：光秃秃的粗体标题 + 一只装着各行的卡片。 */
export function SettingGroup({
  title,
  note,
  children,
}: {
  title: string
  /** 一句话说明这一组整体在做什么。跨所有行的那条事实放这里。 */
  note?: string
  children: ReactNode
}) {
  return (
    <section className="mb-9">
      <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
      {note ? <p className="mt-1 max-w-prose text-[12.5px] leading-[1.6] text-ink-2">{note}</p> : null}
      <div className="mt-2.5 overflow-hidden rounded-[4px] border border-line">{children}</div>
    </section>
  )
}

/**
 * 一个设置项。
 *
 * `note` 是接在描述后面的**浅灰括号**——范围、快捷键这类补充放这里，
 * 不必为它们单开一行。
 */
export function SettingRow({
  name,
  desc,
  note,
  children,
}: {
  name: string
  desc?: string
  /** 范围之类的补充说明，显示成描述后面的浅灰括号 */
  note?: string
  children: ReactNode
}) {
  return (
    <div className="flex items-center gap-6 border-b border-line-soft px-4 py-2.5 last:border-b-0">
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] font-medium text-ink">{name}</p>
        {desc || note ? (
          <p className="mt-0.5 text-[12.5px] leading-[1.55] text-ink-2">
            {desc}
            {note ? <span className="text-ink-3">{desc ? ' ' : ''}（{note}）</span> : null}
          </p>
        ) : null}
      </div>
      {/*
        右侧是一块**固定宽度**的区域（15rem），控件在它里面居中。
        宽度写死是这一条能成立的前提：区域随内容伸缩的话，「居中」就变成了
        「每行各自贴着自己的控件」，等于没有对齐。

        15rem 是从最宽的一行量出来的：路径输入框 11rem + 间隙 + 「扫描」按钮
        ≈ 17.5rem，再宽它就装不下了——而装不下时溢出的是**按钮**，它会被卡片
        的圆角裁掉，那是最难看的一种坏法。
      */}
      <div className="flex w-72 shrink-0 items-center justify-center gap-2">{children}</div>
    </div>
  )
}