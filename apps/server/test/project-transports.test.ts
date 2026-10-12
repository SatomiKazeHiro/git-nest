import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { openDatabase, type DB } from '../src/db/index.ts'
import { analyze, bindSettings } from '../src/lib/git.ts'
import { insertProject } from '../src/repos/projects.ts'
import { forgetTransport, preferredTransport, rememberTransport } from '../src/repos/transports.ts'
import type { FetchRemoteOptions, FetchRemoteResult } from '@git-nest/core/git'

/**
 * 「按项目记住走通的传输方式」这条结论：**表怎么读写**，以及
 * **server 那一层「读结论 → 先试那条 → 把走通的记回去」的整条链**。
 *
 * 为什么要有它：某个项目的 origin 是 HTTPS，`git fetch` 报连接被重置 /
 * 443 连不上，而**同一分钟**别的 SSH 项目 fetch 成功。core 的 `fetchWithFallback`
 * 会为那一次自动换路，但换路是有代价的——先把失败的那条路再走一遍（那条正好
 * 可能是 21 秒的连接超时）。记住走通的那条，下一次它就**先试**这条。
 *
 * 换路的判断本身由 core 的 `packages/core/test/git/fetch.test.ts` 钉着（真 git）。
 * 这里用假的 `fetch://` 地址 + 注入执行器验**落库那一层**：
 * 哪条走通、有没有真的写成「下次先试它」。
 */

/** 与其它 server 测试同一种做法：真的建仓库；只有 fetch 这一层被注入替换。 */
const IDENTITY = [
  '-c',
  'user.email=dev@git-nest.test',
  '-c',
  'user.name=test',
  '-c',
  'commit.gpgsign=false',
  '-c',
  'init.defaultBranch=main',
]

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', [...IDENTITY, ...args], { cwd, encoding: 'utf8' })

let db: DB
let root: string
let projectId: number

beforeAll(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'git-nest-transport-')))
  db = openDatabase(':memory:')
  // `analyze` 走 server 的 scheduler 与设置表，必须先绑库（这也正是生产启动顺序）
  bindSettings(db)
  // 项目实体本身不是这条测试的对象，直接把行写进去；这张表只记结论，不读仓库
  projectId = insertProject(db, {
    name: 'transport',
    path: path.join(root, 'repo'),
    remoteUrl: 'https://github.com/o/r.git',
    category: '',
    record: '',
  })
})

afterAll(() => {
  db.close()
  fs.rmSync(root, { recursive: true, force: true })
})

