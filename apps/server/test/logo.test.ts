import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.ts'
import { openDatabase, type DB } from '../src/db/index.ts'

/**
 * 项目的 logo 接口。
 *
 * 这个接口是整个功能里**唯一真的按仓库内容去碰磁盘的地方**，所以测试的重点不在
 * 「能不能发出图」，而在三条边界：只发图片、只发仓库内的文件、没有就是 404。
 * 另外钉住「README 变了才重认」——那是它不需要任何定时器的原因。
 */

let db: DB
let app: ReturnType<typeof buildApp>['app']
let root: string

const json = { 'content-type': 'application/json' }
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00])

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'git-nest-logo-'))
  db = openDatabase(':memory:')
  app = buildApp({ db, logger: false }).app
})

afterAll(() => {
  db.close()
  fs.rmSync(root, { recursive: true, force: true })
})

/** 造一个仓库形状的目录，并把它加进清单。 */
async function makeProject(name: string, files: Record<string, string | Buffer> = {}) {
  const dir = path.join(root, name)
  fs.mkdirSync(dir, { recursive: true })
  for (const [file, data] of Object.entries(files)) {
    const abs = path.join(dir, file)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, data)
  }
  const res = await app.inject({
    method: 'POST',
    url: '/api/projects',
    headers: json,
    payload: { name, path: dir },
  })
  expect(res.statusCode).toBe(201)
  return { id: res.json().project.id as number, dir }
}

const logo = (id: number) => app.inject({ method: 'GET', url: `/api/projects/${id}/logo` })

describe('GET /api/projects/:id/logo', () => {
  it('认出来了就发字节：正确的类型 + 禁止嗅探', async () => {
    const { id } = await makeProject('with-logo', {
      'README.md': '# with-logo\n\n![logo](docs/logo.png)\n',
      'docs/logo.png': png,
    })
    const res = await logo(id)
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('image/png')
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.rawPayload.equals(png)).toBe(true)
  })

  it('没有 logo 是 404 —— 大多数仓库都是这样，那不是错误', async () => {
    const { id } = await makeProject('no-logo', {
      'README.md': '# no-logo\n\n![界面](imgs/screenshot.png)\n',
      'imgs/screenshot.png': png,
    })
    expect((await logo(id)).statusCode).toBe(404)
  })

  it('README 里只有远程图（徽章）时也是 404：远程那条路根本不存在', async () => {
    const { id } = await makeProject('remote-only', {
      'README.md': '# remote-only\n\n![CI](https://img.shields.io/badge/ci-pass-green)\n',
    })
    expect((await logo(id)).statusCode).toBe(404)
  })

  it('符号链接指到仓库外：不发，而且把结论作废', async () => {
    const outside = path.join(root, 'outside-secret.png')
    fs.writeFileSync(outside, png)
    const { id, dir } = await makeProject('symlink', {
      'README.md': '# symlink\n\n![logo](logo.png)\n',
    })
    try {
      fs.symlinkSync(outside, path.join(dir, 'logo.png'))
    } catch {
      // Windows 上没开开发者模式就建不了软链接：这条跳过（不是产品行为的问题）
      return
    }

    expect((await logo(id)).statusCode).toBe(404)
    // 作废之后不该每次打开清单都去撞同一根钉子
    expect(db.prepare('SELECT path FROM project_logos WHERE project_id = ?').get(id)).toEqual({
      path: null,
    })
  })

  it('README 变了才重认：改了它指向的文件，图就换了', async () => {
    const other = Buffer.concat([png, Buffer.from([1, 2, 3])])
    const { id, dir } = await makeProject('changes', {
      'README.md': '# changes\n\n![logo](assets/a-logo.png)\n',
      'assets/a-logo.png': png,
      'assets/b-logo.png': other,
    })
    expect((await logo(id)).rawPayload.equals(png)).toBe(true)

    // 内容与大小都变（同大小的改写可能落进同一毫秒，指纹就看不出来了）
    fs.writeFileSync(
      path.join(dir, 'README.md'),
      '# changes\n\n<!-- 换了张图 -->\n\n![logo](assets/b-logo.png)\n',
    )
    expect((await logo(id)).rawPayload.equals(other)).toBe(true)
  })

  it('列表带上 hasLogo：前端才不用拿一堆 404 去试', async () => {
    const { id: withLogo } = await makeProject('list-with-logo', {
      'README.md': '# list-with-logo\n\n![logo](icon.png)\n',
      'icon.png': png,
    })
    const { id: without } = await makeProject('list-without-logo', {
      'README.md': '# list-without-logo\n\n没图。\n',
    })

    const res = await app.inject({ method: 'GET', url: '/api/projects' })
    const byId = new Map(
      (res.json().projects as { id: number; hasLogo: boolean }[]).map((p) => [p.id, p.hasLogo]),
    )
    expect(byId.get(withLogo)).toBe(true)
    expect(byId.get(without)).toBe(false)
  })
})
