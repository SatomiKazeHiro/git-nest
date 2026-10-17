/**
 * 平台能力：**web 与桌面壳的差异只允许出现在这个文件里**。
 *
 * 同一个界面要跑在两个环境里：
 *
 * | | 浏览器（`pnpm dev` 里那个页面） | 桌面壳（Tauri 窗口） |
 * |---|---|---|
 * | 窗口控件 | 没有真窗口可控制 → 不画 | 最小化 / 最大化 / 关闭 |
 * | 选目录 | 只能**手输**路径 | 能开系统目录选择框 |
 *
 * 这些差异如果散在组件里（每个调用点各写一次 `if (window.__TAURI__)`），结果一定
 * 是**某处漏了**：漏在浏览器里只是少一个按钮（没人发现），漏在桌面壳里就是点了
 * 没反应——而它只在打包形态下现形，正是最难查的那一类。所以收成这一个模块，
 * 并由 `platform.guard.test.ts` 在测试里钉住「别处不许碰 `__TAURI__`」。
 *
 * ## 三条规矩
 *
 * 1. **只有这个文件能碰 `window.__TAURI__`**（`apps/web/src/lib/platform.guard.test.ts`
 *    会扫源码，别处出现就红）。
 * 2. **刻意不引 `@tauri-apps/api`**：那会把 Tauri 那套打进浏览器开发包，换壳时整块重写。
 *    这里只依赖「注入了一个带这些方法的全局对象」这一件事，谁来注入都认。
 *    全局对象由壳在**页面任何脚本之前**注入（`src-tauri/tauri.conf.json` 的
 *    `withGlobalTauri: true`）。
 * 3. **不静默兜底**：能力缺了就是缺了——`capabilities()` 说 false，界面不画那个控件；
 *    真被调用到而不可用，**抛 `PlatformError`**。返回值里的 `null` 只有一个含义：
 *    **用户点了取消**。把「不可用」也做成 `null`，等于把故障伪装成正常操作。
 */

/** 哪一项能力。错误里带着它，界面才知道该说哪句话。 */
export type PlatformCapability = 'window-controls' | 'native-folder-picker'

/**
 * 平台操作失败。**用途是给排查留线索**，所以两件事必须都有：
 * `capability`（缺的是哪一项）与 `cause`（底层原来抛了什么）。
 */
export class PlatformError extends Error {
  constructor(
    readonly capability: PlatformCapability,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options)
    this.name = 'PlatformError'
  }
}

/** 桌面窗口能做的三件事。**方法而不是布尔量**：见下面 `currentWindow()` 的说明。 */
export interface DesktopWindow {
  minimize: () => Promise<void>
  toggleMaximize: () => Promise<void>
  close: () => Promise<void>
  startDragging: () => Promise<void>
}

/** 当前环境能做什么。每一项都可以单独缺，界面按它决定画不画。 */
export interface Capabilities {
  /** 有真窗口可控制（桌面壳）→ 标题栏右侧的三个按钮 */
  windowControls: boolean
  /** 能开系统目录选择框（桌面壳 + dialog 插件）→ 路径输入框旁边的「选择目录…」 */
  nativeFolderPicker: boolean
}

interface TauriWindowModule {
  /**
   * v2 的形态：`__TAURI__.window` 是**模块命名空间**，窗口实例从 getCurrentWindow() 拿。
   * 老代码直接读 `__TAURI__.window.minimize`，那在 v2 里永远是 undefined
   * ——于是标题栏那三个按钮在打包形态里根本画不出来（只在浏览器里"看不见"，不报错）。
   */
  getCurrentWindow?: () => Partial<DesktopWindow> | null
  minimize?: () => Promise<void>
  toggleMaximize?: () => Promise<void>
  close?: () => Promise<void>
  startDragging?: () => Promise<void>
}

interface OpenDialogOptions {
  directory?: boolean
  multiple?: boolean
  title?: string
}

interface TauriDialogModule {
  open?: (options: OpenDialogOptions) => Promise<string | string[] | null>
}

interface TauriCoreModule {
  /** 所有插件命令的底层通道（`invoke('plugin:dialog|open', …)`） */
  invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>
}

interface TauriGlobal {
  window?: TauriWindowModule
  dialog?: TauriDialogModule
  core?: TauriCoreModule
}

function tauri(): TauriGlobal | null {
  return (globalThis as { __TAURI__?: TauriGlobal }).__TAURI__ ?? null
}

