import { useEffect, useRef, type ReactNode } from 'react'

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
      {/*
        卡片里的分隔线由「行是不是最后一个」决定，而这个判断只能由**卡片**做。
        所以卡片下面必须直接是行：中间不许再包 `<section>`——
        `:last-child` 判的是 DOM 父节点，包一层之后每个小组自己都以为自己是最后，
        组与组之间就会少一条线（这个坑踩过）。

        需要锚点的行（比如 `id="scan"` 那种深链目标）把 id 挂在行自己身上，
        不要为了挂 id 再包一层元素。
      */}
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
  id,
  name,
  desc,
  note,
  children,
}: {
  /** 深链锚点。挂在行自己身上，别为此再包一层元素。 */
  id?: string
  name: string
  desc?: string
  /** 范围之类的补充说明，显示成描述后面的浅灰括号 */
  note?: string
  children: ReactNode
}) {
  const zoneRef = useRef<HTMLDivElement>(null)
  const warned = useRef<number | null>(null)

  /*
    开发期护栏：控件装不下右侧那块区域时**喊出来**。

    卡片有 `overflow-hidden`，所以超宽的控件不会溢出到外面——它会被**裁掉**。
    症状是「扫描按钮莫名其妙缺了一块」，没有任何报错，是最难查的一类坏法。
    这里量一下控件实际需要多宽，超了就 console.warn。

    只在 dev 跑：生产环境为一个排版问题付出一次 `getBoundingClientRect` 不值。
    报错量记在 ref 里，同一个宽度不重复喊——否则每次重渲染都刷一遍。
  */
  useEffect(() => {
    if (!import.meta.env.DEV) return
    const zone = zoneRef.current
    if (!zone) return
    const need = Array.from(zone.children).reduce(
      (sum, el) => sum + (el as HTMLElement).getBoundingClientRect().width,
      0,
    )
    const over = Math.ceil(need - zone.clientWidth)
    if (over <= 1) {
      warned.current = null
      return
    }
    if (warned.current === over) return
    warned.current = over
    console.warn(
      `设置项「${name}」的控件需要 ${Math.ceil(need)}px，右侧区域只有 ${zone.clientWidth}px。` +
        `卡片有 overflow-hidden，多出来的 ${over}px 会被裁掉——按钮缺一块是最不容易发现的一种坏法。` +
        `要么把控件改窄，要么把 SettingRow 里那块区域调宽。`,
      zone,
    )
  }, [name, children])

  return (
    <div
      id={id}
      className="flex items-center gap-6 border-b border-line-soft px-4 py-2.5 last:border-b-0"
    >
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
        右侧是一块**固定宽度**的区域（18rem = 288px），控件在它里面居中。
        宽度写死是这一条能成立的前提：区域随内容伸缩的话，「居中」就变成了
        「每行各自贴着自己的控件」，等于没有对齐。

        18rem 是按**实测**定的：目前最宽的是「目录」那一行（路径框 11rem +
        间隙 + 「扫描」按钮 = 256px），余量 32px。超出的部分会被卡片裁掉
        （`overflow-hidden`），所以上面那个开发期护栏盯着这里——将来哪一行
        的控件变宽了，它会在控制台喊出来，而不是让人对着「缺了一块」的按钮
        查半天。
      */}
      <div ref={zoneRef} className="flex w-72 shrink-0 items-center justify-center gap-2">
        {children}
      </div>
    </div>
  )
}