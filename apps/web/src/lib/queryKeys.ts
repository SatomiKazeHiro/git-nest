/**
 * 缓存身份的**唯一一张表**。写操作后该失效哪些前缀，看 `lib/invalidate.ts`。
 *
 * **为什么键不能各写在各个 feature 的 queries.ts 里。**
 * 缓存键是跨 feature 的**共享名字**，而这个名字以前有两个来源：
 *
 * - `['status']`：`features/projects/queries.ts` 与 `features/status/queries.ts`
 *   各写了一份根，两边必须一致才不会静默失效；
 * - `['settings']`：`features/settings/queries.ts`（两处）与
 *   `features/scan/ScanSection.tsx` 各写了一份字面量（后者当时还在设置里）。
 *
 * 同一个名字两处定义，改一处另一处不会报错，只会**默默地不再失效**。
 * 本仓库已经有过一次同类事故（`useInvalidate` 里把详情前缀写成
 * `queryKeys.project(0)`，于是任何写操作都失效不掉详情），那段教训现在钉在
 * `lib/invalidate.ts` 里。这里把根收成一份，是同一个问题的釜底抽薪。
 *
 * **为什么放在 `lib/` 而不是某个 feature 下**：它是**契约**，不归任何业务所有。
 * 于是依赖方向是单向的——所有 feature → `lib`，而 `lib` 谁也不依赖。
 * 这不是风格偏好：`lib` 一旦 import 任何 feature，整张依赖图就出现反向边，
 * 那正是这一轮要拆掉的东西。
 */
import type { Attention, ProjectSort, SortDir } from '@git-nest/core'

/**
 * 列表查询的参数。
 *
 * 它住在这里而不是 `features/projects/queries.ts`，因为**它就是键的身份**：
 * `queryKeys.projects(params)` 把整个对象放进键里。至于它怎么变成线路上那串
 * query string（空串、'0' 这些取值怎么发），是 `features/projects/queries.ts`
 * 里 `toQuery` 的事，两件事分开。
 *
 * `own` 是 '1'/'0'，与 category / tag **叠加**而非互斥（store 里是 null）。
 */
export interface ListParams {
  category?: string | null
  tag?: string | null
  q?: string
  /** 三态：'1' 只看自己的 / '0' 只看不是自己的 / 不传都要。store 里是 null。 */
  own?: '1' | '0' | null
  /** 行动分类筛选；与其它维度叠加。store 里是 null。 */
  attention?: Attention | null
  /** 排序；null = 服务端默认（分类分组 → 名称） */
  sort?: ProjectSort | null
  /** 排序方向；null/不传 = 该键的默认方向（见 `DEFAULT_SORT_DIR`） */
  dir?: SortDir | null
}

export const queryKeys = {
  projects: (params: ListParams) => ['projects', params] as const,
  project: (id: number) => ['project', id] as const,
  /** 所有项目详情的**前缀**：失效时用它，不要用 `project(0)`（见 `lib/invalidate.ts`） */
  projectAll: ['project'] as const,
  tags: ['tags'] as const,
  /**
   * 状态那一族的**根**。批量与单条都在它下面，失效一次就够。
   *
   * 它以前是 `queryKeys.status`，与 `features/status/queries.ts` 里的
   * `statusKeys` 是两个各自独立的声明——现在只剩这一份。
   */
  statusRoot: ['status'] as const,
  /**
   * 批量状态的 key。**排序去重之后再拼**：`[1,2]` 与 `[2,1]` 是同一批仓库，
   * 不该是两条缓存（同一屏数据缓存两份，翻页/勾选顺序一变就多跑一轮 git）。
   */
  statusBatch: (ids: number[]) => ['status', sortedIds(ids)] as const,
  /**
   * 单个项目的状态。**key 里不带「这次要不要绕缓存」**：
   * 那是一次请求的参数，不是数据身份；放进 key 会（a）每点一次「重读本地状态」
   * 多一条永不复用的缓存条目，（b）让 `fresh` 粘在后续所有自动重取上
   * ——手动动作污染自动读取。
   */
  statusOne: (id: number) => ['status', 'one', id] as const,
  settings: ['settings'] as const,
  /** README 全文。`full` 进 key，所以「加载完整文档」就是换一条查询 */
  readme: (id: number, full: boolean) => ['readme', id, full] as const,
}

function idList(ids: number[]): number[] {
  return [...new Set(ids)].sort((a, b) => a - b)
}

function sortedIds(ids: number[]): string {
  return idList(ids).join(',')
}

/**
 * 去重排序后的 id 列表。
 *
 * 批量状态**请求**自己也要用它（按 `MAX_STATUS_IDS` 分块），所以导出。
 * 与 `statusBatch` 用同一个归一：键里的顺序和请求里的顺序必须是同一套，
 * 否则「键相同但请求不同」就会互相覆盖。
 */
export function normalizedIds(ids: number[]): number[] {
  return idList(ids)
}
