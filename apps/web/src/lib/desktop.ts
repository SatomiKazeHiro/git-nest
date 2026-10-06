/**
 * 「现在是不是跑在桌面软件窗口里」。
 *
 * **刻意不引 Tauri 的依赖**（`window.__TAURI__` 是它注入的全局对象，直接读
 * 就行）。引入 `@tauri-apps/api` 会在浏览器开发时也把它那套东西打进包里，
 * 而且换壳时（Electron / Wails）这个判断就得整个重写——现在这版只依赖
 * 「注入了一个带这几个方法的全局对象」这一件事，谁来注入都认。
 *
 * 返回的是**方法**而不是布尔量：窗口还没初始化好时全局对象可能已经在，
 * 但方法还没挂上，只判断「有没有这个对象」会得到一个假的肯定。
 */
export interface DesktopWindow {
  minimize: () => Promise<void>
  toggleMaximize: () => Promise<void>
  close: () => Promise<void>
  startDragging: () => Promise<void>
}

function desktop(): DesktopWindow | null {
  const g = (globalThis as { __TAURI__?: { window?: DesktopWindow } }).__TAURI__
  const w = g?.window
  if (!w) return null
  const needed = ['minimize', 'toggleMaximize', 'close'] as const
  return needed.every((k) => typeof w[k] === 'function') ? w : null
}

/** 窗口控件能不能显示。没有真窗口可控制时返回 null，调用方自己决定画不画。 */
export function desktopWindow(): DesktopWindow | null {
  return desktop()
}
