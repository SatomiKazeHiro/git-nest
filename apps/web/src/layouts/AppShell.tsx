import { useEffect, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { hasCommand, overlayOpen, registerCommand, runCommand } from '@/lib/commands'
import { GLOBAL_COMMANDS, comboOf, isEditable } from '@/lib/keys'
import { useUiStore } from '@/store/ui'
import { TitleBar } from '@/components/TitleBar'

/**
 * 窗口外壳：标题栏 / 主体。
 *
 * **根节点不滚。** 原来这里是 `min-h-screen flex-col` + 粘性顶栏，也就是一个
 * 会滚的网页文档：页面自己滚、顶栏浮在上面、选中提示浮在底部。
 * 桌面软件的窗口是固定的一屏，纵向空间由两条带（标题 / 主体）占掉，
 * 滚动只发生在「主体」里面——所以真正要滚的是哪一栏，取决于它有多长，
 * 而不是取决于谁加了 `sticky`。
 *
 * 布局规则都写在 `index.css` 的「窗口骨架」一节里，这里只负责把带拼起来，
 * 外加装全局快捷键。
 *
 * **为什么这个文件在 `layouts/` 而不是 `components/`**：`components/` 是通用层
 * （按钮、弹窗、图标），它必须能不认识任何 feature——否则「通用层 → 业务」这条
 * 反向依赖就会出现，而这个仓库已经踩过一次（「编辑资料」弹窗曾挂在这个文件里，
 * 于是通用层认识了 `features/projects`）。外壳不是通用组件：它认识命令表、
 * 认识 store，将来也可能要拼装业务组件。所以它在布局这一层。
 * 分开放，是为了让那条规矩**一眼看得出来**，而不是靠人记着。
 */
export function AppShell({ children }: { children: ReactNode }) {
  const navigate = useNavigate()

  // 与操作对象无关的那几条命令，挂载一次就够
  useEffect(() => registerCommand('open-settings', () => navigate('/settings')), [navigate])
  useEffect(() => registerCommand('toggle-detail', () => useUiStore.getState().toggleDetail()), [])

  /*
    全局快捷键：**一个** keydown 监听挂在 window 上。

    三条不能省的判断，少一条就会咬人：
    1. **浮层开着就让位**。否则在更新报告弹窗里按 Ctrl+A，被全选的是背后
       那张清单，而屏幕上没有任何东西提示过这件事。
    2. **焦点在输入框里时，大多数命令让位**。Ctrl+A 在文本框里必须还是
       「选中这段文字」，不能变成「勾选清单里全部行」——那种劫持很难被发现。
    3. **没人接手的命令不拦**（先 `hasCommand` 再 `preventDefault`）。
       不这么做的话，浏览器自己的 Ctrl+R 刷新、Ctrl+W 关标签页、
       Ctrl+T 开新标签会被这个应用悄悄吃掉——而它对这几条命令毫无关系。
  */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (overlayOpen()) return
      const combo = comboOf(e)
      const inField = isEditable(e.target)
      for (const c of GLOBAL_COMMANDS) {
        if (c.combo !== combo) continue
        if (inField && !c.inInput) return
        if (!hasCommand(c.id)) return
        e.preventDefault()
        runCommand(c.id)
        return
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="app">
      <TitleBar />
      <div className="body">
        <main className="content">{children}</main>
      </div>
    </div>
  )
}
