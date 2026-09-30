import { useState } from 'react'
import { groupBy } from 'es-toolkit'

interface Props {
  tags: { name: string; color: string | null }[]
  value: string[]
  onChange: (next: string[]) => void
}

/** 标签是自由字符串：已有标签点一下就加，也可以直接输入新名字。 */
export function TagPicker({ tags, value, onChange }: Props) {
  const [draft, setDraft] = useState('')
  const unused = groupBy(
    tags.filter((t) => !value.includes(t.name)),
    (t) => (t.color ? 'colored' : 'plain'),
  )

  const toggle = (name: string) =>
    onChange(value.includes(name) ? value.filter((n) => n !== name) : [...value, name])

  const commitDraft = () => {
    const name = draft.trim()
    if (name && !value.includes(name)) onChange([...value, name])
    setDraft('')
  }

  return (
    <div className="flex flex-col gap-2">
      {value.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {value.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => toggle(name)}
              className="rounded-[3px] border border-accent bg-accent-wash px-1.5 py-0.5 font-mono text-[12px] text-accent"
              title="点击移除"
            >
              {name} ×
            </button>
          ))}
        </div>
      ) : null}

      <div className="flex gap-1.5">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault()
              commitDraft()
            }
          }}
          onBlur={commitDraft}
          placeholder="新标签，回车确认"
          className="min-w-0 flex-1 rounded-[3px] border border-line bg-panel px-2 py-1 font-mono text-[12px] focus:border-accent focus:outline-none"
        />
      </div>

      {tags.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {[...(unused['colored'] ?? []), ...(unused['plain'] ?? [])].map((t) => (
            <button
              key={t.name}
              type="button"
              onClick={() => onChange([...value, t.name])}
              className="rounded-[3px] border border-line bg-panel px-1.5 py-0.5 font-mono text-[12px] text-ink-2 hover:border-ink-3 hover:text-ink"
            >
              + {t.name}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
