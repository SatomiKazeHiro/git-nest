import type { ReactNode } from 'react'
import { Dialog } from './Dialog'

/**
 * 确认弹窗：**会动数据的操作都从这一个口子过**。
 *
 * 它只做一件事——把「要确认的动作」该有的形状固定下来。抽它的直接原因是这个仓库里
 * 发生过两种相反的毛病：
 *
 * 1. **各写一遍**：两处「移出清单」各自重写了标题措辞、`留下`/`移出清单` 的文案、
 *    危险色、忙碌态，还得各自处理和「扫描弹窗里再嵌一层」这种情形；
 * 2. **干脆没写**：「删除标签」和「清空命令日志」连确认都没有，点了就发。
 *
 * `danger` **是必填的**（不是 `danger?: boolean`）：这样「这个动作危不危险」在写调用
 * 点时是**必须回答**的问题，而不是可以忘掉的一项——忘掉危险色的默认恰恰是最糟的默认。
 * 它说的是「会不会毁掉你自己的东西」：移出清单、删标签是；清空一份**诊断日志**不是
 * ——那同样要拦一下，但不该涂成红色。
 *
 * 它和 `Dialog` 一样是**纯组件**：不读 store、没有 `open`，渲染与否由调用方决定
 * （`{target ? <ConfirmDialog … /> : null}`）。遮罩、Escape、焦点圈定与归还、
 * 嵌套层级都在 `Dialog` 里，这里不重复实现。
 */
export function ConfirmDialog({
  title,
  description,
  children,
  confirmText = '确认',
  cancelText = '取消',
  icon,
  danger,
  loading = false,
  onConfirm,
  onClose,
}: {
  title: string
  /** 一句话说清「会发生什么」。可以是富文本（比如把路径用等宽体标出来） */
  description?: ReactNode
  /** 需要额外内容时用它（错误横幅之类），排在说明下面 */
  children?: ReactNode
  confirmText?: string
  cancelText?: string
  /** 确认按钮左边那枚图标（lucide 元素） */
  icon?: ReactNode
  /** **必填**：这个动作会不会毁掉用户自己的东西。见文件头 */
  danger: boolean
  /** 正在处理：确认按钮转圈并禁用（取消仍可点——它不写任何数据） */
  loading?: boolean
  onConfirm: () => void
  onClose: () => void
}) {
  return (
    <Dialog
      title={title}
      cancel={{ text: cancelText }}
      confirm={{
        text: confirmText,
        onClick: onConfirm,
        variant: danger ? 'danger' : 'primary',
        loading,
        ...(icon ? { icon } : {}),
      }}
      onClose={onClose}
    >
      {description ? <p className="text-[13px] text-ink-2">{description}</p> : null}
      {children}
    </Dialog>
  )
}
