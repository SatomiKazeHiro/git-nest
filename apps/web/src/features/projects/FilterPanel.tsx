import { useMemo, type ReactNode } from 'react'
import { orderBy } from 'es-toolkit'
import { categoryLabel } from '@git-nest/core'
import { UNCATEGORIZED, useUiStore } from '@/store/ui'
import { useProjects } from './queries'

/**
 * 过滤面板：**清单页自己的控件**，只筛这一页的内容。
 *
 * 它以前和侧栏（导航）混在同一列里，于是「分类」看起来像一个能点过去的
 * 页面，点了却只是筛了眼前这张表。分成两列之后「属于哪儿」不用解释：
 *
 * ```
 * 清单页：| sidebar | filter panel | content |
 * 设置页：| sidebar | content |
 * ```
 *
 * 也就是说**它只在清单页存在**——设置页那一栏只有侧栏，筛选没有对象可筛。
 * （`Workspace` 就是清单页的布局路由，所以「只在清单页」这件事是结构保证的，
 * 不需要在这里判断当前路由。）
 *
 * 面板自己会滚：分类和标签多了以后只滚这一列，侧栏与清单表都不动。
 */
export function FilterPanel() {
  // 数数用的必须是**不带筛选**的那份：跟分类/标签的计数同一个口径
  // （按完整清单统计，不受搜索影响）
  const { data: projects } = useProjects({ category: null, tag: null, q: '' })
  const category = useUiStore((s) => s.filters.category)
  const tag = useUiStore((s) => s.filters.tag)
  const own = useUiStore((s) => s.filters.own)
  const setCategory = useUiStore((s) => s.setCategory)
  const setTag = useUiStore((s) => s.setTag)
  const setOwnOnly = useUiStore((s) => s.setOwnOnly)

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
      categories: orderBy(
        [...cats.entries()],
        [([name]) => (name === UNCATEGORIZED ? 1 : 0), ([name]) => categoryLabel(name)],
        ['asc', 'asc'],
      ),
      tags: orderBy([...tagCounts.entries()], [([name]) => name.toLowerCase()], ['asc']),
      ownCount: ownN,
    }
  }, [projects])

  if (projects === undefined) {
    return (
      <div className="filter-panel border-r border-line bg-panel px-2 py-2">
        <p className="px-1 py-1 font-mono text-[12px] text-ink-3">…</p>
      </div>
    )
  }

  return (
    <div className="filter-panel flex flex-col gap-4 border-r border-line bg-panel px-2 py-3">
      {/*
        三个组走**同一个** `Group` + 同一个 `Item`：一样的标题、一致的间距、
        同样的 chip。之前是三套实现——「我自己的」没有标题还带一道 border-b，
        而组间距一处 `gap-4 + pt-3`、另一处 `gap-4 + pt-4`，三组看着像三种东西。

        组间距只由外层这一处 `gap-4` 决定，**不要再往 Group 上加 `pt-*`**：
        两处一起给会把间距算重，而且以后改一处忘了另一处就会漂。
      */}
      {/*
        标题是**维度名**，下面那一行是这个维度的一个取值——和「分类 / 试验」
        「标签 / vue」是同一个关系。三个组的标题因此都是名词，都不与自己的
        取值重复。

        （标题本来写成「我自己的」，于是下面那行也叫「我自己的 1」——
        统一之后这个重复反而更扎眼了。）
      */}
      {ownCount > 0 ? (
        <Group title="作者">
          <Item
            label="我自己的"
            count={ownCount}
            active={own === '1'}
            onClick={() => setOwnOnly(own !== '1')}
          />
        </Group>
      ) : null}

      {/*
        **「未分类」不是一个筛选项。** 它是「这个项目没有分类」这个事实——
        点它筛不出任何东西（它本来就是筛完之后剩下的），而之前它还占着一行
        却点不动（`onClick` 是 undefined），是个死控件。

        要看未分类的那些？把筛选清掉即可，它们本来就在列表里。

        筛选的取消靠**点同一个分类两下**：`setCategory` 本来就是开关语义
        （同一个值再点一次置 null），所以下面每一项都是可点的。
      */}
      <Group title="分类">
        {categories.length === 0 ? <Hint>还没有项目</Hint> : null}
        {categories
          .filter(([name]) => name !== UNCATEGORIZED)
          .map(([name, n]) => (
            <Item
              key={name}
              label={categoryLabel(name)}
              count={n}
              active={category === name}
              onClick={() => setCategory(name)}
            />
          ))}
      </Group>

      <Group title="标签">
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
      </Group>
    </div>
  )
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-1 px-1 text-[11px] font-medium text-ink-3">{title}</h2>
      <div className="flex flex-col">{children}</div>
    </section>
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
      aria-pressed={active}
      className={`flex cursor-pointer items-baseline gap-1.5 rounded-[3px] px-1 py-1.5 text-left text-[13px] ${
        active ? 'bg-accent-wash text-accent' : 'text-ink-2 hover:bg-paper hover:text-ink'
      } disabled:cursor-default disabled:text-ink-3 disabled:hover:bg-transparent`}
    >
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="font-mono text-[11px] text-ink-3">{count}</span>
    </button>
  )
}

function Hint({ children }: { children: ReactNode }) {
  return <p className="px-1 py-1 text-[12px] text-ink-3">{children}</p>
}
