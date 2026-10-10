import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.ts'
import { openDatabase, type DB } from '../src/db/index.ts'
import { README_FULL_MAX_BYTES, README_MAX_BYTES } from '@git-nest/core'

/**
 * README 接口。
 *
 * 最重要的一条是**「没有 README」与「读不出来」必须分开**：前者是 200 + file: null
 * （很多仓库本来就没有说明，那不是错误），后者才是 400。把两者混成同一个结果，
 * 界面上就会在项目已经不在了的时候说「它没有 README」。
 */

let db: DB
let app: ReturnType<typeof buildApp>['app']
let root: string
let plainDir: string
let withReadme: number
let noReadme: number
let plainDirId: number
let missingId: number

const GIT = [
  '-c',
  'user.email=dev@git-nest.test',
  '-c',
  'user.name=test',
  '-c',
  'commit.gpgsign=false',
  '-c',
  'init.defaultBranch=main',
]
const git = (cwd: string, ...args: string[]) => execFileSync('git', [...GIT, ...args], { cwd })

/** payload 必须带 content-type，否则 fastify 解不出 body */
const json = { 'content-type': 'application/json' }

function mkRepo(name: string, readme: string | null): string {
  const dir = path.join(root, name)
  fs.mkdirSync(dir, { recursive: true })
  git(dir, 'init', '-b', 'main')
  // 「没有 README」那个仓库是空的，`git commit` 会因 nothing to commit 而失败。
  // 而判「是不是仓库」只需要 `.git` 存在（`repoFacts` 走的是 isomorphic-git，0 条进程），
  // 所以这里不提交——它本来就该是个空仓库。
  if (readme !== null) {
    fs.writeFileSync(path.join(dir, 'README.md'), readme, 'utf8')
    git(dir, 'add', '-A')
    git(dir, 'commit', '-m', '初始提交')
  }
  return dir
}

beforeAll(async () => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'git-nest-readme-')))
  db = openDatabase(':memory:')
  app = buildApp({ db, logger: false }).app

  /*
    `app.inject` 返回的是 Promise（`git-api.test.ts` 里的 `addProject` 也是 await 的）。
    建项目的返回体是 `{ project: { id } }`，不是 `{ id }`——写错的话拿到 undefined，
    而后面所有请求都会打在一个不存在的 id 上，症状是「全都 404」，看不出是哪错了。
  */
  const add = async (name: string, dir: string): Promise<number> => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: json,
      payload: { name, path: dir, remoteUrl: null, isOwn: false, category: '', record: '' },
    })
    expect(res.statusCode).toBe(201)
    return res.json().project.id as number
  }

  withReadme = await add('有说明的', mkRepo('with-readme', '# 标题\n\n正文。\n'))
  noReadme = await add('没说明的', mkRepo('no-readme', null))

  plainDir = path.join(root, 'not-a-repo')
  fs.mkdirSync(plainDir, { recursive: true })
  plainDirId = await add('不是仓库', plainDir)

  /*
    「目录不在了」这条要造的是「DB 里还留着那条记录，而目录没了」——
    而 `POST /api/projects` 要求路径已存在，所以只能先建后删。
    （直接往库里插一行也行，那样测的就不是「项目还能打开但读不到」这条路径了。）
  */
  const goneDir = path.join(root, '待会儿删掉')
  fs.mkdirSync(goneDir, { recursive: true })
  missingId = await add('指向不存在的目录', goneDir)
  fs.rmSync(goneDir, { recursive: true, force: true })
})

afterAll(() => {
  db.close()
  fs.rmSync(root, { recursive: true, force: true })
})

/** GET 并把响应体解出来；失败时连状态码与正文一起抛，省得只看 undefined */
async function readme(id: number, query = ''): Promise<{ status: number; body: any }> {
  const res = await app.inject({ method: 'GET', url: `/api/projects/${id}/readme${query}` })
  let body: unknown = null
  try {
    body = res.json()
  } catch {
    body = res.body
  }
  return { status: res.statusCode, body }
}

describe('GET /api/projects/:id/readme', () => {
  it('有 README → 200，内容原样', async () => {
    const { status, body } = await readme(withReadme)
    expect(status).toBe(200)
    expect(body).toMatchObject({
      file: 'README.md',
      content: '# 标题\n\n正文。\n',
      truncated: false,
    })
  })

  it('**没有 README → 也是 200**，file/content 为 null', async () => {
    const { status, body } = await readme(noReadme)
    expect(status).toBe(200)
    expect(body).toEqual({ file: null, content: null, truncated: false, bytes: 0 })
  })

  it('不是 git 仓库 → 400，说清是「不是仓库」', async () => {
    const { status, body } = await readme(plainDirId)
    expect(status).toBe(400)
    expect(body.message).toMatch(/不是 git 仓库/)
  })

  it('路径指向的目录已经不在了 → 400，说清是「目录不在了」', async () => {
    const { status, body } = await readme(missingId)
    expect(status).toBe(400)
    expect(body.message).toMatch(/目录不在了/)
  })

  it('默认给前 README_MAX_BYTES，truncated 如实说，**bytes 是真实大小**', async () => {
    // fixture 必须**大于完整上限**（README_FULL_MAX_BYTES），否则 `?full=1` 会把整个文件
    // 给出来、truncated 为假，下面那条「仍然截断」的断言就成了一句空话。
    const size = README_FULL_MAX_BYTES + 1000
    const big = path.join(root, 'big-readme')
    fs.mkdirSync(big, { recursive: true })
    git(big, 'init', '-b', 'main')
    fs.writeFileSync(path.join(big, 'README.md'), 'x'.repeat(size), 'utf8')
    git(big, 'add', '-A')
    git(big, 'commit', '-m', '大 README')
    const created = await app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: json,
      payload: { name: '大说明', path: big, remoteUrl: null, isOwn: false, category: '', record: '' },
    })
    const id = created.json().project.id as number

    const first = (await readme(id)).body
    expect(first.truncated).toBe(true)
    expect(first.bytes).toBe(size) // 真实大小
    expect(first.content).toHaveLength(README_MAX_BYTES)

    // ?full=1 给的更多，而这个仓库仍然大于完整上限，所以还是截断——
    // **bytes 依然报真实大小**，界面才知道该不该给「加载完整」按钮
    const whole = (await readme(id, '?full=1')).body
    expect(whole.content.length).toBeGreaterThan(first.content.length)
    expect(whole.content).toHaveLength(README_FULL_MAX_BYTES)
    expect(whole.truncated).toBe(true)
    expect(whole.bytes).toBe(size)
  })

  it('小于完整上限的文件，?full=1 给的是全部、truncated 为假', async () => {
    const a = (await readme(withReadme)).body
    const b = (await readme(withReadme, '?full=1')).body
    expect(b.truncated).toBe(false)
    expect(b.content).toBe(a.content)
  })

  it('?full=1 拿到的是同一个文件、bytes 一致', async () => {
    const a = (await readme(withReadme)).body
    const b = (await readme(withReadme, '?full=1')).body
    expect(b.file).toBe(a.file)
    expect(b.bytes).toBe(a.bytes)
    expect(b.truncated).toBe(false)
  })

  it('项目 id 不存在 → 404', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/projects/999999/readme' })
    expect(res.statusCode).toBe(404)
  })
})