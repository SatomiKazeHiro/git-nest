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
 */

/** 全局命令。`inInput` 表示「焦点在输入框里时也允许」—— */
export interface GlobalCommand {
  id: string
  label: string
  combo: string
  /**
   * 焦点在输入框 / 文本域里时，按这个键要不要仍然生效。
   *
   * 默认**不生效**，这是保守的一边：Ctrl+A 在文本框里必须还是「选中这段文字」，
   * 不能变成「勾选清单里全部行」——那是很难发现的劫持。少数确实该在输入时也
   * 管的（把焦点挪到搜索框、进设置、折叠某栏）显式标 true。
   */
  inInput?: boolean
}

export const GLOBAL_COMMANDS: GlobalCommand[] = [
  { id: 'focus-search', label: '搜索项目', combo: 'Ctrl+F', inInput: true },
  { id: 'open-settings', label: '设置', combo: 'Ctrl+,', inInput: true },
  { id: 'toggle-detail', label: '显示 / 隐藏详情栏', combo: 'Ctrl+J', inInput: true },
  { id: 'check-updates', label: '联网检查更新（只查勾选的）', combo: 'Ctrl+Enter' },
  { id: 'select-all', label: '勾选当前清单的全部行', combo: 'Ctrl+A' },
  { id: 'refresh-local', label: '重读本地状态（不联网）', combo: 'F5' },
]

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

/** 给菜单栏显示用：`Ctrl+Shift+U` → `Ctrl+Shift+U`（Win 习惯原样显示）。 */
export function comboLabel(combo: string): string {
  return combo
}
