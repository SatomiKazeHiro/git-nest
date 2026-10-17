import { FolderGit2, Minus, Square, X } from 'lucide-react'
import { desktopWindow, type DesktopWindow } from '@/lib/platform'

/**
 * 标题栏。品牌在左，窗口控件在右，中间一整条是**拖拽区**。
 *
 * 导航不在这里。网页习惯把导航放右上角，是因为网页除了那一条没别的去处；
 * 这个应用的页面由 `react-router` 直接切换，标题栏只负责品牌与窗口控件。
 *
 * 窗口控件只在真的跑在桌面窗口里时才画（`window.__TAURI__` 在，且方法齐了）。
 * 在浏览器里开发时**藏掉而不是画成装饰**：三个点不动的按钮比没有更让人困惑，
 * 而且它们会占掉一截标题栏。判定见 `lib/platform.ts`——**平台差异只允许出现在那一个模块里**。
 */
export function TitleBar() {
  const win = desktopWindow()

  return (
    <header
      className="chrome flex h-9 shrink-0 items-center gap-2 border-b border-line bg-panel pl-3"
      // 拖拽区。Tauri 靠这个属性识别「按住这里可以拖窗口」，浏览器里它什么也
      // 不是，正好现在就能把布局看清楚，将来不用改。
      data-tauri-drag-region
    >
      {/*
        logo。原来是一段手写的 inline SVG（一小段提交图），现在与页面其余图标同源。

        选 FolderGit2 而不是 GitBranch：后者的意思是「git 分支」，
        听起来是这个软件要做 git 操作——而这个软件明确不做 git 客户端。
        这个软件是「本机一堆仓库的清单」，文件夹 + 分叉正好说的是这件事。
      */}
      <FolderGit2 size={16} aria-hidden className="shrink-0 text-accent" />
      <span className="font-mono text-[13px] font-semibold tracking-tight text-ink">git-nest</span>
      <span className="text-[12px] text-ink-3">本地仓库清单</span>

      {win ? <WindowControls win={win} /> : null}
    </header>
  )
}

function WindowControls({ win }: { win: DesktopWindow }) {
  return (
    <div className="ml-auto flex items-stretch self-stretch">
      <Control label="最小化" onClick={() => void win.minimize()}>
        <Minus size={14} aria-hidden />
      </Control>
      <Control label="最大化 / 还原" onClick={() => void win.toggleMaximize()}>
        <Square size={11} aria-hidden />
      </Control>
      <Control label="关闭" danger onClick={() => void win.close()}>
        <X size={14} aria-hidden />
      </Control>
    </div>
  )
}

function Control({
  label,
  danger,
  onClick,
  children,
}: {
  label: string
  danger?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      // 图标按钮必须有可访问名——这里没有可见文字
      aria-label={label}
      title={label}
      className={`flex w-11 cursor-pointer items-center justify-center text-ink-2 hover:bg-paper hover:text-ink ${
        danger ? 'hover:bg-signal-bad hover:text-white' : ''
      }`}
    >
      {children}
    </button>
  )
}
