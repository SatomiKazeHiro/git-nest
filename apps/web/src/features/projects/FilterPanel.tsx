import { useMemo, type ComponentType, type ReactNode } from 'react'
import { orderBy } from 'es-toolkit'
import { LaptopMinimal, MessageCircleQuestionMark, Shapes, Tag } from 'lucide-react'
import { type Attention } from '@git-nest/core'
import { categoryIcon } from '@/features/categories/icons'
import { categoryLabelOf } from '@/features/categories/label'
import { useCategories } from '@/features/categories/queries'
import { UNCATEGORIZED, useUiStore } from '@/store/ui'
import { Icon, STATUS_ICON_TONE, type IconName } from '@/components/icons'
import { useProjects } from './queries'

/**
 * 过滤面板：**清单页自己的控件**，只筛这一页的内容。
 *
 * 它**只在清单页存在**——设置页里没有可筛的对象，筛选留在那儿就是个死控件
 * （点了没反应，用户只会觉得这个应用卡了）。`Workspace` 就是清单页的布局路由，
 * 所以「只在清单页」这件事是结构保证的，不需要在这里判断当前路由。
 *
 * 四段：**仓库状态 / 分类 / 标签**，外加最上面一枚「我自己的」开关（它只有一个
 * 选项，单独成段是多余的，见下面那段注释）。「仓库状态」与「我自己的」是两枚布尔，
 * 后两个是「按名字分组」——混在一段里的话读者分不清它们是同一类东西。
 *
 * 面板自己会滚：分类和标签多了以后只滚这一列，清单区不动。
 */
