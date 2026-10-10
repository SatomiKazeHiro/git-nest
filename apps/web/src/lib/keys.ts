/**
 * 加速键表。**唯一的一份来源。**
 *
 * 菜单栏上印出来的组合键、真正生效的组合键、以及下面这些注释里的说明，
 * 全部读这一个表。以前按钮的文字是手写的、行为是散在 onClick 里的，
 * 于是「菜单上写着 Ctrl+Shift+U、实际按了没反应」这种事没有任何东西拦得住。
 *
 * 两类键，**不要混**：
 * - **全局命令**：都带 Ctrl（或 F5），在任何地方都成立。
 * - **行内命令**（↑↓ / Space / Enter / Delete）：没有修饰键，只有当焦点在表格里
 *   才该生效。混进全局表的话，用户在设置页按 Delete 就会把某个项目删了。
 *
 * **这张表同时是命令 id 的唯一来源**（`CommandId`，见文件末尾）：`registerCommand`
 * 只收表里的 id。菜单栏已经不在了，快捷键处理器是唯一的派发方——一条命令要能被
 * 触发就必须在表里，所以「注册一条没人按得到的命令」和「id 拼错」现在都是
 * 编译错误，而不是两个安静跑到死的闭包（清单页原来就留着这样的两个，见
 * `commands.ts` 的文件头）。
 */

/** id 的类型见文件末尾的 `CommandId`——**不要**在这里手写联合类型。 */
 interface GlobalCommand {
  id: string
  label: string
  combo: string
  /**
   * 焦点在输入框 / 文本域里时，按这个键要不要仍然生效。
   *
   * **每一条都显式写出来**：默认值也是行为的一部分，藏在省略里就等于没写，
   * 而读的人没法从表上看出这条命令在输入时到底管不管。默认不生效是保守的一边
   * ——Ctrl+A 在文本框里必须还是「选中这段文字」，不能变成「勾选清单里全部行」，
   * 那是很难发现的劫持。少数确实该在输入时也管的（把焦点挪到搜索框、进设置、
   * 折叠某栏）写 true。
   */
  inInput: boolean
}

export const GLOBAL_COMMANDS = [
  { id: 'focus-search', label: '搜索项目', combo: 'Ctrl+F', inInput: true },
  { id: 'open-settings', label: '设置', combo: 'Ctrl+,', inInput: true },
  { id: 'toggle-detail', label: '显示 / 隐藏详情栏', combo: 'Ctrl+J', inInput: true },
  {
    id: 'check-updates',
    label: '联网检查更新（当前筛选出的全部）',
    combo: 'Ctrl+Enter',
    inInput: false,
  },
  { id: 'refresh-local', label: '重读本地状态（不联网）', combo: 'F5', inInput: false },
] as const satisfies readonly GlobalCommand[]

/**
 * 命令 id。**从上面那张表派生**，不手写——手写就又有了两个来源，
 * 而这两个来源之间没有任何东西保证一致。
 */
export type CommandId = (typeof GLOBAL_COMMANDS)[number]['id']

/**
 * 键盘事件 → 规范化的组合键字符串（`Ctrl+Shift+U`、`F5`、`Escape`）。
 *
 * 修饰键顺序固定成 Ctrl → Alt → Shift → 键本身，**方向键与小写字母都会被
 * 归一**（`ArrowUp` → `Up`、`a` → `A`），所以表里写 `Ctrl+U` 就能匹配
 * 按下时实际报出来的 `Ctrl+u`。少了这一步，每加一条命令都要有人先去
 * 控制台里把事件的 `key` 打出来看。
 */
export function comboOf(e: KeyboardEvent): string {
  const parts: string[] = []
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')

  const key = e.key
  if (key === ' ') parts.push('Space')
  else if (key.length === 1) parts.push(key.toUpperCase())
  else if (key === 'Escape') parts.push('Escape')
  else if (key === 'ArrowUp') parts.push('Up')
  else if (key === 'ArrowDown') parts.push('Down')
  else if (key === 'Delete') parts.push('Delete')
  else if (key === 'Enter') parts.push('Enter')
  else parts.push(key)

  return parts.join('+')
}

/** 焦点是不是在用户正在输入的地方（输入框、文本域、可编辑区域）。 */
export function isEditable(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el || !el.tagName) return false
  const tag = el.tagName.toUpperCase()
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}
