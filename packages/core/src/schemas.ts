import { z } from 'zod'
import { INITIAL_CATEGORIES } from './types.ts'

const trimmed = z.string().trim()

export const createProjectSchema = z.object({
  name: trimmed.min(1, '名称不能为空').max(120, '名称过长'),
  path: trimmed.min(1, '本地路径不能为空'),
  category: trimmed.max(60).default(''),
  remoteUrl: trimmed.max(500).nullish().transform((v) => v || null),
  sourceUrl: trimmed.max(500).nullish().transform((v) => v || null),
  summary: trimmed.max(2000).nullish().transform((v) => v || null),
  sortOrder: z.number().int().optional(),
})

export type CreateProjectInput = z.input<typeof createProjectSchema>

export const updateProjectSchema = z
  .object({
    name: trimmed.min(1, '名称不能为空').max(120).optional(),
    // 仓库被移动 / 改名后需要重新指路，所以允许改 path
    path: trimmed.min(1, '本地路径不能为空').max(400).optional(),
    category: trimmed.max(60).optional(),
    // .optional() 必须在 transform **外面**：transform 挂在外层时，zod 会对
    // 「根本没提交的键」也执行它，把 undefined 变成 null 并把键物化进输出，
    // 于是只改 name 的 PATCH 会连带把这三列写成 NULL（下面的 refine 也会失效）。
    remoteUrl: trimmed.max(500).nullish().transform((v) => v || null).optional(),
    sourceUrl: trimmed.max(500).nullish().transform((v) => v || null).optional(),
    summary: trimmed.max(2000).nullish().transform((v) => v || null).optional(),
    sortOrder: z.number().int().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: '没有要修改的字段' })

export type UpdateProjectInput = z.input<typeof updateProjectSchema>

export const listProjectsQuerySchema = z.object({
  category: trimmed.optional(),
  tag: trimmed.optional(),
  q: trimmed.optional(),
})

export const createTagSchema = z.object({
  name: trimmed.min(1, '标签名不能为空').max(40, '标签名过长'),
  color: trimmed
    .regex(/^#[0-9a-fA-F]{6}$/, '颜色需为 #rrggbb')
    .nullish()
    .transform((v) => v || null),
})

export type CreateTagInput = z.input<typeof createTagSchema>

export const setProjectTagsSchema = z.object({
  tagNames: z.array(trimmed.min(1)).max(20),
})

export const createNoteSchema = z.object({
  content: trimmed.min(1, '备注不能为空').max(10_000),
})

export const updateNoteSchema = z.object({
  content: trimmed.min(1, '备注不能为空').max(10_000),
})

export const idParamSchema = z.coerce.number().int().positive()

/** 分类的合法取值不做限制，只给前端做建议用。 */
export const categorySuggestions = INITIAL_CATEGORIES
