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
})
