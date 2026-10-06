/**
 * 命令注册表。
 *
 * 菜单栏、全局快捷键、状态栏上的按钮**都通过它调用同一批命令**，
 * 所以「菜单上写了、实际行为不一样」这件事在结构上就不可能发生——
 * 没有人能只改到其中一处。
 *
 * 命令由**离数据最近的那个组件**注册（清单页知道当前筛出了哪些 id，
 * 所以「全选」只有它算得出来），用完在 effect 清理时注销。
 * 没人注册的命令就当没有这回事：快捷键处理器在拦截之前会先问一句，
 * 没有接手人就不 `preventDefault`，于是浏览器自己的 Ctrl+R / Ctrl+W
 * 之类照常工作。
 */

type Handler = () => void

const handlers = new Map<string, Handler>()

/**
 * 注册一个命令，返回注销函数。
 *
 * 注销时**只删自己那一份**：如果同一个 id 被重新注册过（StrictMode 的双次挂载、
 * 或者将来清单页拆成两块），先来的那一份的清理不该把后继者带走。
 */
export function registerCommand(id: string, fn: Handler): () => void {
  handlers.set(id, fn)
  return () => {
    if (handlers.get(id) === fn) handlers.delete(id)
  }
}

export function hasCommand(id: string): boolean {
  return handlers.has(id)
}

export function runCommand(id: string): boolean {
  const fn = handlers.get(id)
  if (!fn) return false
  fn()
  return true
}

/*
  ── 浮层作用域 ──────────────────────────────────────────────────────────

  弹窗打开时，全局快捷键必须**整个让位**。
  不让位的后果很具体：更新报告弹窗开着，你在清单里按 Ctrl+A 想全选报告里的行，
  结果背后那张清单被全选了——用户在弹窗里操作，却改了弹窗后面的东西。
  而且没有任何地方会告诉他「你的选择跑到了后面去」。

  栈而不是布尔量：更新面板会再套一层确认条，弹窗也可能有嵌套；
  只有一个开关时，内层一关就把外层的屏蔽也一起放开了。
*/
let overlayDepth = 0

export function enterOverlay(): () => void {
  overlayDepth += 1
  return () => {
    overlayDepth = Math.max(0, overlayDepth - 1)
  }
}

export function overlayOpen(): boolean {
  return overlayDepth > 0
}
