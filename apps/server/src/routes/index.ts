import type { FastifyPluginAsync } from 'fastify'
import type { ZodType } from 'zod'
import { detectProjectType } from '@git-nest/core/git'
import {
  createCategorySchema,
  createProjectSchema,
  createTagSchema,
  idParamSchema,
  listProjectsQuerySchema,
  setProjectTagsSchema,
  updateCategorySchema,
  updateProjectSchema,
  type CreateTagInput,
  type ProjectDetail,
} from '@git-nest/core'
import type { DB } from '../db/index.ts'
import { HttpError, badRequest, conflict, fromZodError, notFound } from '../lib/errors.ts'
import { dirExists, toAbsolutePath } from '../lib/paths.ts'
import { getRemoteUrl, clearStatusCache } from '../lib/git.ts'
import {
  deleteProject,
  getProject,
  insertProject,
  listProjects,
  pathExists,
  updateProject,
} from '../repos/projects.ts'
import { createTag, listTags, setProjectTags, tagUsageCount, deleteTag } from '../repos/tags.ts'
import {
  categoryByKey,
  createCategory,
  deleteCategory,
  isAssignableCategory,
  listCategories,
  updateCategory,
} from '../repos/categories.ts'
import { scanLogos, scanProjectLogo } from '../lib/logo-scan.ts'

type InferOutput<S> = S extends ZodType<infer O, unknown> ? O : never

/** 所有请求体 / 查询参数的唯一入口：校验失败 → 422 + 逐字段说明。 */
export function parse<S extends ZodType>(schema: S, input: unknown): InferOutput<S> {
  const result = schema.safeParse(input)
  if (!result.success) throw fromZodError(result.error)
  return result.data as InferOutput<S>
}

export const projectRoutes = (db: DB): FastifyPluginAsync => {
  const app: FastifyPluginAsync = async (fastify) => {
    fastify.get('/projects', async (req) => {
      const q = parse(listProjectsQuerySchema, req.query ?? {})
      const projects = listProjects(db, q)
      /*
        顺手把 logo 结论算好（只算 README 指纹变了的那些，见 `lib/logo-scan.ts`）。
        放在列表这一趟里，而不是让每一行自己去请求：前端要靠一个布尔决定
        「这一行到底要不要显示图」，而那个布尔只有这里能给。
      */
      const logos = await scanLogos(db, projects)
      const types = await Promise.all(projects.map((p) => detectProjectType(p.path)))
      return {
        projects: projects.map((p, index) => ({
          ...p,
          hasLogo: logos.has(p.id),
          projectType: types[index] ?? null,
        })),
        // 这一轮还没有分页，total 就等于全部命中数；下一轮加 page/perPage 时
        // 只要把它换成真实的 COUNT，前后端都不用再动别的地方。
        total: projects.length,
      }
    })

    fastify.get('/projects/:id', async (req) => {
      const { id } = req.params as { id: string }
      const project = getProject(db, idParamSchema.parse(id))
      if (!project) throw notFound('项目')
      return {
        project: {
          ...project,
          hasLogo: (await scanProjectLogo(db, project)) !== null,
          projectType: await detectProjectType(project.path),
        },
      }
    })

    fastify.post('/projects', async (req, reply) => {
      const input = parse(createProjectSchema, req.body)
      const abs = toAbsolutePath(input.path)

      if (!dirExists(abs)) {
        throw badRequest(`目录不存在：${abs}`)
      }
      if (pathExists(db, abs)) {
        throw conflict('这个路径已经在清单里了')
      }
      /*
        分类的存在性在这里判，不在 schema 里：schema 是浏览器安全的那一份、拿不到库，
        而分类现在是**用户可以自己加**的表里的一行。空串（未分类）永远合法。
      */
      if (!isAssignableCategory(db, input.category)) {
        throw badRequest(`没有这个分类：${input.category}`)
      }

      const project = await createFromInput(db, input, abs)
      return reply.code(201).send({ project })
    })

    fastify.patch('/projects/:id', async (req) => {
      const { id } = req.params as { id: string }
      const projectId = idParamSchema.parse(id)
      const patch = parse(updateProjectSchema, req.body)

      if (!getProject(db, projectId)) throw notFound('项目')

      // 改 path = 把这个项目重新指到另一个目录，先确认那个目录真的在
      if (patch.path !== undefined) {
        const abs = toAbsolutePath(patch.path)
        if (!dirExists(abs)) throw badRequest(`目录不存在：${abs}`)
        if (pathExists(db, abs, projectId)) throw conflict('这个路径已经在清单里了')
        patch.path = abs
      }

      if (patch.category !== undefined && !isAssignableCategory(db, patch.category)) {
        throw badRequest(`没有这个分类：${patch.category}`)
      }

      if (!updateProject(db, projectId, patch)) throw notFound('项目')
      clearStatusCache()
      return { project: getProject(db, projectId) }
    })

    /** 只移除管理记录，绝不动磁盘上的仓库。 */
    fastify.delete('/projects/:id', async (req) => {
      const { id } = req.params as { id: string }
      const projectId = idParamSchema.parse(id)
      if (!deleteProject(db, projectId)) throw notFound('项目')
      clearStatusCache()
      return { removed: projectId }
    })

    fastify.put('/projects/:id/tags', async (req) => {
      const { id } = req.params as { id: string }
      const projectId = idParamSchema.parse(id)
      const { tagNames } = parse(setProjectTagsSchema, req.body)
      if (!getProject(db, projectId)) throw notFound('项目')
      setProjectTags(db, projectId, tagNames)
      return { project: getProject(db, projectId) }
    })
  }
  return app
}

