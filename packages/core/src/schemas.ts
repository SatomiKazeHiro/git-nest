import { z } from 'zod'
import { INITIAL_CATEGORIES } from './types.ts'

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
  category: trimmed.max(60).default(''),
  remoteUrl: trimmed.max(500).nullish().transform((v) => v || null),
  // 「记录」是详情页那个文本框，添加项目时还写不到，所以默认空串
  record: trimmed.max(20_000).default(''),
  sortOrder: z.number().int().optional(),
})

export type CreateProjectInput = z.input<typeof createProjectSchema>

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

export type UpdateProjectInput = z.input<typeof updateProjectSchema>

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

/** 分类的合法取值不做限制，只给前端做建议用。 */
export const categorySuggestions = INITIAL_CATEGORIES
