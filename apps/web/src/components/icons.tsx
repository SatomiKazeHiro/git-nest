/**
 * 图标。
 *
 * ## 为什么是「注册表 + 一个组件」而不是别的
 *
 * 图标会越来越多，常见的几种组织方式与它们的问题：
 *
 * - **每个图标一个文件、逐个 import**：加一个图标要新建文件 + 改所有调用点的
 *   import。图标从 5 个涨到 30 个时，import 那几行会比图标本身还长。
 * - **SVG sprite（`<symbol>` + `<use>`**：加图标倒是只追加一段 `<symbol>`，
 *   但外部文件里的 symbol 不能被稳定地跨文件引用，最后往往还是要把整个 sprite
 *   内联进 HTML，于是又回到一个大文件。
 * - **`.svg` 文件 + 构建插件转 React**：多一个构建依赖，而这里要的只是
 *   「跟着文字颜色」这一件事。
 *
 * **注册表**把这两头都省了：加一个图标 = 在 `ICONS` 里加一条；调用点只认**名字**
 * （`<Item icon="updatable" …>`），所以加图标**不动任何调用点**。
 * 图标多到某个域自己放不下了（>20 个），按域拆成 `icons/status.tsx`、
 * `icons/nav.tsx`，注册表合并导入，调用点照样不变。
 *
 * ## 为什么内联而不是 `<img src="x.svg">`
 *
 * `<img>` 加载的 SVG **不继承宿主的 `currentColor`**——它是个独立文档。
 * 而这些图标的意义恰恰是「颜色随状态走」，内联才能做到。
 *
 * 顺带的好处：零额外请求，离线可用（本软件平时不联网）。
 *
 * ## 颜色
 *
 * **一律用项目的 token（`text-ok` / `text-bad` / `text-amber` / `text-flat`）**，
 * 不跟图标包自带的色值（那些是为了在白底网页上单独用而调的）。
 * 尤其 `synced` 不用青绿：本项目的不变量是**只有「可更新」是绿的**，
 * 「已同步」刻意做成灰——图标上色必须服从同一条。
 *
 * ## 原始素材
 *
 * `.reference/git-nest-status-icons/`，5 个 24×24、`currentColor`、
 * stroke-width 1.8，与 lucide 的网格对齐。
 */

export type IconProps = {
  className?: string
  /** 边长（px）。24 网格的图标缩到 14–20 都还清楚。 */
  size?: number
}

/** 5 个图标与 lucide 同一套描边参数——混用两套会看出粗细不一致 */
const stroke = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const

function Svg({ className, size = 14, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      {...stroke}
      width={size}
      height={size}
      className={className}
      /* 图标是装饰：旁边就有文字，alt 会把同样的内容念两遍 */
      aria-hidden
    >
      {children}
    </svg>
  )
}

/* ── 仓库状态（过滤面板那一段） ─────────────────────────────── */

export function AllRepositoriesIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
    </Svg>
  )
}

export function UpdatableIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 16V7" />
      <path d="m8.5 10.5 3.5-3.5 3.5 3.5" />
    </Svg>
  )
}

export function SyncedIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="m7.8 12.2 2.8 2.8 5.8-6" />
    </Svg>
  )
}

export function NotRecommendedIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M8.5 8.5 15.5 15.5" />
      <path d="M15.5 8.5 8.5 15.5" />
    </Svg>
  )
}

export function PendingCheckIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v5" />
      <path d="M12 16.2h.01" />
    </Svg>
  )
}

/* ── 注册表 ──────────────────────────────────────────────────
   **加图标只加这一条**，调用点（按名字用）不用动。
   类型从这张表推出来：拼错名字会在编译期就报出来，而不是界面上少一个图标。
   ------------------------------------------------------------ */

export const ICONS = {
  'all-repositories': AllRepositoriesIcon,
  updatable: UpdatableIcon,
  synced: SyncedIcon,
  'not-recommended': NotRecommendedIcon,
  'pending-check': PendingCheckIcon,
} as const

export type IconName = keyof typeof ICONS

/** 按名字取图标。调用点只认名字，所以加图标不需要改这里以外任何文件。 */
export function Icon({ name, ...rest }: IconProps & { name: IconName }) {
  const C = ICONS[name]
  return <C {...rest} />
}

/**
 * 仓库状态那一组的**配色**。
 *
 * 跟着 token 走而不是图标包自带的色值——理由见本文件顶部。
 * 「全部仓库」是中性灰：它不是一个状态，只是「不筛」。
 */
export const STATUS_ICON_TONE: Record<IconName, string> = {
  'all-repositories': 'text-ink-3',
  updatable: 'text-ok',
  synced: 'text-flat',
  'not-recommended': 'text-bad',
  'pending-check': 'text-amber',
}