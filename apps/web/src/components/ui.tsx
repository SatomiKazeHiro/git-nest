import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react'

type Variant = 'primary' | 'ghost' | 'danger'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
}

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-accent text-white border border-accent hover:bg-accent-hover hover:border-accent-hover disabled:bg-line disabled:border-line disabled:text-ink-3',
  ghost:
    'bg-panel text-ink-2 border border-line hover:border-ink-3 hover:text-ink disabled:text-ink-3 disabled:hover:border-line',
  danger: 'bg-panel text-signal-bad border border-line hover:border-signal-bad',
}

export function Button({ variant = 'ghost', className = '', ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      className={`inline-flex items-center gap-1.5 rounded-[3px] px-3 py-1.5 text-[13px] font-medium transition-colors disabled:cursor-not-allowed ${VARIANTS[variant]} ${className}`}
    />
  )
}

interface FieldProps {
  label: string
  hint?: string
  error?: string
  children: (id: string) => ReactNode
}

export function Field({ label, hint, error, children }: FieldProps) {
  const id = useRef(`f${Math.random().toString(36).slice(2, 9)}`).current
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

const inputClass =
  'w-full rounded-[3px] border border-line bg-panel px-2.5 py-1.5 font-mono text-[13px] text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none'

type InputProps = React.InputHTMLAttributes<HTMLInputElement> & {
  // React 19 里 ref 是普通 prop，直接透传即可（不用 forwardRef）
  ref?: React.Ref<HTMLInputElement>
}

export function Input(props: InputProps) {
  const { className = '', ...rest } = props
  return <input {...rest} className={`${inputClass} ${className}`} />
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const { className = '', ...rest } = props
  return <textarea {...rest} className={`${inputClass} resize-y leading-6 ${className}`} />
}

export function Dialog({
  title,
  description,
  onClose,
  children,
}: {
  title: string
  description?: string
  onClose: () => void
  children: ReactNode
}) {
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    panelRef.current?.querySelector<HTMLElement>('input, textarea, button')?.focus()
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/25 p-6 pt-[8vh]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-lg rounded-[4px] border border-line bg-panel shadow-[0_8px_32px_rgba(19,24,29,0.14)]"
      >
        <header className="flex items-start justify-between gap-4 border-b border-line-soft px-5 py-4">
          <div>
            <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
            {description ? <p className="mt-0.5 text-[12px] text-ink-3">{description}</p> : null}
          </div>
          <button
            onClick={onClose}
            aria-label="关闭"
            className="-mr-1 rounded-[3px] px-1.5 py-0.5 font-mono text-[15px] leading-6 text-ink-3 hover:bg-accent-wash hover:text-ink"
          >
            ×
          </button>
        </header>
        <div className="px-5 py-4">{children}</div>
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
