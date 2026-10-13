import { useId, type ButtonHTMLAttributes, type ReactNode } from 'react'

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

/**
 * 按钮。
 *
 * ## 默认 `type="button"`（**不要**改成 HTML 那个默认值）
 *
 * HTML 里 `<button>` 的默认 `type` 是 **`submit`**，而「提交」只在 `<form>` 里才有
 * 意义。这一条踩过一次，症状很刺眼：编辑资料弹窗里那两枚「编辑 / 预览」切换按钮
 * 没有写 `type`，于是点一下**等于提交表单**——校验通过就保存并关闭弹窗，
 * 用户以为自己只是切了个视图 ✗。
 *
 * 所以这里把默认值定成 `type="button"`（真提交的地方自己写 `type="submit"`）：
 * 这个组件有几十个调用点，绝大多数都不在表单里、也不打算提交；靠每个调用点自觉
 * 记得写 `type="button"`，就是让**默认值**替所有人做错事。
 *
 * 代价说清楚：**要原生提交（回车/点击触发 `<form onSubmit`）时必须显式写
 * `type="submit"`**，不再有「什么都不写就是提交」那条路。本仓库目前没有依赖它的
 * 地方——唯一的那个 `<form>`（`ProjectFormDialog`）用 `onSubmit` 接回车、
 * 底部那枚「保存」是 `onClick={submit}`（而且它在表单**外面**的底栏里）。
 */
export function Button({
  variant = 'ghost',
  size = 'md',
  className = '',
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
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
