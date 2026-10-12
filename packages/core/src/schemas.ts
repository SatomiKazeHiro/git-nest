import { z } from 'zod'
import { isCategoryIconKey } from './category-icons.ts'
import { ATTENTION_VALUES, type Attention } from './types.ts'

const trimmed = z.string().trim()

/**
 * 标签名的**唯一**约束来源。
 *
 * 标签有两个写入口：`POST /api/tags`（建标签）和 `PUT /api/projects/:id/tags`
 * （整体替换项目的标签集合，不存在的名字按需创建）。第一版只在前者写了
 * `.max(40)`，后者只限条数——于是同一个字段两条路的上限不一样，
 * 从项目那条路能塞进任意长的标签名（实测 200 字入库）。
 * 约束写在一处、两处都引它，才不会又飘开。
 */
export const tagNameSchema = trimmed.min(1, '标签名不能为空').max(40, '标签名过长')

export const createProjectSchema = z.object({
  name: trimmed.min(1, '名称不能为空').max(120, '名称过长'),
  // 上限与 updateProjectSchema.path / scanSchema.dir 一致：同一个字段三条路一个口径
  path: trimmed.min(1, '本地路径不能为空').max(400, '路径过长'),
  // 「这是我自己写的项目」：批量检查默认跳过。默认值 false（别人的项目才是主体）
  isOwn: z.boolean().default(false),
  /*
    分类。**这里只校验形状，不校验存在性**——分类从编译期枚举变成了
    `categories` 表里的一行（用户可以自己加），而 schema 是浏览器安全的那一份，
    拿不到库。存在性由服务端在写入口判（`isAssignableCategory`，见 routes/index.ts）。
    空串（未分类）继续合法：扫描导入的一律留空，那是最常见的取值。
  */
  category: trimmed.max(60).default(''),
  remoteUrl: trimmed.max(500).nullish().transform((v) => v || null),
  // 「记录」是详情页那个文本框，添加项目时还写不到，所以默认空串
  record: trimmed.max(20_000).default(''),
  sortOrder: z.number().int().optional(),
})

export const updateProjectSchema = z
  .object({
    name: trimmed.min(1, '名称不能为空').max(120).optional(),
    // 仓库被移动 / 改名后需要重新指路，所以允许改 path
    path: trimmed.min(1, '本地路径不能为空').max(400).optional(),
    category: trimmed.max(60).optional(),
    isOwn: z.boolean().optional(),
    // .optional() 必须在 transform **外面**：transform 挂在外层时，zod 会对
    // 「根本没提交的键」也执行它，把 undefined 变成 null 并把键物化进输出，
    // 于是只改 name 的 PATCH 会连带把 remoteUrl 写成 NULL（下面的 refine 也会失效）。
    remoteUrl: trimmed.max(500).nullish().transform((v) => v || null).optional(),
    // 记录是 NOT NULL 的列：清空 = 提交空串，不用 null 表示空。
    record: trimmed.max(20_000).optional(),
    sortOrder: z.number().int().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: '没有要修改的字段' })

export const listProjectsQuerySchema = z.object({
  category: trimmed.optional(),
  tag: trimmed.optional(),
  q: trimmed.optional(),
  /**
   * 只看我自己的项目。查询参数是字符串，所以只认 `1` / `0`。
   *
   * **它和 category / tag 是叠加的，不是互斥的**：「我的 tools」是一个
   * 完全合理的查询，所以这里不提供「取消其它筛选」的三态。
   */
  own: z.enum(['1', '0']).optional(),
  /**
   * 逗号分隔的行动分类筛选（多个之间是「或」）。
   *
   * 顺手把不认识的分类名丢掉而不是整个报错：前端的可选项来自同一个枚举，
   * 而老链接 / 手敲的 URL 上可能有过时的值——那不该让整个列表打不开。
   */
  attention: trimmed
    .optional()
    .transform((v) => {
      if (!v) return undefined
      const picked = v.split(',').filter((x) => (ATTENTION_VALUES as readonly string[]).includes(x))
      return picked.length > 0 ? (picked as Attention[]) : undefined
    }),
  /** 列表排序。默认 name。 */
  sort: z.enum(['name', 'attention', 'checked', 'behind']).optional(),
  /**
   * 排序方向。**不传时按 `DEFAULT_SORT_DIR` 里那个键的默认方向**——所以老的
   * 链接 / 老调用不会因为多了这个参数就换了顺序。
   */
  dir: z.enum(['asc', 'desc']).optional(),
})

export const createTagSchema = z.object({
  name: tagNameSchema,
  color: trimmed
    .regex(/^#[0-9a-fA-F]{6}$/, '颜色需为 #rrggbb')
    .nullish()
    .transform((v) => v || null),
})

export type CreateTagInput = z.input<typeof createTagSchema>

export const setProjectTagsSchema = z.object({
  // 每个名字都过 tagNameSchema（长度上限在内）——这条路上是「按需创建」，
  // 不校验就等于绕过了 POST /api/tags 的全部约束
  tagNames: z.array(tagNameSchema).max(20),
})

export const idParamSchema = z.coerce.number().int().positive()

/**
 * 分类的**显示名与图标**。key 不在这里——它由服务端生成（`repos/categories.ts`），
 * 调用方的职责只是给一个名字与可选的图标。
 *
 * 图标必须是 `CATEGORY_ICON_KEYS` 里的一个，或者清空（它是可选的）。校验放在
 * schema 里而不是路由里：约束只有一处，两端口径一致；而白名单之外的名字会让 web 端
 * 找不到组件——那正是「设置里选得到、左栏却画不出来」这类静默不一致的来源。
 */
const categoryIconSchema = trimmed
  .max(40)
  .nullish()
  .transform((v) => v || null)
  .refine((v) => v === null || isCategoryIconKey(v), { message: '没有这个图标' })

export const createCategorySchema = z.object({
  label: trimmed.min(1, '分类名不能为空').max(30, '分类名过长'),
  icon: categoryIconSchema,
})

export const updateCategorySchema = z
  .object({
    label: trimmed.min(1, '分类名不能为空').max(30, '分类名过长').optional(),
    // `.optional()` 必须在 transform **外面**（理由见 `updateProjectSchema.remoteUrl`
    // 那段注释：transform 挂在外层时，zod 会对「根本没提交的键」也执行它）
    icon: categoryIconSchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: '没有要修改的字段' })
