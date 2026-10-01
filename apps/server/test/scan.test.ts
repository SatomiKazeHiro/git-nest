import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { buildApp } from '../src/app.ts'
import { openDatabase, type DB } from '../src/db/index.ts'

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let db: DB
let app: ReturnType<typeof buildApp>['app']
let root: string

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
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', [...GIT, ...args], { cwd, encoding: 'utf8' })
const json = { 'content-type': 'application/json' }

const post = (url: string, payload: unknown) =>
  app.inject({ method: 'POST' as const, url, headers: json, payload: payload as object })

/** 造一个带 README 和 origin 的仓库；readme 传 null 表示没有 README */
function makeRepo(
  name: string,
  opts: { readme?: string | null; remote?: boolean; parent?: string } = {},
) {
  const parent = opts.parent ?? root
  const dir = path.join(parent, name)
  fs.mkdirSync(dir, { recursive: true })
  git(dir, 'init', '-b', 'main')
  if (opts.readme !== null) {
    fs.writeFileSync(
      path.join(dir, 'README.md'),
      opts.readme ?? `# ${name}\n\n这是 ${name} 的说明。\n`,
      'utf8',
    )
  }
  fs.writeFileSync(path.join(dir, 'file.txt'), 'init\n', 'utf8')
  git(dir, 'add', '-A')
  git(dir, 'commit', '-m', '初始提交')
  if (opts.remote !== false) {
    git(dir, 'remote', 'add', 'origin', `https://example.invalid/${name}.git`)
  }
  return dir
}

beforeAll(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'git-nest-scan-')))
  db = openDatabase(':memory:')
  app = buildApp({ db, logger: false }).app

  makeRepo('alpha')
  makeRepo('beta', { readme: null })
  makeRepo('gamma', { remote: false })
  fs.mkdirSync(path.join(root, 'not-a-repo'), { recursive: true })
  fs.mkdirSync(path.join(root, 'nested'), { recursive: true })
  makeRepo('deep', { parent: path.join(root, 'nested') })
})

afterAll(() => {
  db.close()
  fs.rmSync(root, { recursive: true, force: true })
})

describe('POST /api/scan', () => {
  it('只扫一层子目录，认出哪些已经在清单里', async () => {
    // 先把 alpha 加进清单
    const added = await post('/api/projects', { name: 'alpha', path: path.join(root, 'alpha') })
    expect(added.statusCode).toBe(201)

    const res = await post('/api/scan', { dir: root })
    expect(res.statusCode).toBe(200)
    const { found } = res.json()

    const names = found.map((r: { name: string }) => r.name)
    expect(names).toEqual(['alpha', 'beta', 'gamma']) // 字母序
    expect(names).not.toContain('not-a-repo') // 普通目录不算
    expect(names).not.toContain('deep') // depth 默认 1，不往里扫

    const alpha = found.find((r: { name: string }) => r.name === 'alpha')
    expect(alpha).toMatchObject({
      alreadyTracked: true,
      projectName: 'alpha',
      projectId: added.json().project.id,
    })

    const beta = found.find((r: { name: string }) => r.name === 'beta')
    expect(beta.alreadyTracked).toBe(false)
    expect(beta.remoteUrl).toBe('https://example.invalid/beta.git')
    // 没有 README 就退回最后一次提交的标题
    expect(beta.summary).toBe('初始提交')
    expect(beta.summarySource).toBe('commit')
  })

  it('摘要优先取 README 首段', async () => {
    const res = await post('/api/scan', { dir: root })
    const alpha = res.json().found.find((r: { name: string }) => r.name === 'alpha')
    expect(alpha.summary).toBe('这是 alpha 的说明。')
    expect(alpha.summarySource).toBe('readme')
  })

  it('depth 可以往下扫', async () => {
    const res = await post('/api/scan', { dir: path.join(root, 'nested'), depth: 2 })
    expect(res.json().found.map((r: { name: string }) => r.name)).toEqual(['deep'])
  })

  it('没有 origin 的仓库 remoteUrl 为空', async () => {
    const res = await post('/api/scan', { dir: root })
    const gamma = res.json().found.find((r: { name: string }) => r.name === 'gamma')
    expect(gamma.remoteUrl).toBeNull()
  })

  it('目录不存在 → 400，说清是哪个路径', async () => {
    const res = await post('/api/scan', { dir: path.join(root, 'nope') })
    expect(res.statusCode).toBe(400)
    expect(res.json().message).toContain('目录不存在')
  })

  it('目录为空 → 422', async () => {
    const res = await post('/api/scan', { dir: '   ' })
    expect(res.statusCode).toBe(422)
  })

  it('remember 会把目录记进设置', async () => {
    const res = await post('/api/scan', { dir: path.join(root, 'nested'), remember: true })
    expect(res.statusCode).toBe(200)

    const settings = await app.inject({ method: 'GET', url: '/api/settings' })
    expect(settings.json().settings.scanDirs).toContain(
      path.join(root, 'nested').replace(/\\/g, '/'),
    )
  })

  it('常用目录可以删掉，并记住这次删除', async () => {
    const before = await app.inject({ method: 'GET', url: '/api/settings' })
    const dirs: string[] = before.json().settings.scanDirs
    expect(dirs.length).toBeGreaterThan(0)

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/settings',
      headers: json,
      payload: { scanDirs: dirs.filter((d) => d !== dirs[0]) },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().settings.scanDirs).toEqual(dirs.slice(1))

    // 再读一次确认真的落库了（不是只改了内存）
    const after = await app.inject({ method: 'GET', url: '/api/settings' })
    expect(after.json().settings.scanDirs).toEqual(dirs.slice(1))
  })

  it('损坏的 scanDirs 值不把整个设置搞坏', async () => {
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
      'scanDirs',
      '{不是 JSON',
    )
    const res = await app.inject({ method: 'GET', url: '/api/settings' })
    expect(res.statusCode).toBe(200)
    expect(res.json().settings.scanDirs).toEqual([])
  })
})