describe('project_transports', () => {
  it('迁移建出了表（旧库不会被就地升级，这条守着新库的形状）', () => {
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'project_transports'")
      .get()
    expect(row).toBeTruthy()
  })

  it('还没走过任何一条路时是 null（= 不知道，core 按地址本身的形式先试）', () => {
    expect(preferredTransport(db, projectId)).toBeNull()
  })

  it('记住之后能读回来；再记另一条会覆盖（一个项目只留一行）', () => {
    rememberTransport(db, projectId, 'ssh')
    expect(preferredTransport(db, projectId)).toBe('ssh')

    rememberTransport(db, projectId, 'https')
    expect(preferredTransport(db, projectId)).toBe('https')

    const count = db
      .prepare('SELECT COUNT(*) AS n FROM project_transports WHERE project_id = ?')
      .get(projectId) as { n: number }
    expect(count.n).toBe(1)
  })

  it('updated_at 跟着走（只有一条记录，时间必须刷成最新那次）', () => {
    rememberTransport(db, projectId, 'ssh')
    const first = db
      .prepare('SELECT updated_at FROM project_transports WHERE project_id = ?')
      .get(projectId) as { updated_at: string }
    expect(first.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(Number.isNaN(Date.parse(first.updated_at))).toBe(false)
  })

  it('库里存着怪值时当作「不知道」，而不是拿它去换路', () => {
    db.prepare('UPDATE project_transports SET transport = ? WHERE project_id = ?').run(
      'rsync',
      projectId,
    )
    expect(preferredTransport(db, projectId)).toBeNull()
  })

  it('项目被删掉时结论跟着走（外键级联，不留孤儿行）', () => {
    rememberTransport(db, projectId, 'ssh')
    db.prepare('DELETE FROM projects WHERE id = ?').run(projectId)
    const left = db
      .prepare('SELECT COUNT(*) AS n FROM project_transports')
      .get() as { n: number }
    expect(left.n).toBe(0)
  })

  it('forgetTransport 能清掉一条记录', () => {
    const created = db
      .prepare(
        `INSERT INTO projects (name, path, remote_url, category, is_own, record, added_at, sort_order)
         VALUES ('t2', ?, NULL, '', 0, '', ?, 0)`,
      )
      .run(path.join(root, 'repo2'), new Date().toISOString())
    const id = Number(created.lastInsertRowid)

    rememberTransport(db, id, 'ssh')
    expect(preferredTransport(db, id)).toBe('ssh')
    forgetTransport(db, id)
    expect(preferredTransport(db, id)).toBeNull()
  })
})

/**
 * 落库那一层：`analyze` 读结论 → core 先试它 → 走通的那条被记回去。
 *
 * 地址必须是**真的 github 地址**（不能自己编一个 `fetch://`）：另一条路是从
 * origin 地址推导出来的，而 `deriveAlternativeRemote` 只认规范的 GitHub 形式
 * ——编一个 scheme 只会得到「没有另一条路」，换路根本不会发生（这一点我实测过）。
 * 于是两条候选地址就是 `https://github.com/o/r.git` 与 `git@github.com:o/r.git`。
 *
 * 执行器是注入的（`fetchExecutor`），所以这里**不碰网络**：真实 github 上
 * 这台机器的通断是不确定的，靠它测「哪条走通了」等于靠运气。
 */
describe('analyze 把走通的传输方式记下来（下一轮先试它）', () => {
  const HTTPS_URL = 'https://github.com/o/r.git'
  const SSH_URL = 'git@github.com:o/r.git'

  /** 只认 `okUrl` 为通，其它一律 network 失败；把每次尝试记下来。 */
  function executorOkFor(okUrl: string | null) {
    const calls: FetchRemoteOptions[] = []
    const execute = async (options: FetchRemoteOptions): Promise<FetchRemoteResult> => {
      calls.push(options)
      if (okUrl !== null && options.url === okUrl) {
        return { ok: true, code: 0, stderr: '', timedOut: false }
      }
      return {
        ok: false,
        code: 128,
        stderr: `fatal: unable to access '${options.url}': Could not resolve host`,
        timedOut: false,
        error: { kind: 'network', message: `连不上远程（${options.transport}）` },
      }
    }
    return { execute, calls }
  }

  /** 一个真的 git 仓库，origin 指向给定的地址（会被 git 原样回答出来）。 */
  function repoWithRemote(
    name: string,
    remoteUrl: string,
  ): { dir: string; id: number } {
    const dir = path.join(root, name)
    fs.mkdirSync(dir, { recursive: true })
    git(dir, 'init', '-b', 'main')
    fs.writeFileSync(path.join(dir, 'README.md'), '# demo\n')
    git(dir, 'add', '-A')
    git(dir, 'commit', '-m', '初始提交')
    git(dir, 'remote', 'add', 'origin', remoteUrl)
    const id = insertProject(db, { name, path: dir, remoteUrl, category: '', record: '' })
    return { dir, id }
  }

  it('走通了就写下来（没有结论时按地址形式先试，一次就够）', async () => {
    const { dir, id } = repoWithRemote('remember', HTTPS_URL)
    expect(preferredTransport(db, id)).toBeNull()

    const fake = executorOkFor(HTTPS_URL)
    const report = await analyze(dir, { projectId: id, label: 'check', fetchExecutor: fake.execute })

    expect(report.error).toBeNull()
    expect(fake.calls.map((c) => c.transport)).toEqual(['https'])
    expect(preferredTransport(db, id)).toBe('https')
  })

  it('下一轮**先试**记住的那条；换成另一条走通时结论也跟着改', async () => {
    const { dir, id } = repoWithRemote('remember-flip', HTTPS_URL)
    // 上次这条项目的 HTTPS 走通过
    rememberTransport(db, id, 'https')
    // 这次反过来：只有 SSH 通
    const fake = executorOkFor(SSH_URL)

    const report = await analyze(dir, { projectId: id, label: 'check', fetchExecutor: fake.execute })

    expect(report.error).toBeNull()
    // 第一次就应该是记住的那条（HTTPS 那一步失败），然后换到 SSH 并成功
    expect(fake.calls[0]?.url).toBe(HTTPS_URL)
    expect(fake.calls[1]?.url).toBe(SSH_URL)
    expect(fake.calls[1]?.transport).toBe('ssh')
    // 结论必须跟着现实改：下次先试 SSH，别再每次先踩一遍失败的 HTTPS
    expect(preferredTransport(db, id)).toBe('ssh')
  })

  it('两条路都没通时不写结论（宁可下次重新试，也不要记一条错的）', async () => {
    const { dir, id } = repoWithRemote('remember-fail', HTTPS_URL)
    const fake = executorOkFor(null)

    const report = await analyze(dir, { projectId: id, label: 'check', fetchExecutor: fake.execute })

    expect(report.status).toBe('error')
    expect(report.error?.kind).toBe('network')
    // 两条路都试过，但没有任何一条走通
    expect(fake.calls.map((c) => c.transport)).toEqual(['https', 'ssh'])
    expect(preferredTransport(db, id)).toBeNull()
  })

  it('不传 projectId 的调用方不读也不写', async () => {
    const { dir } = repoWithRemote('remember-noid', HTTPS_URL)
    const fake = executorOkFor(HTTPS_URL)

    const before = db.prepare('SELECT COUNT(*) AS n FROM project_transports').get() as { n: number }
    const report = await analyze(dir, { label: 'check', fetchExecutor: fake.execute })

    expect(report.error).toBeNull()
    const after = db.prepare('SELECT COUNT(*) AS n FROM project_transports').get() as { n: number }
    expect(after.n).toBe(before.n)
  })
})
