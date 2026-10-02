import type { FastifyPluginAsync } from 'fastify'
import type { ZodType } from 'zod'
import {
  createProjectSchema,
  createTagSchema,
  idParamSchema,
  listProjectsQuerySchema,
  setProjectTagsSchema,
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
      return { projects: listProjects(db, q) }
    })

    fastify.get('/projects/:id', async (req) => {
      const { id } = req.params as { id: string }
      const project = getProject(db, idParamSchema.parse(id))
      if (!project) throw notFound('项目')
      return { project }
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

async function createFromInput(
  db: DB,
  input: {
    name: string
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
    category: input.category,
    record: input.record,
    ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
  })
  const project = getProject(db, id)
  if (!project) throw new HttpError(500, 'internal_error', '项目写入后读不回来')
  return project
}
