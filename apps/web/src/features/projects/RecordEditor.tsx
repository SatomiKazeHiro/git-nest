import { useId, useState } from 'react'
import { Eye, Pencil } from 'lucide-react'
import { Textarea } from '@/components/ui'
import { MarkdownBody } from '@/features/readme/MarkdownBody'

type View = 'write' | 'preview'

/**
 * 「记录」的编辑框：**写 / 读同一块地方**。
 *
 * ## 为什么有预览
 *
 * 「记录」存的是 **Markdown 原文**，而详情页那条只读记录（`RecordView`）现在是
 * 按 Markdown 渲染的。写的时候看不见渲染结果，就等于让用户盲写：`**粗体**`
 * 到底会不会变粗、`- ` 到底会不会变列表，只有保存、关掉弹窗、翻到详情页才知道。
 * 预览把这件事挪到**当下**：一边写一边看，与详情页那一侧共用 `MarkdownBody`
 * （同一个渲染器、同一套 URL 白名单，见那边的注释）。
 *
 * ## 为什么是「一个带边框的块」，不是「顶上一排按钮 + 底下一个框」
 *
 * 第一版做成了「两枚各自带框的按钮 + 下面一个 textarea」，用户的原话是
 * 「东一块、西一块，看不出是一个组件」。所以现在是**一个框**：
 *
 * ```
 * ┌────────────────────────────────┐
 * │ [ 编辑 │ 预览 ]                │  ← 顶栏，与内容同框
 * ├────────────────────────────────┤  ← 一条 border-line-soft 的浅色分隔线
 * │  textarea（编辑态）/ 预览       │
 * └────────────────────────────────┘
 * ```
 *
 * **两段是连起来的一段**：紧挨、中间没有缝、共用外框、只有外侧两个角是圆的（3px）。
 * 两段各自带一圈边框就是「两枚按钮」那种观感的来源，所以那圈边框在这里不存在——
 * 内部只用一条浅色线把两段分开。
 *
 * 顶栏高度与仓库其它控件同档（`h-7`，与按钮、单行输入框一致），而且**两种视图下
 * 都是这一档**：切来切去时下面那块不会跟着跳。
 *
 * ## 选中态取自仓库已有的语汇
 *
 * 亮着的那一段是 `bg-accent-wash text-accent-ink`——与过滤面板那排可点项
 * （`FilterPanel` 的 `Item`）的选中态**同一档**：浅蓝底 + 深蓝字。没有自创颜色，
 * 也没有另造一套「分段控件专用」的视觉。
 *
 * ## textarea 的画法：**切走不是卸载**
 *
 * 切到预览时 textarea 只是 `hidden`，**没有从 DOM 里拿掉**。理由是那个坑很明显：
 * 卸载再挂回来，光标位置、选区、以及滚动位置全丢；用户切过去看一眼再切回来，
 * 就得重新找刚才写到哪儿。`hidden` 的元素不参与渲染与焦点，而它的值、选区、
 * 滚动位置都还在。
 *
 * ## 存下去的仍然是**原文**
 *
 * 预览是**只读的一层显示**，它不改变 `value` 这一个字：提交给接口的永远是 textarea
 * 里那串 Markdown 原文，不是渲染出来的 HTML。所以切换视图不会影响保存的结果，
 * 也不会悄悄「规范化」用户写的东西。
 *
 * ## 语义：两枚 toggle 按钮，**没有**升级成 radiogroup
 *
 * `role="group"` + 每枚 `aria-pressed`（分段只是**外观**）。不改成
 * `role="radiogroup"` / `radio` 的理由：那套语义说的是「从一组里选一个**值**」，
 * 而这里两枚各自是一个独立的状态指示（与过滤面板那排、以及 `IconPicker` 里的项
 * 同一套）；`aria-pressed` 已经足够让读屏说出「编辑：已按下 / 预览：未按下」。
 * 升级要连带实现 roving tabindex 与方向键，那是**行为**变更，不是这次要做的版式。
 */
export function RecordEditor({
  id,
  value,
  onChange,
}: {
  /** `Field` 生成的 id：要给到 **textarea**，label 才真的关联到输入框 */
  id: string
  value: string
  onChange: (v: string) => void
}) {
  const [view, setView] = useState<View>('write')
  const previewId = useId()

  /*
    两段共用的外观：紧挨、没有自己的边框、只有最外那两侧是圆的
    （左段左上/左下、右段右上/右下），拼起来才与这一整块的 3px 半径对得上。
  */
  const segment = 'flex items-center gap-1 px-2.5 text-[12.5px]'
  const segmentState = (on: boolean) =>
    on ? 'bg-accent-wash text-accent-ink' : 'text-ink-3 hover:bg-sunken hover:text-ink'

  return (
    <div className="flex flex-col rounded-[3px] border border-line bg-panel">
      {/*
        `type="button"` 是有意的：这两枚只切换视图，不提交。它们住在 `<form>` 里，
        而 HTML 里 `<button>` 的默认 `type` 就是 `submit`——漏写的话点一下会提交整个
        表单、弹窗直接关掉（用户实测到的那次就是这个）。`components/ui.tsx` 的
        `Button` 现在默认也是 `type="button"`，这里是**第二道**。

        不用 `ui.tsx` 的 `Button`：那枚自带边框与圆角，两枚并排就是「两枚按钮」的
        观感（这次要改掉的东西）。分段控件的段是**没有自己边框**的。
      */}
      <div
        role="group"
        aria-label="记录视图"
        className="flex h-7 shrink-0 items-stretch border-b border-line-soft"
      >
        <button
          type="button"
          aria-pressed={view === 'write'}
          onClick={() => setView('write')}
          className={`cursor-pointer rounded-tl-[3px] ${segment} ${segmentState(view === 'write')}`}
        >
          <Pencil size={13} aria-hidden />
          编辑
        </button>
        {/* 两段之间那条浅色线：`self-stretch` 让它跟顶栏一样高 */}
        <span aria-hidden className="w-px self-stretch bg-line-soft" />
        <button
          type="button"
          aria-pressed={view === 'preview'}
          /* 预览面板要能被读屏与键盘找到，所以给它一个 id 让按钮指过去 */
          aria-controls={previewId}
          onClick={() => setView('preview')}
          className={`cursor-pointer rounded-tr-[3px] ${segment} ${segmentState(view === 'preview')}`}
        >
          <Eye size={13} aria-hidden />
          预览
        </button>
      </div>

      {/*
        内容区。这里的东西**不再是独立控件**：textarea 自己那份边框与圆角去掉，
        它现在只是这块里的一层内容——两个框套在一起正是「两块东西」的来源。
        高度定死（`h-44`，与原来 `rows={8}` 差不多的观感）而不是让它自己长：
        切到预览时下面不该跳，长记录在框里滚，弹窗本身的高度也就稳住了。
      */}
      <div className="h-44 min-h-0">
        <Textarea
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          hidden={view !== 'write'}
          className="!h-full !rounded-none !border-0 focus:!border-0"
        />

        {view === 'preview' ? (
          <div id={previewId} className="h-full overflow-auto px-2.5 py-2">
            {value.trim() === '' ? (
              /* 空记录预览成一块空白会像「坏了」：说清是没有内容，而不是没渲染出来 */
              <p className="text-[12.5px] text-ink-3">还没有内容。切回「编辑」写一段。</p>
            ) : (
              <MarkdownBody>{value}</MarkdownBody>
            )}
          </div>
        ) : null}
      </div>
    </div>
  )
}