export function FilterPanel() {
  /*
    数数用的必须是**不带任何筛选**的那一份：这里的计数是全量口径。
    跟着当前筛选变的话，「可更新 12」会在你筛完别的东西之后悄悄换成另一个数，
    而那个数看着仍然像是在报告全量的情况。
  */
  const { data: projects } = useProjects({ category: null, tag: null, q: '' })
  // 分类名单从配置里来（内置四个 + 用户自己加的）；接口没回来时它退回内置四个，
  // 所以下面那两处用它的地方不会闪空
  const allCategories = useCategories()
  const category = useUiStore((s) => s.filters.category)
  const tag = useUiStore((s) => s.filters.tag)
  const own = useUiStore((s) => s.filters.own)
  const attention = useUiStore((s) => s.filters.attention)
  const setCategory = useUiStore((s) => s.setCategory)
  const setTag = useUiStore((s) => s.setTag)
  const setOwnOnly = useUiStore((s) => s.setOwnOnly)
  const setAttention = useUiStore((s) => s.setAttention)
  const clearAttention = useUiStore((s) => s.clearAttention)

  const { categories, tags, ownCount, attentionCounts } = useMemo(() => {
    const cats = new Map<string, number>()
    const tagCounts = new Map<string, number>()
    // 分类直接读服务端给的 `attention`——前端不再自己数一遍，
    // 免得两侧的分档逻辑哪天飘开，界面上就出现「点了可更新却没筛干净」
    const ac: Record<Attention, number> = {
      ready: 0,
      synced: 0,
      blocked: 0,
      decide: 0,
      unchecked: 0,
    }
    let ownN = 0
    for (const p of projects ?? []) {
      const c = p.category || UNCATEGORIZED
      cats.set(c, (cats.get(c) ?? 0) + 1)
      for (const t of p.tags) tagCounts.set(t.name, (tagCounts.get(t.name) ?? 0) + 1)
      if (p.isOwn) ownN += 1
      if (ac[p.attention] !== undefined) ac[p.attention] += 1
    }
    return {
      // 排序按**显示名**而不是存进库的英文：既然界面上给的是中文，按英文排出来的
      // 顺序对读者毫无道理（会看到 备份 / 试验 / 知识库 这种交错）。
      categories: orderBy(
        [...cats.entries()],
        [([name]) => (name === UNCATEGORIZED ? 1 : 0), ([name]) => categoryLabelOf(allCategories, name)],
        ['asc', 'asc'],
      ),
      tags: orderBy([...tagCounts.entries()], [([name]) => name.toLowerCase()], ['asc']),
      ownCount: ownN,
      attentionCounts: ac,
    }
  }, [projects])

  if (projects === undefined) {
    return (
      <div className="filter-panel border-r border-line bg-rail px-2 py-3">
        <p className="px-1 py-1 font-mono text-[12px] text-ink-3">…</p>
      </div>
    )
  }

  return (
    <div className="filter-panel flex flex-col gap-4 border-r border-line bg-rail px-2 py-3">
      {/*
        三段共用同一个 `Group` 与同一个 `Item`：一样的标题、一致的间距、同样的
        chip。组间距只由外层这一处 `gap-4` 决定，**不要再往 Group 上加 `pt-*`**——
        两处一起给会把间距算重，而且以后改一处忘了另一处就会漂。

        **「全部仓库」只在这一段有**：它是唯一不是子集的桶，带总数（别处没有），
        并给「当前没筛选」一个可见状态。点它**只清状态那一个维度**，
        分类 / 标签 / 我自己的都不动。

        「需要确认」（verdict=diverged）不单列一项：它是少数情况，
        混进「不推荐」那一档会让后者失去「作者改写了历史」那层警告的分量。
      */}
      {/*
        「我自己的」**不再单独成段**：它只有一个选项，而「一段只有一个选项」那种排版
        是多余的（四段里三段是一串选项、一段孤零零一个）。它现在在面板最上面，用
        **一条底部分隔线**和下面几段分开——形状说明它是「开关」，不是「仓库状态」的
        第一项。

        它和分类 / 标签仍然不是一层的东西（那边是「按名字分组」，这里是「一个真布尔」），
        而且它**与其它维度叠加**——「我的 tools」是一个合理的查询，所以它不去替分类
        那一段的选中态，只自己亮/灭。
      */}
      {ownCount > 0 ? (
        <div className="border-b border-line-soft pb-3">
          <Item
            icon="mine"
            label="我自己的"
            count={ownCount}
            active={own === '1'}
            onClick={() => setOwnOnly(own !== '1')}
          />
        </div>
      ) : null}

      <Group title="仓库状态" icon={LaptopMinimal}>
        <Item
          icon="all-repositories"
          label="全部仓库"
          count={projects.length}
          active={attention === null}
          onClick={clearAttention}
        />
        <Item
          icon="updatable"
          label="可更新"
          count={attentionCounts.ready}
          active={attention === 'ready'}
          onClick={() => setAttention(attention === 'ready' ? null : 'ready')}
        />
        <Item
          icon="synced"
          label="已同步"
          count={attentionCounts.synced}
          active={attention === 'synced'}
          onClick={() => setAttention(attention === 'synced' ? null : 'synced')}
        />
        <Item
          icon="not-recommended"
          label="不推荐"
          count={attentionCounts.blocked}
          active={attention === 'blocked'}
          onClick={() => setAttention(attention === 'blocked' ? null : 'blocked')}
        />
        <Item
          icon="pending-check"
          label="待检查"
          count={attentionCounts.unchecked}
          active={attention === 'unchecked'}
          onClick={() => setAttention(attention === 'unchecked' ? null : 'unchecked')}
        />
      </Group>

      <Group title="分类" icon={Shapes}>
        {categories.length === 0 ? <Hint>还没有项目</Hint> : null}
        {categories.map(([name, n]) => {
          /*
            **从分类记录里取它自己的 `icon`**，不是拿 `name` 当图标名。
            `name` 是分类的 key（`knowledge-base`），而 `categoryIcon()` 认的是图标名
            （`book-open`）——两者不是一回事。直接喂 `name` 会每一行都取到 undefined，
            于是左栏永远什么都不画：看着接上了，其实和没接一样（这正是用户问的
            「设置里有图标、左栏却没有」）。
            「未分类」那一组没有对应记录（它是空串的哨兵），所以它那枚图标在下面**单独给**：
            固定的一枚，不进注册表。
            图标跟着这一行的颜色走（`currentColor`）；认不出来同样不塞占位图。
          */
          const CategoryIcon =
            categoryIcon(allCategories.find((c) => c.key === name)?.icon) ??
            /*
              「未分类」不是一条分类记录（库里存的是空串），所以它取不到 icon——而
              「取不到就什么都不画」那条规矩是给**坏数据**定的，不是给这一项的：它和别的
              分类项并排，缺一枚图标看着像坏了。

              所以给它一枚**固定的**问号气泡：问号表示「没有归属」，与"某种分类"无关，
              因此它**不进图标注册表、也不可配置**（注册表里那 94 个是「分类可以选什么」，
              这一枚不是选项）。
            */
            (name === UNCATEGORIZED ? MessageCircleQuestionMark : undefined)
          return (
            <Item
              key={name}
              label={categoryLabelOf(allCategories, name)}
              count={n}
              active={category === name}
              lucide={CategoryIcon ? <CategoryIcon size={15} className="shrink-0" aria-hidden /> : undefined}
            /* 「未分类」**点得动**：它不是分类，是「没有分类」这个事实，
               但「只看没分类的」是个真实的查询。以前这里是 onClick=undefined
               的死控件（点它没反应，用户只会觉得应用卡了）。

               注意筛的值是**空串而不是 '未分类'**——`name` 是分组用的显示哨兵，
               库里存的却是 ''。拿哨兵去筛会永远匹配不到，「未分类」就变成另一种
               死控件：看着能点，点了等于没筛。 */
            onClick={() => setCategory(name === UNCATEGORIZED ? '' : name)}
          />
          )
        })}
      </Group>

      <Group title="标签" icon={Tag}>
        {tags.length === 0 ? <Hint>还没有标签</Hint> : null}
        {tags.map(([name, n]) => (
          <Item key={name} label={name} count={n} active={tag === name} onClick={() => setTag(name)} />
        ))}
      </Group>
    </div>
  )
}

