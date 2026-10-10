import { useState } from 'react'
import { typeIconUrl } from './typeIcons'

/**
 * 项目类型角标：压在默认文件夹图的**右下角**。
 *
 * 视觉规格（使用者定的）：**16×16 白圆 + 12×12 图标**。
 * 之所以要白圆底：图标是**纯形状、没有自带底**（品牌多边形，不是带圆形/方形底
 * 的成套图标），直接压在彩色文件夹上会糊在一起。白圆把它们统一成同一种底，
 * 也顺手把「这是角标、不是文件夹的一部分」说清楚了。
 *
 * 图标的来源是 `docs/types/<type>.svg`（见 `typeIcons.ts`）：**没有那个文件就不画**
 * ——认不出来、或者还没收集到那张图标，都是常见的正常状态，界面上不该出现空圈。
 */
const BADGE_PX = 16
const ICON_PX = 12

export function ProjectTypeBadge({ type }: { type: string | null }) {
  const [failed, setFailed] = useState(false)
  const url = typeIconUrl(type)
  if (!url || failed) return null

  return (
    <span
      /*
        `-bottom-px -right-px`：压在**角上**（略微出格 1px），不是塞在框里。
        塞进去会盖掉文件夹右下角一块，出格一点看起来才像「贴上去的标记」。
      */
      className="absolute -bottom-px -right-px flex items-center justify-center rounded-full border border-line bg-white"
      style={{ width: BADGE_PX, height: BADGE_PX }}
    >
      <img
        src={url}
        alt=""
        aria-hidden
        onError={() => setFailed(true)}
        style={{ width: ICON_PX, height: ICON_PX }}
        className="object-contain"
      />
    </span>
  )
}
