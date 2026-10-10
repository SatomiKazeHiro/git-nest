import { useEffect, useId, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react'

type Variant = 'primary' | 'ghost' | 'danger'
/**
 * 按钮尺寸只有两档。
 *
 * 桌面软件里的控件高度是**有分级的**：一屏里全是大按钮会让人不知道哪个才是
 * 主动作。曾经这一栏只有一个尺寸，于是「重读本地状态」这种维护性动作跟旁边
 * 的「编辑资料」「联网检查更新」一样高、一样重——它被挤在卡片头上时尤其刺眼，
 * 视觉重量和它的分量完全不配。
 *
 * - `md`（默认，28px）：工具条、弹窗底部、抬头这一层的主要动作
 * - `sm`（24px）：卡片头、表格行内这类**塞在别的东西里面**的次要动作
 *
 * 拿不准时用 `md`。`sm` 是例外，不是常态。
 */
type Size = 'sm' | 'md'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
}

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-accent text-white border border-accent hover:bg-accent-hover hover:border-accent-hover disabled:bg-line disabled:border-line disabled:text-ink-3',
  ghost:
    'bg-panel text-ink-2 border border-line hover:border-ink-3 hover:text-ink disabled:text-ink-3 disabled:hover:border-line',
  danger: 'bg-panel text-signal-bad border border-line hover:border-signal-bad',
}

const SIZES: Record<Size, string> = {
  sm: 'h-6 gap-1 px-2 text-[12px]',
  md: 'h-7 gap-1.5 px-3 text-[13px]',
}

export function Button({ variant = 'ghost', size = 'md', className = '', ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      className={`inline-flex cursor-pointer items-center rounded-[3px] font-medium transition-colors disabled:cursor-not-allowed ${SIZES[size]} ${VARIANTS[variant]} ${className}`}
    />
  )
}

interface FieldProps {
  label: string
  /** 提示文字。允许传节点——有的提示本身带标记（比如分类那行列出了一组对照）。 */
  hint?: ReactNode
  error?: string
  children: (id: string) => ReactNode
}

export function Field({ label, hint, error, children }: FieldProps) {
  // useId 而不是 `useRef(Math.random())`：后者每次渲染都要算一个随机串再丢掉，
  // 而且「这一轮的 id」和「上一轮的 id」不是同一个值——label 的 htmlFor 只是在
  // 同一个组件实例里恰好对上了。useId 在挂载期间稳定，正是这里要的语义。
  const id = useId()
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-[12px] font-medium text-ink-2">
        {label}
      </label>
      {children(id)}
      {error ? (
        <p className="text-[12px] text-signal-bad">{error}</p>
      ) : hint ? (
        <p className="text-[12px] text-ink-3">{hint}</p>
      ) : null}
    </div>
  )
}

/*
  高度**不放进共享类**：单行输入框与按钮同为 28px（`h-7`），在工具条里
  才能对齐；而多行文本框必须跟着内容长，写死高度会把它压成一行。
  28px 是桌面软件的常规控件高度——原来 13px 字 + py-1.5 算出来是 33.5px，
  那个数是字号的副产物，不是谁定下来的规格。
*/
const inputClass =
  'w-full rounded-[3px] border border-line bg-panel px-2.5 py-1.5 font-mono text-[13px] text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none'

type InputProps = React.InputHTMLAttributes<HTMLInputElement> & {
  // React 19 里 ref 是普通 prop，直接透传即可（不用 forwardRef）
  ref?: React.Ref<HTMLInputElement>
}

export function Input(props: InputProps) {
  const { className = '', ...rest } = props
  return <input {...rest} className={`${inputClass} h-7 ${className}`} />
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const { className = '', ...rest } = props
  return <textarea {...rest} className={`${inputClass} resize-y leading-6 ${className}`} />
}

export function Dialog({
  title,
  description,
  actions,
  size = 'default',
  onClose,
  children,
}: {
  title: string
  description?: string
  /** 头部右侧、关闭按钮之前的动作（比如「重新检查」）。 */
  actions?: ReactNode
  /** `wide` 给需要横向空间的报告类内容（如更新报告）；表单用默认宽度。 */
  size?: 'default' | 'wide'
  onClose: () => void
  children: ReactNode
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  /*
    **Escape 与初始焦点不能挂在 `onClose` 上。**
    调用方全传内联箭头（`onClose={() => {...}}`），引用每次渲染都变；
    而更新面板每来一个 SSE 事件就重渲染一次 —— effect 跟着重跑，
    每跑一次就把焦点抢回面板里第一个可聚焦元素。用户正在勾选复选框，
    焦点一直被打断，键盘操作（空格勾选）直接失灵。
    所以：Escape 用 ref 读最新的 onClose；焦点只在挂载时给一次。
  */
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    panelRef.current?.querySelector<HTMLElement>('input, textarea, button')?.focus()
  }, [])

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/25 p-6 pt-[8vh]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      {/*
        内容区自己滚（`min-h-0 flex-1 overflow-y-auto`），标题、头部动作与关闭按钮
        留在原地。原来是整个遮罩层滚——长表单滚下去之后标题和关闭按钮都不见了。
      */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`flex max-h-[85vh] w-full flex-col rounded-[4px] border border-line bg-panel shadow-[0_8px_32px_rgba(19,24,29,0.14)] ${
          size === 'wide' ? 'max-w-3xl' : 'max-w-lg'
        }`}
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-line-soft px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
            {description ? <p className="mt-0.5 text-[12px] text-ink-3">{description}</p> : null}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {actions}
            <button
              onClick={onClose}
              aria-label="关闭"
              className="-mr-1 rounded-[3px] px-1.5 py-0.5 font-mono text-[15px] leading-6 text-ink-3 hover:bg-accent-wash hover:text-ink"
            >
              ×
            </button>
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  )
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string
  body: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-start gap-2 border border-dashed border-line px-5 py-10">
      <p className="text-[14px] font-semibold text-ink">{title}</p>
      <p className="max-w-prose text-[13px] text-ink-2">{body}</p>
      {action}
    </div>
  )
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <p role="alert" className="border-l-2 border-signal-bad bg-panel px-3 py-2 text-[13px] text-signal-bad">
      {message}
    </p>
  )
}

/**
 * 小标签：**标签 + 值** 的一对元信息。
 *
 * 以前这类信息（「本地状态 · 刚刚读取」「远程上次检查 · 从没查过」）是用
 * `标签 · 值` 拼出来的散装文本，和页面里其它行内点缀（`已选 3`、`已在清单 · tools`）
 * 混在一起，看着没有统一格式；而且值缺失时那个 `·` 会孤零零挂在中间。
 *
 * 用标签组件之后：值缺失就换成一枚安静的「占位」样式（extra 的虚线变体），
 * 不再靠分隔符撑句子；同一处的多个标签视觉权重一致。
 */
export function Meta({
  label,
  value,
  title,
  placeholder = false,
}: {
  label: string
  value: string
  /** 悬停说明，解释这个值的来源/新鲜度 */
  title?: string
  /** 值其实是「还没有/没查过」这类缺省状态：弱化显示 */
  placeholder?: boolean
}) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1.5 rounded-[3px] border px-1.5 py-0.5 ${
        placeholder ? 'border-dashed border-line' : 'border-line-soft bg-panel'
      }`}
    >
      <span className="text-[11px] text-ink-3">{label}</span>
      <span className={`font-mono text-[11.5px] ${placeholder ? 'text-ink-3' : 'text-ink-2'}`}>
        {value}
      </span>
    </span>
  )
}
