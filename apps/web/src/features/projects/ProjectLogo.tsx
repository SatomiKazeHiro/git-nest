import { useState } from 'react'

/**
 * 项目的小 logo。
 *
 * **没有就是没有。** `hasLogo` 为假时这个组件根本不会被渲染——不占位、不留灰块、
 * 也不做首字母方块。大多数仓库根本没有 logo，而那一格本来就只需要项目名；
 * 补一个占位符只是让界面多一样需要解释的东西。
 *
 * 图从 `/api/projects/:id/logo` 来：服务端现读现发仓库里的那个文件，
 * **只发图片、只发仓库内的文件、不发远程地址**。所以这里只剩一件事要管：
 * 加载失败（文件被删了、换了名字、结论过期）就把它藏起来，不显示破图。
 */
export function ProjectLogo({
  projectId,
  size = 16,
  className = '',
}: {
  projectId: number
  size?: number
  /** 微调位置用（详情页要跟 17px 的标题对齐） */
  className?: string
}) {
  const [failed, setFailed] = useState(false)
  if (failed) return null

  return (
    <img
      src={`/api/projects/${projectId}/logo`}
      alt=""
      aria-hidden
      onError={() => setFailed(true)}
      /*
        宽高走 style 而不是 Tailwind 类：尺寸是调用方给的动态值，而
        `w-[${size}px]` 这种写法 Tailwind 编译不出来。**必须显式给高度**——
        preflight 里有 `img { height: auto }`，只给宽度的话，一张宽图会被
        「撑」成一个细条（`object-contain` 只在框内生效，框得先定下来）。
      */
      style={{ width: size, height: size }}
      className={`shrink-0 rounded-[3px] object-contain ${className}`}
    />
  )
}
