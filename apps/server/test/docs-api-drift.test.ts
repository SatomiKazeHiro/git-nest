import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 文档与实现的**接口事实**必须对得上。
 *
 * 起因：审计发现 README 的 API 段写着 `PUT /api/notes/:id`、`DELETE /api/tags`
 * 这类**根本不存在的端点**（实际是 PATCH / 需要 :id），而详情页在用的
 * `GET /api/projects/:id` 又完全没写。照文档写客户端会 404。
 *
 * 光把文档改对只是一次性的；这个测试让漂移下次直接被抓住：
 * 它从源码里抽出**实际注册的路由**，再检查 README / 设计文档里列出的每个端点
 * 是否真的存在。反向（实现了但没写）只警告不失败，因为文档不必穷举。
 */

const root = path.resolve(import.meta.dirname, '../../..')

/** 从 routes/*.ts + app.ts 里抽出真实注册的 (方法, 路径) */
function registeredRoutes(): Set<string> {
  const files = [
    ...fs
      .readdirSync(path.join(root, 'apps/server/src/routes'))
      .map((f) => path.join(root, 'apps/server/src/routes', f)),
    path.join(root, 'apps/server/src/app.ts'),
  ]

  const routes = new Set<string>()
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8')
    // fastify.get('/x') / app.get('/api/x') / fastify.put(...)
    for (const m of src.matchAll(/\b(?:fastify|app)\.(get|post|put|patch|delete)\(\s*'([^']+)'/g)) {
      const method = m[1]!.toUpperCase()
      let route = m[2]!
      // 插件注册时带 prefix: '/api'
      if (!route.startsWith('/api')) route = `/api${route}`
      routes.add(`${method} ${normalize(route)}`)
    }
  }
  return routes
}

/** 把 `:id` 之类参数归一，便于比对 */
function normalize(route: string): string {
  return route.replace(/\/$/, '')
}

/**
 * 从一段文本里抽出 `METHOD /api/...` 形式的端点声明。
 *
 * **按行匹配**：方法名和路径必须在同一行。否则「上一行以 PUT 结尾、下一行是
 * 别的路径」会被拼成一个不存在的端点（踩过）。
 */
function endpointsIn(text: string): string[] {
  const found: string[] = []
  const pattern = /^[\s>*-]*((?:GET|POST|PUT|PATCH|DELETE)(?:\/(?:GET|POST|PUT|PATCH|DELETE))*)\s+(\/api[^\s`)、，,)]*)/
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(pattern)
    if (!m) continue
    const methods = m[1]!.split('/')
    const route = normalize(m[2]!.split('?')[0]!) // 去掉查询串
    for (const method of methods) found.push(`${method} ${route}`)
  }
  return found
}

const routes = registeredRoutes()
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8')
const design = fs.readFileSync(
  path.join(root, 'docs/superpowers/specs/2026-06-20-git-nest-design.md'),
  'utf8',
)

describe('路由抽取本身要靠谱', () => {
  it('能抽到一批真实路由', () => {
    expect(routes.size).toBeGreaterThan(15)
    expect(routes.has('GET /api/projects')).toBe(true)
    expect(routes.has('PATCH /api/projects/:id')).toBe(true)
  })
})

describe('README 里列出的端点必须真的存在', () => {
  const listed = endpointsIn(readme)
  it('README 至少列了若干端点（抽取没坏）', () => {
    expect(listed.length).toBeGreaterThan(8)
  })

  it.each(listed)('%s 存在', (endpoint) => {
    expect(routes.has(endpoint), `README 写了 ${endpoint}，但代码里没有`).toBe(true)
  })
})

describe('设计文档里列出的端点必须真的存在', () => {
  const listed = endpointsIn(design).filter((e) => e.includes('/api/'))
  it.each(listed)('%s 存在', (endpoint) => {
    // 设计文档第 13 节专门记录了「实现与文档的差异」，所以这里只检查
    // 第 6 节那张 API 表里没有被差异说明覆盖的部分。
    const knownDifference = design.includes('POST /api/projects/update')
    expect(
      routes.has(endpoint) || (knownDifference && endpoint.includes('/projects/update')),
      `设计文档写了 ${endpoint}，但代码里没有`,
    ).toBe(true)
  })
})

describe('文档不能承诺不存在的环境变量', () => {
  it('README 与 STATUS 提到的 GIT_NEST_* 都要在代码里真的被读', () => {
    const sources = [
      'apps/server/src/config.ts',
      'apps/server/src/index.ts',
      'apps/web/vite.config.ts',
    ]
      .map((f) => fs.readFileSync(path.join(root, f), 'utf8'))
      .join('\n')

    /** 否定式提及（「没有 X 这个环境变量」）不算承诺，允许出现 */
    const isNegatedMention = (line: string) => /没有|不是|不存在|已被|旧键|废弃/.test(line)

    const mentioned = new Set<string>()
    for (const doc of [readme, fs.readFileSync(path.join(root, 'docs/STATUS.md'), 'utf8')]) {
      for (const line of doc.split(/\r?\n/)) {
        if (isNegatedMention(line)) continue
        for (const m of line.matchAll(/GIT_NEST_[A-Z_]+/g)) mentioned.add(m[0])
      }
    }

    expect(mentioned.size).toBeGreaterThan(0)
    for (const name of mentioned) {
      expect(
        sources.includes(name),
        `文档提到 ${name}，但没有任何代码读它——照文档设置会白折腾`,
      ).toBe(true)
    }
  })
})
