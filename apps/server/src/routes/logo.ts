import fs from 'node:fs'
import path from 'node:path'
import type { FastifyPluginAsync } from 'fastify'
import { idParamSchema } from '@git-nest/core'
import { isImagePath, LOGO_MAX_BYTES, readmeStamp } from '@git-nest/core/git'
import type { DB } from '../db/index.ts'
import { notFound } from '../lib/errors.ts'
import { scanProjectLogo } from '../lib/logo-scan.ts'
import { saveLogo } from '../repos/logos.ts'

/**
 * 项目的 logo：**现读现发仓库里的那个文件**。
 *
 * 三条边界，缺一条这个功能就不该存在：
 *
 * 1. **只发仓库内的文件。** 路径来自 README 的内容（不受信任的输入），所以这里
 *    是它唯一一次真的碰磁盘的地方——先按字面拼、再取真实路径，两次都必须在
 *    仓库根目录内。第二次挡的是符号链接：字面在仓库里、真身在 `C:\Users\…`。
 * 2. **只发图片。** 扩展名白名单（存下来的路径也不信，这里再判一次）。
 * 3. **不发远程图。** README 里的远程 URL 根本不参与识别（那是另一个量级的事：
 *    它会把 IP 和仓库名递给第三方，而 README 那条既有前提就是「打开一个仓库
 *    不向外部发任何请求」）。
 *
 * 没有 logo 是 **404**，不是错误——大多数仓库没有 logo，界面上什么都不显示。
 */

const CONTENT_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
}

export const logoRoutes = (db: DB): FastifyPluginAsync => async (fastify) => {
  fastify.get('/projects/:id/logo', async (req, reply) => {
    const { id } = req.params as { id: string }
    const projectId = idParamSchema.parse(id)
    const project = db
      .prepare('SELECT id, name, path FROM projects WHERE id = ?')
      .get(projectId) as { id: number; name: string; path: string } | undefined
    if (!project) throw notFound('项目')

    const rel = await scanProjectLogo(db, project)
    if (!rel) return reply.code(404).send({ logo: null })

    /** 结论作废：文件没了 / 不可信。不然每次打开清单都要再撞一次同一根钉子。 */
    const forget = async () => {
      const stamp = await readmeStamp(project.path).catch(() => 'none')
      saveLogo(db, project.id, null, stamp)
      return reply.code(404).send({ logo: null })
    }

    const abs = await resolveInsideRepo(project.path, rel)
    if (!abs) return forget()

    const stat = await fs.promises.stat(abs).catch(() => null)
    if (!stat?.isFile() || stat.size === 0 || stat.size > LOGO_MAX_BYTES) return forget()

    /*
      校验用**文件自己的**大小 + 修改时间，而不是 README 的指纹：换了 logo 图
      （README 一个字没动）也该让缓存失效。一次 stat 就够，很便宜。
    */
    const etag = `"${stat.size}:${Math.round(stat.mtimeMs)}"`
    if (req.headers['if-none-match'] === etag) return reply.code(304).send()

    const data = await fs.promises.readFile(abs).catch(() => null)
    if (!data) return forget()

    return reply
      .header('Content-Type', CONTENT_TYPES[path.extname(abs).toLowerCase()] ?? 'application/octet-stream')
      // 不信扩展名之外的任何东西：类型就是上面那个，不许嗅探
      .header('X-Content-Type-Options', 'nosniff')
      /*
        SVG 也是图片（两个仓库的 logo 就是 svg），在 `<img>` 里不执行脚本。
        但有人会**直接在地址栏打开这个 URL**——那它就是一份顶层文档，脚本会跑在
        这个应用的源上。于是给所有响应都加一条锁死的 CSP + sandbox：那样打开
        也只是一个孤立文档，读不到任何东西。
      */
      .header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox")
      .header('Cache-Control', 'private, max-age=0, must-revalidate')
      .header('ETag', etag)
      .send(data)
  })
}

/**
 * 把「相对仓库根的路径」变成一个确实还在这仓库里的绝对路径。
 *
 * 两道关：字面拼出来必须还在根目录下（挡 `../../`），**真实路径也必须还在
 * 根目录下**（挡符号链接）。只做后者不够——`..` 有可能把路径拼到根之外再绕回来；
 * 只做前者也不够——一个叫 `logo.png` 的软链接可以指向任何地方。
 */
async function resolveInsideRepo(root: string, rel: string): Promise<string | null> {
  if (!isImagePath(rel)) return null
  const rootReal = await fs.promises.realpath(root).catch(() => null)
  if (!rootReal) return null

  const abs = path.resolve(rootReal, rel)
  if (!isInside(rootReal, abs)) return null

  const real = await fs.promises.realpath(abs).catch(() => null)
  if (!real || !isInside(rootReal, real)) return null
  return real
}

function isInside(root: string, target: string): boolean {
  const rel = path.relative(root, target)
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)
}
