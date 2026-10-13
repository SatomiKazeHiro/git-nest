import { useState } from 'react'
import { apiUrl } from '@/lib/api'

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
  size = 32,
  className = '',
}: {
  projectId: number
  /** 缺省 32：它替换的是清单里那枚图标的位置 */
  size?: number
  /** 微调位置用（详情页要跟 17px 的标题对齐） */
  className?: string
}) {
  const [failed, setFailed] = useState(false)
  /** 原图的宽高比。**没加载出来之前不知道**，那就先按 contain 画一帧。 */
  const [ratio, setRatio] = useState<number | null>(null)
  if (failed) return null

  /*
    1:1.5 之外的形状（横长条的字标、竖长条的图）用 `cover` 填满这一格。
    `contain` 会把横长条缩成一条细线，四周全是空的——32px 上几乎看不见东西。

    **cover 会裁掉两头，这是有意的取舍**：填满比看得见全貌更重要。
    正常比例的图仍然是 `contain`——把一个方形的 logo 裁掉才是真的错。
  */
  const fill = ratio !== null && (ratio > 1.5 || ratio < 1 / 1.5)

  return (
    <img
      // 走 apiUrl()：打包形态下没有 vite 代理，相对路径会打到 webview 自己身上
      // （见 lib/api.ts 顶部那段说明）
      src={apiUrl(`/projects/${projectId}/logo`)}
      alt=""
      aria-hidden
      onLoad={(e) => {
        const { naturalWidth, naturalHeight } = e.currentTarget
        if (naturalWidth > 0 && naturalHeight > 0) setRatio(naturalWidth / naturalHeight)
      }}
      onError={() => setFailed(true)}
      /*
        宽高走 style 而不是 Tailwind 类：尺寸是调用方给的动态值，而
        `w-[${size}px]` 这种写法 Tailwind 编译不出来。**必须显式给高度**——
        preflight 里有 `img { height: auto }`，只给宽度的话，一张宽图会被
        「撑」成一个细条（`object-fit` 只在框内生效，框得先定下来）。
      */
      style={{ width: size, height: size }}
      className={`shrink-0 rounded-[3px] ${fill ? 'object-cover' : 'object-contain'} ${className}`}
    />
  )
}
