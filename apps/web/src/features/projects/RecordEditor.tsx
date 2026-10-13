import { useId, useState } from 'react'
import { Eye, Pencil } from 'lucide-react'
import { Button, Textarea } from '@/components/ui'
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
 * ## textarea 的画法：**切走不是卸载**
 *
 * 切到预览时 textarea 只是 `hidden`，**没有从 DOM 里拿掉**。理由是那个坑很明显：
 * 卸载再挂回来，光标位置、选区、以及`rows` 之外的滚动位置全丢；用户切过去看一眼
 * 再切回来，就得重新找刚才写到哪儿。`hidden` 的元素不参与渲染与焦点，
 * 而它的值、选区、滚动位置都还在。
 *
 * ## 存下去的仍然是**原文**
 *
 * 预览是**只读的一层显示**，它不改变 `value` 这一个字：提交给接口的永远是 textarea
 * 里那串 Markdown 原文，不是渲染出来的 HTML。所以切换视图不会影响保存的结果，
 * 也不会悄悄「规范化」用户写的东西。
 *
 * ## 预览跟着输入实时走
 *
 * `value` 是受控的，每次 `onChange` 都会重渲染，预览读的就是同一个 `value`——
 * 不存在「失焦后才更新」那种滞后。Markdown 解析在本地、没有异步，所以也不需要对
 * 输入做防抖（记录是几十行文本的量级，解析一帧都用不满）。
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

  return (
    <div className="flex flex-col gap-1.5">
      {/*
        切换用**仓库既有的控件语汇**：`Button` 的次要档（和「取消」同一档），
        选中那枚用 `aria-pressed` 表示——与过滤面板里那排可点的项同一套语义
        （不用 radio：这里两枚按钮就是「当前是哪一档」，不是一组要提交的值）。

        **`type="button"` 写在这里是有意的**：这两枚只切换视图，不提交。它们住在
        `<form>` 里，而 HTML 里 `<button>` 的默认 `type` 就是 `submit`——漏写的话
        点一下会提交整个表单、弹窗直接关掉（用户实测到的那次就是这个）。
        `components/ui.tsx` 的 `Button` 现在默认也是 `type="button"`，这里是**第二道**：
        默认值哪天被改回去，这一处仍然是对的。
      */}
      <div role="group" aria-label="记录视图" className="flex justify-end gap-1">
        <Button
          type="button"
          size="sm"
          aria-pressed={view === 'write'}
          onClick={() => setView('write')}
          className={view === 'write' ? 'border-accent text-accent' : undefined}
        >
          <Pencil size={13} aria-hidden />
          编辑
        </Button>
        <Button
          type="button"
          size="sm"
          aria-pressed={view === 'preview'}
          /* 预览面板要能被读屏与键盘找到，所以给它一个 id 让按钮指过去 */
          aria-controls={previewId}
          onClick={() => setView('preview')}
          className={view === 'preview' ? 'border-accent text-accent' : undefined}
        >
          <Eye size={13} aria-hidden />
          预览
        </Button>
      </div>

      {/*
        **留在 DOM 里、只是藏起来**（见文件头）。`hidden` 也顺手把焦点与读屏拿掉，
        所以切到预览之后 Tab 不会停在看不见的输入框上。
      */}
      <Textarea
        id={id}
        rows={8}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        hidden={view !== 'write'}
      />

      {view === 'preview' ? (
        <div id={previewId}>
          {value.trim() === '' ? (
            /* 空记录预览成一块空白会像「坏了」：说清是没有内容，而不是没渲染出来 */
            <p className="text-[12.5px] text-ink-3">还没有内容。切回「编辑」写一段。</p>
          ) : (
            <MarkdownBody className="rounded-[3px] border border-line px-2.5 py-2">
              {value}
            </MarkdownBody>
          )}
        </div>
      ) : null}
    </div>
  )
}
