/**
 * 图标。
 *
 * ## 为什么是「注册表 + 一个组件」而不是别的
 *
 * 图标会越来越多，常见的几种组织方式与它们的问题：
 *
 * - **每个图标一个文件、逐个 import**：加一个图标要新建文件 + 改所有调用点的
 *   import。图标从 5 个涨到 30 个时，import 那几行会比图标本身还长。
 * - **SVG sprite（`<symbol>` + `<use>`）：加图标倒是只追加一段 `<symbol>`，
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
 * ## 形状：实心圆底 + 白色内容
 *
 * 5 个都是**实心圆底**加白色内容，而不是「描边圆 + 描边内容」——白描边压在
 * 灰色描边上会糊成一团，而实心底是确定能读出来的。
 *
 * 所以这三个颜色是**图标内部写死的，不吃 currentColor**：
 * - 圆底：`fill="currentColor"`——它由**调用点**决定（见 `STATUS_ICON_TONE`）
 * - 内容：`stroke="#ffffff"`——它要在任何底色上都看得见，所以**不能**跟着底色变
 *
 * `aria-hidden` 是因为旁边就有文字，alt 会把同样的内容念两遍。
 *
 * ## 原始素材
 *
 * `.reference/git-nest-status-icons/`，24×24，与 lucide 的网格对齐。
 * 当前这一版把描边圆改成了实心圆底，内容改成白色，是在这个素材之上的改动。
 */

 type IconProps = {
  className?: string
  /** 边长（px）。24 网格的图标缩到 14–20 都还清楚。 */
  size?: number
}

 function Svg({ className, size = 14, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      className={className}
      aria-hidden
    >
      {children}
    </svg>
  )
}

/** 内容统一：白色描边、圆头圆角 */
const mark = {
  fill: 'none',
  stroke: '#ffffff',
  strokeWidth: 2.1,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const

/** 圆底统一：吃 currentColor，所以底色由调用点给 */
const disc = (cx: number, cy: number, r: number) => <circle cx={cx} cy={cy} r={r} fill="currentColor" />

/* ── 仓库状态（过滤面板那一段） ─────────────────────────────── */

 function AllRepositoriesIcon(p: IconProps) {
  return (
    <Svg {...p}>
      {disc(12, 12, 10)}
      {/* 四个方块：缩小到 r=10 的圆里，靠左上各让一点，视觉上才是「居中」 */}
      <rect x="8.3" y="8.3" width="3.3" height="3.3" rx="0.8" fill="#ffffff" />
      <rect x="12.4" y="8.3" width="3.3" height="3.3" rx="0.8" fill="#ffffff" />
      <rect x="8.3" y="12.4" width="3.3" height="3.3" rx="0.8" fill="#ffffff" />
      <rect x="12.4" y="12.4" width="3.3" height="3.3" rx="0.8" fill="#ffffff" />
    </Svg>
  )
}

 function UpdatableIcon(p: IconProps) {
  return (
    <Svg {...p}>
      {disc(12, 12, 10)}
      <g {...mark}>
        <path d="M12 16.2V8.2" />
        <path d="m8.9 11.3 3.1-3.1 3.1 3.1" />
      </g>
    </Svg>
  )
}

 function SyncedIcon(p: IconProps) {
  return (
    <Svg {...p}>
      {disc(12, 12, 10)}
      <g {...mark}>
        <path d="m7.9 12.1 2.7 2.7 5.5-5.7" />
      </g>
    </Svg>
  )
}

 function NotRecommendedIcon(p: IconProps) {
  return (
    <Svg {...p}>
      {disc(12, 12, 10)}
      <g {...mark}>
        <path d="M8.8 8.8 15.2 15.2" />
        <path d="M15.2 8.8 8.8 15.2" />
      </g>
    </Svg>
  )
}

 function PendingCheckIcon(p: IconProps) {
  return (
    <Svg {...p}>
      {disc(12, 12, 10)}
      <g {...mark}>
        <path d="M12 7.6v5.2" />
        {/* 点用「线帽圆头 + 零长度」画，而不是实心小圆：同一套描边参数，粗细才一致 */}
        <path d="M12 16.1h.01" />
      </g>
    </Svg>
  )
}

/* ── 「我自己的」 ────────────────────────────────────────────
   它不是一个「状态」，但它在面板里和那五个并列，所以形状必须同一套
   （实心圆底 + 白色内容），否则六个条目里有五个圆点、一个缺口，很显眼。
   内容沿用旧的那枚小人（清单行里原来就有它，后来挪走了）。
   ------------------------------------------------------------ */

function MineIcon(p: IconProps) {
  return (
    <Svg {...p}>
      {disc(12, 12, 10)}
      <circle cx="12" cy="9.8" r="3.1" {...mark} />
      <path d="M6.6 18.6c0-2.9 2.4-4.6 5.4-4.6s5.4 1.7 5.4 4.6" {...mark} />
    </Svg>
  )
}

/* ── 注册表 ──────────────────────────────────────────────────
   **加图标只加这一条**，调用点（按名字用）不用动。
   类型从这张表推出来：拼错名字会在编译期就报出来，而不是界面上少一个图标。
   ------------------------------------------------------------ */

 const ICONS = {
  'all-repositories': AllRepositoriesIcon,
  updatable: UpdatableIcon,
  synced: SyncedIcon,
  'not-recommended': NotRecommendedIcon,
  'pending-check': PendingCheckIcon,
  mine: MineIcon,
} as const

export type IconName = keyof typeof ICONS

/** 按名字取图标。调用点只认名字，所以加图标不需要改这里以外任何文件。 */
export function Icon({ name, ...rest }: IconProps & { name: IconName }) {
  const C = ICONS[name]
  return <C {...rest} />
}

/**
 * 仓库状态那一组的**底色**。
 *
 * 加图标时在这里补一行——**形状代码一个字都不用动**（圆底吃 currentColor，
 * 改的只是调用点拿到的 class）。
 *
 * ⚠️ 这五个色值目前**与清单状态列的药丸不是同一套**：
 * 药丸用的是项目 token（可更新 深绿 / 已同步 **灰** / 不推荐 深红 / 待检查 琥珀），
 * 而这里是这套更饱和的图标色。于是同一个状态在两处是两种颜色：
 * 面板里「可更新」是中绿圆点，列表里那行是深绿药丸。
 * 要对齐的话改的是 `features/status/badges.tsx` 的 `ATTENTION_CLASS`，不是这里。
 */
export const STATUS_ICON_TONE: Record<IconName, string> = {
  'all-repositories': 'text-[#2c85f9]',
  updatable: 'text-[#28a870]',
  synced: 'text-[#158e8b]',
  'not-recommended': 'text-[#ec605b]',
  'pending-check': 'text-[#6d80a1]',
  /* 「我自己的」**故意用中性灰**（主题的 ink-3），不跟着上面那套饱和色走：
     它不是一种状态，而是一个布尔——涂成彩色会让人以为「个人」也是一种进度。
     这也是这张表里唯一一个用 token 而不是写死色值的：它本来就不属于那套调色板。 */
  mine: 'text-ink-3',
}