import { useMemo, type ReactNode } from 'react'
import { orderBy } from 'es-toolkit'
import { UNCATEGORIZED, useUiStore } from '@/store/ui'
import { useProjects } from '@/features/projects/queries'

/** 左栏：分类与标签的索引，每项后面是该组的项目数（按完整清单统计，不受搜索影响）。 */
export function Sidebar() {
  const { data: projects } = useProjects({ category: null, tag: null, q: '' })
  const category = useUiStore((s) => s.filters.category)
  const tag = useUiStore((s) => s.filters.tag)
  const setCategory = useUiStore((s) => s.setCategory)
  const setTag = useUiStore((s) => s.setTag)

  const { categories, tags } = useMemo(() => {
    const cats = new Map<string, number>()
    const tagCounts = new Map<string, number>()
    for (const p of projects ?? []) {
      const c = p.category || UNCATEGORIZED
      cats.set(c, (cats.get(c) ?? 0) + 1)
      for (const t of p.tags) tagCounts.set(t.name, (tagCounts.get(t.name) ?? 0) + 1)
    }
    return {
      categories: orderBy(
        [...cats.entries()],
        [([name]) => (name === UNCATEGORIZED ? 1 : 0), ([name]) => name.toLowerCase()],
        ['asc', 'asc'],
      ),
      tags: orderBy([...tagCounts.entries()], [([name]) => name.toLowerCase()], ['asc']),
    }
  }, [projects])

  if (projects === undefined) {
    return <p className="pl-2 font-mono text-[12px] text-ink-3">…</p>
  }

  return (
    <nav className="flex flex-col gap-6">
      <Section title="分类">
        {categories.length === 0 ? <Hint>还没有项目</Hint> : null}
        {categories.map(([name, n]) => (
          <Item
            key={name}
            label={name}
            count={n}
            active={name !== UNCATEGORIZED && category === name}
            onClick={name === UNCATEGORIZED ? undefined : () => setCategory(name)}
          />
        ))}
      </Section>

      <Section title="标签">
        {tags.length === 0 ? <Hint>还没有标签</Hint> : null}
        {tags.map(([name, n]) => (
          <Item
            key={name}
            label={name}
            count={n}
            active={tag === name}
            onClick={() => setTag(name)}
          />
        ))}
      </Section>
    </nav>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h2 className="mb-2 pl-2 text-[12px] font-medium text-ink-3">{title}</h2>
      <div className="flex flex-col">{children}</div>
    </div>
  )
}

function Item({
  label,
  count,
  active,
  onClick,
}: {
  label: string
  count: number
  active: boolean
  onClick?: () => void
}) {
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      className={`flex items-baseline gap-2 rounded-[3px] px-2 py-1 text-left text-[13px] ${
        active ? 'bg-accent-wash text-accent' : 'text-ink-2 hover:bg-paper hover:text-ink'
      } disabled:cursor-default disabled:text-ink-3 disabled:hover:bg-transparent`}
    >
      <span className="min-w-0 flex-1 truncate font-mono">{label}</span>
      <span className="font-mono text-[11px] text-ink-3">{count}</span>
    </button>
  )
}

function Hint({ children }: { children: ReactNode }) {
  return <p className="px-2 py-1 text-[12px] text-ink-3">{children}</p>
}
