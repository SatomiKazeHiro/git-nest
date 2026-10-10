import type { CommandId } from './keys'

/**
 * 命令注册表。
 *
 * 现在**唯一的调用方是全局快捷键**（菜单栏与状态栏都已经不在了）。
 *
 * 命令由**离数据最近的那个组件**注册，用完在 effect 清理时注销。
 * 没人注册的命令就当没有这回事：快捷键处理器在拦截之前会先问一句，
 * 没有接手人就不 `preventDefault`，于是浏览器自己的 Ctrl+R / Ctrl+W
 * 之类照常工作。
 *
 * **id 的类型是 `CommandId`**（从 `keys.ts` 那张快捷键表派生）：表里没有的 id
 * 注册不进来。以前这里是裸 `string`，于是清单页一直留着两个菜单栏时代的注册
 * （`open-create` / `open-scan`）——菜单删掉之后，`GLOBAL_COMMANDS` 里没有它们，
 * 唯一会调用 `runCommand` 的就是那个按表派发的 keydown 处理器，也就是说
 * 那两个闭包**永远跑不到**。它们照样编译、照样过 review，只是永远不执行。
 */

type Handler = () => void

const handlers = new Map<CommandId, Handler>()

/**
 * 注册一个命令，返回注销函数。
 *
 * 注销时**只删自己那一份**：如果同一个 id 被重新注册过（StrictMode 的双次挂载、
 * 或者将来清单页拆成两块），先来的那一份的清理不该把后继者带走。
 */
export function registerCommand(id: CommandId, fn: Handler): () => void {
  handlers.set(id, fn)
  return () => {
    if (handlers.get(id) === fn) handlers.delete(id)
  }
}

export function hasCommand(id: CommandId): boolean {
  return handlers.has(id)
}

export function runCommand(id: CommandId): boolean {
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