/**
 * 一段。`icon` 是可选的：给了就在段标题左边放一个。
 *
 * 图标走 lucide（项目已经在用），而条目里的状态图标走 `@/components/icons` 的
 * 注册表——两套并存不冲突：前者是「这一段讲什么」的语义图标（一次性的、
 * 跟着 lucide 走），后者是「这一桶是什么状态」且要按状态配色（所以自带
 * `currentColor` 的注册表）。混进注册表反而会让那 5 个状态图标的调色板
 * 背上「还得给每个图标补一套语义色」的包袱。
 */
function Group({
  title,
  icon: Icon,
  children,
}: {
  title: string
  icon?: ComponentType<{ size?: number; className?: string; 'aria-hidden'?: boolean }>
  children: ReactNode
}) {
  return (
    <section>
      <h2 className="mb-1 flex items-center gap-1.5 px-1 text-[11px] font-medium text-ink-3">
        {Icon ? <Icon size={13} aria-hidden className="shrink-0" /> : null}
        {title}
      </h2>
      <div className="flex flex-col">{children}</div>
    </section>
  )
}

function Item({
  label,
  count,
  active,
  onClick,
  icon,
  lucide,
}: {
  label: string
  count: number
  active: boolean
  onClick?: () => void
  /**
   * 左侧图标的名字（不是组件）。**按名字传而不是 import 组件**：
   * 这样注册表里加一个图标，调用点一行都不用改。
   */
  icon?: IconName
  /**
   * 另一套图标：**分类**用 lucide 组件（按名字分组，跟着这一行的颜色走）。
   * 它和上面那套自带状态色的实心圆底图标（状态桶）**刻意不同源**——状态图标要按
   * 状态配色，两者的差别是设计，不是笔误。"统一"它们反而是错的。
   */
  lucide?: ReactNode
}) {
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      aria-pressed={active}
      className={`flex cursor-pointer items-center gap-1.5 rounded-[3px] px-1 py-1.5 text-left text-[13px] ${
        active ? 'bg-accent-wash text-accent-ink' : 'text-ink-2 hover:bg-sunken hover:text-ink'
      } disabled:cursor-default disabled:text-ink-3 disabled:hover:bg-transparent`}
    >
      {/*
        图标带自己的状态色，**不跟着这一行的选中态走**——选中的是「我现在按
        这个筛」，而图标说的是「这一桶是什么状态」，两件事不该共用一个颜色。
        （`items-center` 而不是 `items-baseline`：SVG 没有基线，按基线排会歪。）
      */}
      {/*
        16px：圆底实际只有 14 的 **83%**（viewBox 24 里画的是 r=10 的圆），
        所以 14 渲染出来只有 11.7px，比 13px 文字的 x-height 还矮，看着像附赠品。
        16 → 圆底 13.3px，与文字齐平。要更大把这里的 prop 调大即可。
      */}
      {icon ? (
        <Icon name={icon} size={16} className={`shrink-0 ${STATUS_ICON_TONE[icon]}`} />
      ) : (
        lucide
      )}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="font-mono text-[11px] text-ink-3">{count}</span>
    </button>
  )
}

function Hint({ children }: { children: ReactNode }) {
  return <p className="px-1 py-1 text-[12px] text-ink-3">{children}</p>
}