export const tagRoutes = (db: DB): FastifyPluginAsync => async (fastify) => {
  fastify.get('/tags', async () => {
    const usage = tagUsageCount(db)
    return {
      tags: listTags(db).map((t) => ({ ...t, projectCount: usage.get(t.name) ?? 0 })),
    }
  })

  fastify.post('/tags', async (req, reply) => {
    const input: CreateTagInput = parse(createTagSchema, req.body)
    if (listTags(db).some((t) => t.name === input.name.trim())) {
      throw conflict('同名标签已存在')
    }
    return reply.code(201).send({ tag: createTag(db, { name: input.name.trim(), color: input.color ?? null }) })
  })

  fastify.delete('/tags/:id', async (req) => {
    const { id } = req.params as { id: string }
    if (!deleteTag(db, idParamSchema.parse(id))) throw notFound('标签')
    return { ok: true }
  })
}

/**
 * 分类。**风格跟着标签那一组走**（本仓库的资源接口都在这个文件里，
 * 只有按域拆出去的 `routes/updates.ts` 那几个例外）。
 *
 * 内置项（`builtin`）不能改名、不能删：它们的 key 写在每个项目的
 * `projects.category` 里，是软件自己的四个桶，不是用户的数据。
 */
export const categoryRoutes = (db: DB): FastifyPluginAsync => async (fastify) => {
  fastify.get('/categories', async () => ({ categories: listCategories(db) }))

  fastify.post('/categories', async (req, reply) => {
    const input = parse(createCategorySchema, req.body)
    return reply.code(201).send({ category: createCategory(db, input) })
  })

  fastify.patch('/categories/:key', async (req) => {
    const { key } = req.params as { key: string }
    const existing = categoryByKey(db, key)
    if (!existing) throw notFound('分类')
    if (existing.builtin) throw conflict('内置分类不能改名或改图标')

    const patch = parse(updateCategorySchema, req.body)
    if (!updateCategory(db, key, patch)) throw notFound('分类')
    return { category: categoryByKey(db, key) }
  })

  /**
   * 删掉一个分类。**引用它的项目退回未分类**（不是跟着一起删）。
   * 响应里的 `moved` 是给确认框用的：删之前界面得先知道会影响几个项目。
   */
  fastify.delete('/categories/:key', async (req) => {
    const { key } = req.params as { key: string }
    const existing = categoryByKey(db, key)
    if (!existing) throw notFound('分类')
    if (existing.builtin) throw conflict('内置分类不能删除')

    return deleteCategory(db, key)
  })
}

async function createFromInput(
  db: DB,
  input: {
    name: string
    isOwn: boolean
    category: string
    remoteUrl: string | null
    record: string
    sortOrder?: number
  },
  absPath: string,
): Promise<ProjectDetail> {
  // 没填远程地址就从 git 里读，免得清单上写着「纯本地仓库」而实际有 origin
  const remoteUrl = input.remoteUrl ?? (await getRemoteUrl(absPath))

  const id = insertProject(db, {
    name: input.name,
    path: absPath,
    remoteUrl,
    isOwn: input.isOwn,
    category: input.category,
    record: input.record,
    ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
  })
  const project = getProject(db, id)
  if (!project) throw new HttpError(500, 'internal_error', '项目写入后读不回来')
  return project
}
