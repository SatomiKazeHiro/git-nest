import { FolderGit2 } from 'lucide-react'

/**
 * 标题栏。**只放品牌**——导航（清单 / 设置）不在这儿。
 *
 * 网页习惯把导航放右上角，那是因为网页没有左栏可用；桌面软件左边本来就有一条，
 * 再在标题栏重复一份导航，等于同一个目的地有两个入口。
 *
 * 窗口控件与拖拽区在打包成桌面软件时才有（那时才有窗口可控制），
 * 现在这里留空也不影响：这一条在浏览器里就是一条普通的顶栏。
 */
export function TitleBar() {
  return (
    <header className="chrome flex h-9 shrink-0 items-center gap-2 border-b border-line bg-panel px-3">
      {/*
        logo。原来是一段手写的 inline SVG（一小段提交图），现在与页面其余图标同源。

        选 FolderGit2 而不是 GitBranch：后者的意思是「git 分支」，
        听起来是这个软件要做 git 操作——而设计文档第 1 节明确写了不做 git 客户端。
        这个软件是「本机一堆仓库的清单」，文件夹 + 分叉正好说的是这件事。
      */}
      <FolderGit2 size={16} aria-hidden className="shrink-0 text-accent" />
      <span className="font-mono text-[13px] font-semibold tracking-tight text-ink">git-nest</span>
      <span className="text-[12px] text-ink-3">本地仓库清单</span>
    </header>
  )
}
