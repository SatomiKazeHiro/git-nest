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
  })
})
