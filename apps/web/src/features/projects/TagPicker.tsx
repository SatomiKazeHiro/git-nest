import { useState } from 'react'
import { groupBy } from 'es-toolkit'
import { tagNameSchema } from '@git-nest/core'

interface Props {
  tags: { name: string; color: string | null }[]
  value: string[]
  onChange: (next: string[]) => void
  /** Field 生成的 id：让「标签」那个 label 真的关联到这个输入框 */
  id?: string
}

/**
 * 标签是自由字符串：已有标签点一下就加，也可以直接输入新名字。
 *
 * 名字的规则（非空、最长 40 字）**和另外两个写入口共用 core 的 `tagNameSchema`**：
 * 服务端当然还得自己校验（前端只是建议），但在这里就说清楚，用户才不会敲完一段、
 * 保存时才吃一个 422「提交的内容有误」。校验不过时**保留草稿**并把原因显示出来
 * ——清掉草稿等于让他重新打一遍，而且他会以为「加上了」。
 */
export function TagPicker({ tags, value, onChange, id }: Props) {
  const [draft, setDraft] = useState('')
  const [draftError, setDraftError] = useState<string | null>(null)
  const unused = groupBy(
    tags.filter((t) => !value.includes(t.name)),
    (t) => (t.color ? 'colored' : 'plain'),
  )

  const toggle = (name: string) =>
    onChange(value.includes(name) ? value.filter((n) => n !== name) : [...value, name])

  const commitDraft = () => {
    const name = draft.trim()
    if (!name) {
      setDraft('')
      setDraftError(null)
      return
    }
    const parsed = tagNameSchema.safeParse(name)
    if (!parsed.success) {
      setDraftError(parsed.error.issues[0]?.message ?? '这个名字不能用')
      return
    }
    if (value.includes(name)) {
      setDraftError('这个标签已经加上了')
      return
    }
    onChange([...value, name])
    setDraft('')
    setDraftError(null)
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
          id={id}
          aria-label="新标签"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value)
            if (draftError) setDraftError(null)
          }}
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
      {draftError ? <p className="text-[12px] text-signal-bad">{draftError}</p> : null}

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
