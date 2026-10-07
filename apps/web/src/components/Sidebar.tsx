import { useMemo, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router'
import { FolderGit2, List, Settings } from 'lucide-react'
import { orderBy } from 'es-toolkit'
import { categoryLabel } from '@git-nest/core'
import { UNCATEGORIZED, useUiStore } from '@/store/ui'
import { useProjects } from '@/features/projects/queries'

/**
 * 左栏：导航。
 *
 * 三段（结构写在 `index.css` 的 `.nav`）：**清单入口** / 可滚的分类与标签 /
 * 底部的设置。分类与标签后面跟的是该组的项目数，按完整清单统计，不受搜索影响。
 *
 * 导航从顶栏搬到了这里。顶栏那条「清单 / 设置」是网页的做法——网页只有一条顶栏，
 * 而桌面软件左边本来就有导航，再在标题栏重复一份就是同一个目的地两个入口。
 *
 * 选中态自己算，没用 `NavLink` 的 `end`：`/` 想在 `/projects/5` 时**也**算选中
 * （那是同一个视图——清单加右边的详情栏），而 `NavLink to="/"` 不带 `end` 会把
 * `/settings` 也算进去。两条规则正好相反，`end` 表达不了，只能自己判。
 */
export function Sidebar() {
  const { data: projects } = useProjects({ category: null, tag: null, q: '' })
  const { pathname } = useLocation()
  const category = useUiStore((s) => s.filters.category)
  const tag = useUiStore((s) => s.filters.tag)
  const own = useUiStore((s) => s.filters.own)
  const setCategory = useUiStore((s) => s.setCategory)
  const setTag = useUiStore((s) => s.setTag)
  const setOwnOnly = useUiStore((s) => s.setOwnOnly)

  const inList = pathname === '/' || pathname.startsWith('/projects/')
  const inSettings = pathname.startsWith('/settings')

  const { categories, tags, ownCount } = useMemo(() => {
    const cats = new Map<string, number>()
    const tagCounts = new Map<string, number>()
    let ownN = 0
    for (const p of projects ?? []) {
      const c = p.category || UNCATEGORIZED
      cats.set(c, (cats.get(c) ?? 0) + 1)
      for (const t of p.tags) tagCounts.set(t.name, (tagCounts.get(t.name) ?? 0) + 1)
      if (p.isOwn) ownN += 1
    }
    return {
      // 排序按**显示名**而不是存进库的英文：既然界面上给的是中文，按英文排
      // 出来的顺序对读者就毫无道理（会看到 备份 / 试验 / 知识库 这种交错）。
      // 用户自己填的分类没登记过，categoryLabel 原样返回，按它排也一样有道理。
      categories: orderBy(
        [...cats.entries()],
        [([name]) => (name === UNCATEGORIZED ? 1 : 0), ([name]) => categoryLabel(name)],
        ['asc', 'asc'],
      ),
      tags: orderBy([...tagCounts.entries()], [([name]) => name.toLowerCase()], ['asc']),
      ownCount: ownN,
    }
  }, [projects])

  // 目的地与分组**不等数据**：清单还没读回来的时候，「设置」照样点得进去。
  // 早先这里是「projects 为 undefined 就整块返回占位符」，于是加载那一秒
  // 整个左栏是空的——用户想去看设置得先等列表。
  const loading = projects === undefined

  return (
    <nav className="flex min-h-0 flex-col">
      <div className="p-2">
        <Dest to="/" active={inList} Icon={List} label="清单" />
      </div>

      {/*
        「我自己的」独立成一项，与分类/标签**分开一行分隔**。

        它和那两组不是一层的东西：分类与标签是「按名字分组」，这一项是
        「一个真布尔」。放进任何一个分组里都会显得像多了一个分类。
        计数跟分类/标签同一个口径——按完整清单统计，不受搜索影响。
      */}
      {ownCount > 0 ? (
        <div className="border-t border-line px-2 pb-2">
          <Item
            label="我自己的"
            count={ownCount}
            active={own === '1'}
            onClick={() => setOwnOnly(own !== '1')}
          />
        </div>
      ) : null}

      <div className="nav-scroll flex flex-col gap-5 px-2 pb-4">
        {loading ? (
          <p className="px-2 py-1 font-mono text-[12px] text-ink-3">…</p>
        ) : (
          <>
            <Section title="分类">
              {categories.length === 0 ? <Hint>还没有项目</Hint> : null}
              {categories.map(([name, n]) => (
                <Item
                  key={name}
                  label={categoryLabel(name)}
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
          </>
        )}
      </div>

      {/* 设置沉底：它是「离开当前这份清单」的动作，不该和筛选条件挤在一列里 */}
      <div className="border-t border-line p-2">
        <Dest to="/settings" active={inSettings} Icon={Settings} label="设置" />
      </div>
    </nav>
  )
}

/** 左栏顶部的目的地。图标 + 文字都有——只有图标的导航项认不出来。 */
function Dest({
  to,
  active,
  Icon,
  label,
}: {
  to: string
  active: boolean
  Icon: typeof FolderGit2
  label: string
}) {
  return (
    <Link
      to={to}
      aria-current={active ? 'page' : undefined}
      className={`flex cursor-pointer items-center gap-2 rounded-[3px] px-2 py-1.5 text-[13px] ${
        active ? 'bg-accent-wash font-medium text-accent' : 'text-ink-2 hover:bg-paper hover:text-ink'
      }`}
    >
      <Icon size={14} aria-hidden className="shrink-0" />
      {label}
    </Link>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h2 className="mb-1.5 px-2 text-[11px] font-medium text-ink-3">
        {title}
      </h2>
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
      className={`flex cursor-pointer items-baseline gap-2 rounded-[3px] px-2 py-1 text-left text-[13px] ${
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