describe('POST /api/projects/import', () => {
  it('批量入库，并自动填名字与远程地址', async () => {
    const scan = await post('/api/scan', { dir: root })
    const targets = scan.json()
      .found.filter((r: { alreadyTracked: boolean }) => !r.alreadyTracked)
      .map((r: { dir: string }) => r.dir)
    expect(targets.length).toBeGreaterThanOrEqual(2)

    const res = await post('/api/projects/import', { paths: targets, category: 'backups' })
    expect(res.statusCode).toBe(200)
    const { created, skipped } = res.json()
    expect(created).toHaveLength(targets.length)
    expect(skipped).toHaveLength(0)

    const list = await app.inject({ method: 'GET', url: '/api/projects?category=backups' })
    const byName = new Map<string, { id: number; remoteUrl: string | null; category: string }>(
      list.json().projects.map((p: { id: number; name: string; remoteUrl: string | null; category: string }) => [
        p.name,
        p,
      ]),
    )
    expect(byName.get('beta')?.remoteUrl).toBe('https://example.invalid/beta.git')
    expect(byName.get('gamma')?.remoteUrl).toBeNull()
    expect(byName.get('beta')?.category).toBe('backups')
  })

  it('重复导入同一个路径 → 跳过并说明原因', async () => {
    const target = path.join(root, 'beta')
    const res = await post('/api/projects/import', { paths: [target] })
    expect(res.statusCode).toBe(200)
    expect(res.json().created).toHaveLength(0)
    expect(res.json().skipped).toEqual([{ path: target.replace(/\\/g, '/'), reason: '已经在清单里了' }])
  })

  it('一个失败不影响其他：目录不存在的那条被跳过，其余照常入库', async () => {
    const fresh = makeRepo('delta')
    const res = await post('/api/projects/import', {
      paths: [fresh, path.join(root, 'ghost-dir')],
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().created.map((c: { name: string }) => c.name)).toEqual(['delta'])
    expect(res.json().skipped[0].reason).toBe('目录不存在')
  })

  it('导入后可以完整编辑元数据（验收：扫一个目录入库并编辑）', async () => {
    const dir = makeRepo('epsilon')
    await post('/api/projects/import', { paths: [dir] })
    const list = await app.inject({ method: 'GET', url: '/api/projects?q=epsilon' })
    const id = list.json().projects[0].id

    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/projects/${id}`,
      headers: json,
      payload: {
        name: 'epsilon-renamed',
        category: 'tools',
        summary: '扫进来之后自己补的摘要',
        sourceUrl: 'https://example.invalid/video',
      },
    })
    expect(patched.statusCode).toBe(200)
    expect(patched.json().project).toMatchObject({
      name: 'epsilon-renamed',
      category: 'tools',
      summary: '扫进来之后自己补的摘要',
      sourceUrl: 'https://example.invalid/video',
    })

    await app.inject({
      method: 'PUT',
      url: `/api/projects/${id}/tags`,
      headers: json,
      payload: { tagNames: ['扫进来的'] },
    })
    const detail = await app.inject({ method: 'GET', url: `/api/projects/${id}` })
    expect(detail.json().project.tags.map((t: { name: string }) => t.name)).toEqual(['扫进来的'])
  })

  it('paths 为空 → 422', async () => {
    const res = await post('/api/projects/import', { paths: [] })
    expect(res.statusCode).toBe(422)
  })

  it('导入不会碰磁盘上的仓库', async () => {
    const dir = makeRepo('zeta')
    const before = fs.readdirSync(dir).sort()
    await post('/api/projects/import', { paths: [dir] })
    expect(fs.readdirSync(dir).sort()).toEqual(before)
    expect(fs.existsSync(path.join(dir, '.git'))).toBe(true)
  })
})