/**
 * 打开目录选择框的那条路，返回 `null` = 这个环境没有这项能力。
 *
 * 两条路，**优先用插件自己的 JS API**：
 * 1. `__TAURI__.dialog.open(...)`：插件 JS 也在全局里时（更直接，参数就是插件的参数）；
 * 2. `__TAURI__.core.invoke('plugin:dialog|open', { options })`：`withGlobalTauri`
 *    只保证**核心** API 在全局里，插件 JS 不一定被一起注入。这个应用刻意不引
 *    `@tauri-apps/plugin-dialog`（见文件头第 2 条），所以这条兜底是实际会走到的路。
 *    它要求 Rust 侧注册了 dialog 插件 + capability 给了 `dialog:allow-open`；
 *    没给的话命令不存在，**点下去会如实报错**（而不是让按钮消失、让人以为没做）。
 */
function openDirectoryVia(): ((options: OpenDialogOptions) => Promise<unknown>) | null {
  const t = tauri()
  const direct = t?.dialog?.open
  if (typeof direct === 'function') return (options) => direct(options)
  const invoke = t?.core?.invoke
  if (typeof invoke === 'function') return (options) => invoke('plugin:dialog|open', { options })
  return null
}

/**
 * 「现在是不是跑在桌面窗口里」→ 返回那三枚方法。
 *
 * 返回的是**方法**而不是布尔量：窗口还没初始化好时全局对象可能已经在，但方法还没挂上，
 * 只判断「有没有这个对象」会得到一个假的肯定。
 *
 * 两种形态都认（v2 的 `getCurrentWindow()` 与「对象上直接挂方法」），因为换壳/换版本
 * 时这里不该成为第二处要改的地方。
 */
function currentWindow(): DesktopWindow | null {
  const w = tauri()?.window
  if (!w) return null
  const win = typeof w.getCurrentWindow === 'function' ? w.getCurrentWindow() : w
  if (!win) return null
  const needed = ['minimize', 'toggleMaximize', 'close'] as const
  return needed.every((k) => typeof win[k] === 'function') ? (win as DesktopWindow) : null
}

/** 窗口控件能不能显示。没有真窗口可控制时返回 null，调用方自己决定画不画。 */
export function desktopWindow(): DesktopWindow | null {
  return currentWindow()
}

/** 当前环境的能力清单。**每次现算**：窗口/插件可能在挂载之后才就绪，缓存会缓存一个假的「没有」。 */
export function capabilities(): Capabilities {
  return {
    windowControls: currentWindow() !== null,
    nativeFolderPicker: openDirectoryVia() !== null,
  }
}

/** 能不能开系统目录选择框。界面用它决定「选择目录…」那枚按钮画不画。 */
export function canPickDirectory(): boolean {
  return capabilities().nativeFolderPicker
}

/**
 * 开系统目录选择框，返回选中的绝对路径。
 *
 * - **`null` = 用户取消**（关掉对话框 / 按 Esc）；
 * - **抛 `PlatformError` = 这项能力不可用或失败**。两种不可用要说清是哪一种，
 *   因为排查方向完全不同：浏览器里根本没有这个能力（正常，手输就行），
 *   而桌面壳里缺 dialog 插件是**配置漏了**（`src-tauri` 的 Cargo 依赖 + capability）。
 *
 * 路径**原样返回**，不转斜杠：归一化是服务端的事（`apps/server/src/lib/paths.ts`
 * 的 `toAbsolutePath`），前端再转一份就是第二套规则——UNC 路径那种
 * `\\server\share` 正是两边各转一次会转坏的东西。
 */
export async function pickDirectory(title?: string): Promise<string | null> {
  const open = openDirectoryVia()
  if (!open) {
    throw new PlatformError(
      'native-folder-picker',
      tauri()
        ? '桌面壳里没有 dialog 插件，打不开目录选择框（src-tauri 的 Cargo 依赖与 capability 要一起加）'
        : '浏览器里没有系统目录选择框，只能手输路径',
    )
  }

  let picked: unknown
  try {
    picked = await open({ directory: true, multiple: false, ...(title ? { title } : {}) })
  } catch (cause) {
    throw new PlatformError(
      'native-folder-picker',
      `打开目录选择框失败：${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    )
  }

  if (picked === null || picked === undefined) return null
  // multiple: false 时正常回一个字符串；回了数组也不当错误，取第一个
  if (typeof picked === 'string') return picked
  if (Array.isArray(picked)) return typeof picked[0] === 'string' ? picked[0] : null
  // 回来的值读不懂：不猜，报出来（排查时这句 message 是唯一线索）
  throw new PlatformError(
    'native-folder-picker',
    `目录选择框返回了读不懂的值：${JSON.stringify(picked).slice(0, 120)}`,
  )
}
