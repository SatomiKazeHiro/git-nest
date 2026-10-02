import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.ts'
import { openDatabase, type DB } from '../src/db/index.ts'

let db: DB
let app: ReturnType<typeof buildApp>['app']
let root: string
let projectId: number

const json = { 'content-type': 'application/json' }
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

beforeAll(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'git-nest-api-')))
  const repo = path.join(root, 'repo')
  fs.mkdirSync(repo, { recursive: true })
  git(repo, 'init', '-b', 'main')
  fs.writeFileSync(path.join(repo, 'README.md'), '# api 测试仓库\n', 'utf8')
  git(repo, 'add', '-A')
  git(repo, 'commit', '-m', '初始提交')

  db = openDatabase(':memory:')
  app = buildApp({ db, logger: false }).app
})

afterAll(() => {
  db.close()
  fs.rmSync(root, { recursive: true, force: true })
})

async function addProject(name: string, dir: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/projects',
    headers: json,
    payload: { name, path: dir },
  })
  expect(res.statusCode).toBe(201)
  return res.json().project.id as number
}

describe('GET /api/projects/:id/status', () => {
  it('返回真实仓库状态', async () => {
    projectId = await addProject('repo', path.join(root, 'repo'))
    const res = await app.inject({ method: 'GET', url: `/api/projects/${projectId}/status` })

    expect(res.statusCode).toBe(200)
    const { status } = res.json()
    expect(status).toMatchObject({ isRepo: true, branch: 'main', dirty: false, status: 'no_remote' })
    expect(status.lastCommit.subject).toBe('初始提交')
  })

  it('工作区改动后能看出 dirty', async () => {
    fs.writeFileSync(path.join(root, 'repo', 'README.md'), '# 改了\n', 'utf8')
    const res = await app.inject({
      method: 'GET',
      url: `/api/projects/${projectId}/status?fresh=true`,
    })
    expect(res.json().status).toMatchObject({ dirty: true, status: 'dirty', dirtyCount: 1 })
  })

  it('不存在的项目返回 404', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/projects/424242/status' })
    expect(res.statusCode).toBe(404)
  })

  it('添加项目时没填远程地址，就从 git 的 origin 自动填', async () => {
    const withRemote = path.join(root, 'with-remote')
    fs.mkdirSync(withRemote, { recursive: true })
    git(withRemote, 'init', '-b', 'main')
    git(withRemote, 'remote', 'add', 'origin', 'https://example.invalid/x.git')

    const res = await app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: json,
      payload: { name: 'with-remote', path: withRemote },
    })
    expect(res.json().project.remoteUrl).toBe('https://example.invalid/x.git')
  })

  it('用户手填的远程地址优先于 git 里的', async () => {
    const dir = path.join(root, 'manual')
    fs.mkdirSync(dir, { recursive: true })
    git(dir, 'init', '-b', 'main')
    git(dir, 'remote', 'add', 'origin', 'https://from-git.invalid/x.git')

    const res = await app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: json,
      payload: {
        name: 'manual-remote',
        path: dir,
        remoteUrl: 'https://manual.invalid/typed.git',
      },
    })
    expect(res.json().project.remoteUrl).toBe('https://manual.invalid/typed.git')
  })
})

describe('GET /api/projects/:id/log', () => {
  it('返回提交图数据', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/projects/${projectId}/log?max=10` })
    expect(res.statusCode).toBe(200)
    const { entries } = res.json()
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ subject: '初始提交' })
    expect(entries[0].refs).toContain('HEAD -> main')
  })

  it('max 限制条数，越界时回落到默认', async () => {
    const one = await app.inject({ method: 'GET', url: `/api/projects/${projectId}/log?max=1` })
    expect(one.json().entries).toHaveLength(1)

    const bad = await app.inject({ method: 'GET', url: `/api/projects/${projectId}/log?max=abc` })
    expect(bad.json().entries).toHaveLength(1)
  })
})

describe('GET /api/status', () => {
  it('一次拿多个项目的状态，并按请求顺序返回', async () => {
    // path 是唯一的，所以得是两个不同的仓库
    const other = path.join(root, 'other')
    fs.mkdirSync(other, { recursive: true })
    git(other, 'init', '-b', 'trunk')
    git(other, 'config', 'remote.origin.url', 'https://example.invalid/other.git')

    const third = path.join(root, 'third')
    fs.mkdirSync(third, { recursive: true })
    git(third, 'init', '-b', 'dev')

    const a = await addProject('a', third)
    const b = await addProject('b', other)
    const res = await app.inject({ method: 'GET', url: `/api/status?ids=${b},${a}` })

    expect(res.statusCode).toBe(200)
    const { statuses } = res.json()
    expect(statuses.map((s: { projectId: number }) => s.projectId)).toEqual([b, a])
    expect(statuses[0].status.isRepo).toBe(true)
    expect(statuses[0].status.branch).toBe('trunk')
    expect(statuses[1].status.branch).toBe('dev')
  })

  it('清单里没有的 id 也要占位', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/status?ids=${projectId},999999` })
    const { statuses } = res.json()
    expect(statuses[1].status.status).toBe('missing')
  })

  it('没有 ids 时返回空数组', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/status' })
    expect(res.json().statuses).toEqual([])
  })

  /**
   * 列表接口走的是 lean 档：**不读工作区**，所以 `dirty` 恒为 false、`dirtyCount` 恒为 0。
   * `lastCommit` 则是**两档都读**——它回答「作者上次更新是什么时候」，
   * 是用户明确要看的一列（早期为省进程把它从列表拿掉过，那是错的）。
   *
   * 这条同时钉住两件更要紧的事：
   * 1. **两档的缓存必须分开**。lean 的「没有脏标记」要是混进详情页的缓存，
   *    详情页会在几秒内谎报「干净」——而脏标记正是 `pull` 的安全闸。
   * 2. 单仓库接口仍然是 full 档，dirty 一个都不能少。
   */
  it('lean 档不报 dirty，但报 lastCommit；且不会污染详情页的 full 档', async () => {
    const dir = path.join(root, 'lean-detail')
    fs.mkdirSync(dir, { recursive: true })
    git(dir, 'init', '-b', 'main')
    fs.writeFileSync(path.join(dir, 'README.md'), '# lean\n', 'utf8')
    git(dir, 'add', '-A')
    git(dir, 'commit', '-m', '初始提交')
    // 弄脏它，这样两档的差别才可见
    fs.writeFileSync(path.join(dir, 'untracked.txt'), 'x\n', 'utf8')
    const id = await addProject('lean-detail', dir)

    const list = await app.inject({ method: 'GET', url: `/api/status?ids=${id}` })
    const lean = list.json().statuses[0].status
    expect(lean).toMatchObject({
      isRepo: true,
      branch: 'main',
      dirty: false,
      dirtyCount: 0,
      status: 'no_remote',
    })
    // 「作者上次更新」这一条列表页也要有
    expect(lean.lastCommit.subject).toBe('初始提交')

    // 紧接着问详情：同一条路径、缓存还没过期，也必须拿到 full 档的答案。
    // 特别注意 dirty 与 dirtyUntracked —— 这两个字段容易在缓存串味时被写成 0。
    const detail = await app.inject({ method: 'GET', url: `/api/projects/${id}/status` })
    expect(detail.json().status).toMatchObject({
      dirty: true,
      dirtyCount: 1,
      dirtyTracked: 0,
      dirtyUntracked: 1,
      status: 'dirty',
    })
    expect(detail.json().status.lastCommit.subject).toBe('初始提交')
  })
})
