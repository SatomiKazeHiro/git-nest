import { findLogo, readmeStamp } from '@git-nest/core/git'
import type { DB } from '../db/index.ts'
import { getLogo, logoPaths, saveLogo } from '../repos/logos.ts'

/**
 * 扫描识别：认出这些项目的 logo。
 *
 * **识别是「读仓库」，所以要缓存。** 缓存键是 README 的指纹（大小 + 修改时间）：
 * 一样就直接用上次的结论，不一样才真的重算一遍。
 *
 * 这样处理，比挂在「什么时候该重认」的钩子上准得多：改了 README 不一定会拉取，
 * 拉取了也不一定改 README。指纹只对「README 变了」这一件事负责——而那正是唯一的判据。
 * （logo 是按 README 的内容挑的；README 没变，挑出来的东西不可能变。）
 *
 * 失败一律当成「没有 logo」：目录不在了、README 读不出来、没有候选，都不该让
 * 列表页跟着报错。**这个功能的失败态就是「什么都不显示」**。
 */
export async function scanProjectLogo(
  db: DB,
  project: { id: number; name: string; path: string },
): Promise<string | null> {
  const stamp = await readmeStamp(project.path).catch(() => 'none')
  const cached = getLogo(db, project.id)
  if (cached && cached.stamp === stamp) return cached.path

  const picked = await findLogo(project.path, project.name).catch(() => null)
  const path = picked?.path ?? null
  saveLogo(db, project.id, path, stamp)
  return path
}

/**
 * 列表页用：把这一屏项目的 logo 结论都算好，返回「谁有」。
 *
 * 这是那个「后台扫描工具」的批量入口。它写库——**GET 里写一条缓存**，
 * 因为缓存键（README 指纹）就是「该不该重算」的全部判据，而这个判据只有
 * 摸过磁盘才知道。想避免这一点，就只能上定时器或者把重算挂到某个动作上，
 * 两者都比它更容易说错话。
 */
export async function scanLogos(
  db: DB,
  projects: readonly { id: number; name: string; path: string }[],
): Promise<Map<number, string>> {
  await Promise.all(projects.map((p) => scanProjectLogo(db, p)))
  return logoPaths(db)
}
