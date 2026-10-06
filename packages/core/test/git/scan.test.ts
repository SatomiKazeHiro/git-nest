import { afterAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { scanDirectory } from '../../src/git/scan.ts'
import { cleanup, git, initClone, initRepo, tempDir, write } from '../helpers/repo.ts'

const dirs: string[] = []
const track = <T>(dir: T): T => (dirs.push(dir as unknown as string), dir)

afterAll(() => cleanup(...dirs))

describe('scanDirectory', () => {
  it('一层子目录里找出仓库，跳过普通目录和隐藏目录', async () => {
    const root = track(tempDir())

    const repo = path.join(root, 'repo-one')
    fs.mkdirSync(repo, { recursive: true })
    git(repo, 'init', '-b', 'main')
    write(repo, 'README.md', '# 项目一\n\n这是一个演示仓库。\n')
    git(repo, 'add', '-A')
    git(repo, 'commit', '-m', 'init')

    const plain = path.join(root, 'not-a-repo')
    fs.mkdirSync(plain, { recursive: true })

    const hidden = path.join(root, '.hidden-repo')
    fs.mkdirSync(hidden, { recursive: true })
    git(hidden, 'init', '-b', 'main')

    const result = await scanDirectory(root)

    expect(result.found).toHaveLength(1)
    expect(result.found[0]?.name).toBe('repo-one')
    expect(result.found[0]?.summary).toContain('这是一个演示仓库')
    expect(result.found[0]?.summarySource).toBe('readme')
  })

  it('.git 是文件（worktree / submodule）也算仓库', async () => {
    const root = track(tempDir())
    const fake = path.join(root, 'worktree-like')
    fs.mkdirSync(fake, { recursive: true })
    // 只放一个 .git 文件，没有 .git 目录
    write(fake, '.git', 'gitdir: /somewhere/else\n')

    const result = await scanDirectory(root)
    expect(result.found.map((r) => r.name)).toContain('worktree-like')
  })

  it('没有 README 就用最后一次提交的标题当摘要', async () => {
    const dir = track(initRepo().replace(/[\\/]repo$/, ''))
    const repo = path.join(dir, 'repo')
    fs.rmSync(path.join(repo, 'README.md'))

    const result = await scanDirectory(dir)
    expect(result.found[0]?.summary).toBe('first commit')
    expect(result.found[0]?.summarySource).toBe('commit')
  })

  it('读出 remote origin，并标记已在清单里的', async () => {
    const { origin, clone } = track(initClone(0))
    // origin 与 clone 是同一个父目录下的兄弟
    const result = await scanDirectory(path.dirname(origin), { trackedPaths: [clone] })

    const names = result.found.map((r) => r.name)
    expect(names).toContain('origin')
    expect(result.found.find((r) => r.name === 'clone')?.alreadyTracked).toBe(true)
    expect(result.found.find((r) => r.name === 'origin')?.alreadyTracked).toBe(false)
  })

  it('目录不存在时返回空列表，不抛错', async () => {
    const result = await scanDirectory(path.join(tempDir(), 'nope'))
    expect(result.found).toEqual([])
    expect(result.candidates).toBe(0)
    expect(result.truncated).toBe(false)
  })

  /*
    扫描是把一棵目录树变成工作量的动作：每个候选都要问两次 git，而范围完全由用户
    填的那个目录决定（盘根 + depth 3 = 上万次进程，界面上只有一个「扫描中…」）。
    上限本身可以接受，**悄悄截断不行**——那会让用户以为「这个目录下就这么多仓库」。
    所以这里钉两件事：真的截断了，而且截断这件事被如实报出来。
  */
  it('候选超过上限时只列前 N 个，但如实报出被截断', async () => {
    const root = track(tempDir())
    for (const name of ['repo-a', 'repo-b', 'repo-c']) {
      const dir = path.join(root, name)
      fs.mkdirSync(dir, { recursive: true })
      fs.mkdirSync(path.join(dir, '.git'))
    }

    const result = await scanDirectory(root, { maxResults: 2 })

    expect(result.found.map((r) => r.name)).toEqual(['repo-a', 'repo-b'])
    expect(result.candidates, '一共发现几个要说真话').toBe(3)
    expect(result.truncated).toBe(true)
  })

  it('没到上限时 candidates 等于列出的数量，truncated 为 false', async () => {
    const root = track(tempDir())
    for (const name of ['repo-a', 'repo-b']) {
      const dir = path.join(root, name)
      fs.mkdirSync(dir, { recursive: true })
      fs.mkdirSync(path.join(dir, '.git'))
    }

    const result = await scanDirectory(root, { maxResults: 10 })

    expect(result.found).toHaveLength(2)
    expect(result.candidates).toBe(2)
    expect(result.truncated).toBe(false)
  })

  it('结果始终按完整路径排序（两次扫描要能比对）', async () => {
    const root = track(tempDir())
    for (const name of ['z-repo', 'a-repo', 'm-repo']) {
      const dir = path.join(root, name)
      fs.mkdirSync(dir, { recursive: true })
      fs.mkdirSync(path.join(dir, '.git'))
    }

    const first = await scanDirectory(root)
    const second = await scanDirectory(root)

    expect(first.found.map((r) => r.name)).toEqual(['a-repo', 'm-repo', 'z-repo'])
    expect(second.found.map((r) => r.dir)).toEqual(first.found.map((r) => r.dir))
  })
})
