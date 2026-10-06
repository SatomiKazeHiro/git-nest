import { afterAll, describe, expect, it } from 'vitest'
import { getLog, parseGitLog } from '../../src/git/log.ts'
import { cleanup, commit, git, initRepo, tempDir } from '../helpers/repo.ts'

const dirs: string[] = []
const track = <T>(dir: T): T => (dirs.push(dir as unknown as string), dir)

afterAll(() => cleanup(...dirs))

describe('parseGitLog', () => {
  it('按记录分隔符切开，字段各归各位', () => {
    // 字段顺序与 log.ts 的 PRETTY 一致：hash/hash/家长/作者名/作者邮箱/
    // committerDate/authorDate/subject/refs
    const A = 'a'.repeat(40)
    const B = 'b'.repeat(40)
    const raw = [
      `${A}\x1fa1b2c3\x1f\x1f某人\x1fa@b.c\x1f2026-06-20T10:00:00+08:00\x1f2026-06-20T09:00:00+08:00\x1f标题里有 → 箭头\x1fHEAD -> main, tag: v1\x1e`,
      `${B}\x1fd4e5f6\x1f${A}\x1f另一个人\x1fd@e.f\x1f2026-06-19T09:00:00+08:00\x1f2026-06-19T08:00:00+08:00\x1f第二个提交\x1f\x1e`,
    ].join('')

    const entries = parseGitLog(raw, 'main')
    expect(entries).toHaveLength(2)
    expect(entries[0]).toMatchObject({
      hash: A,
      shortHash: 'a1b2c3',
      parents: [],
      authorName: '某人',
      subject: '标题里有 → 箭头',
      branch: 'main',
      committerDate: '2026-06-20T10:00:00+08:00',
      authorDate: '2026-06-20T09:00:00+08:00',
    })
    expect(entries[0]?.refs).toEqual(['HEAD -> main', 'tag: v1'])
    expect(entries[1]?.parents).toEqual([A])
  })

  it('提交信息里出现真 0x1E 时，不许把残片当提交', () => {
    /*
      git 只禁 NUL，0x1E/0x1F 在提交信息里是合法字节。subject 里带 0x1E 时，
      一条记录会被切成两段：「ghp_deadbeef」那段只有 subject 剩下的部分，
      但 split 出来的第二块仍带着 `短sha\x1f...` 的形状。
      没有 40 位十六进制这道守卫，它就会被当成一条提交混进图里。
    */
    const A = 'c'.repeat(40)
    const raw =
      `${A}\x1fa1b2c3\x1f\x1f某人\x1fa@b.c\x1f2026-06-20T10:00:00+08:00\x1f2026-06-20T09:00:00+08:00\x1f前半\x1e后半\x1fHEAD -> main\x1e`

    const entries = parseGitLog(raw, 'main')
    // 只认第一条（真 hash）；残片被丢掉，而不是变成一条 hash 为「后半」的假提交
    expect(entries).toHaveLength(1)
    expect(entries[0]?.hash).toBe(A)
  })

  it('空输入返回空数组', () => {
    expect(parseGitLog('')).toEqual([])
    expect(parseGitLog('\n')).toEqual([])
  })
})

describe('getLog', () => {
  it('线性历史：parents 串成链', async () => {
    const dir = track(initRepo('第一个'))
    commit(dir, '第二个')
    commit(dir, '第三个')

    const entries = await getLog(dir)
    expect(entries).toHaveLength(3)
    expect(entries[0]?.subject).toBe('第三个')
    expect(entries[0]?.parents).toHaveLength(1)
    expect(entries[2]?.parents).toEqual([])
    expect(entries[0]?.date).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('分叉：merge commit 有两个 parents', async () => {
    const dir = track(initRepo('主干'))
    git(dir, 'checkout', '-q', '-b', 'side')
    commit(dir, '支线提交', 'side.txt')
    git(dir, 'checkout', '-q', 'main')
    commit(dir, '主干提交', 'main.txt')
    git(dir, 'merge', '--no-ff', '-m', '合并支线', 'side')

    const entries = await getLog(dir)
    const merge = entries.find((e) => e.subject === '合并支线')
    expect(merge?.parents).toHaveLength(2)
  })

  it('refs 里带出分支名', async () => {
    const dir = track(initRepo())
    git(dir, 'tag', 'v1.0')

    const entries = await getLog(dir)
    expect(entries[0]?.refs).toContain('HEAD -> main')
    expect(entries[0]?.refs).toContain('tag: v1.0')
  })

  it('maxCount 限制条数', async () => {
    const dir = track(initRepo('c0'))
    for (let i = 1; i < 5; i++) commit(dir, `c${i}`)

    const entries = await getLog(dir, { maxCount: 2 })
    expect(entries).toHaveLength(2)
  })

  it('空仓库返回空列表，不报错', async () => {
    const dir = track(tempDir())
    git(dir, 'init', '-b', 'main')
    expect(await getLog(dir)).toEqual([])
  })

  it('不是仓库也返回空列表，不抛错', async () => {
    const dir = track(tempDir())
    expect(await getLog(dir)).toEqual([])
  })

  it('带出提交图组件需要的字段（authorDate / branch）', async () => {
    // 提交图渲染器换过两代，现在是「一阶段不显示、接口留给二阶段 Agent」。
    // 它要的是 author 与 committerDate，以及每个提交所属的 branch；branch 取当前分支名。
    const dir = track(initRepo('第一个'))

    const entries = await getLog(dir, { branch: 'main' })
    expect(entries[0]?.authorDate).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(entries[0]?.committerDate).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(entries[0]?.authorName).toBe('git-nest test')
    expect(entries[0]?.authorEmail).toBe('dev@git-nest.test')
  })

  it('默认只取当前检出的分支，不混入别的分支', async () => {
    // 库按 branch 组织图，而 --all 会把别的分支的提交也拉进来、导致分支归属
    // 说不清。默认走 HEAD 才是这个视图的语义。
    const dir = track(initRepo('主干'))
    git(dir, 'checkout', '-q', '-b', 'side')
    commit(dir, '支线独有的提交', 'side.txt')
    git(dir, 'checkout', '-q', 'main')

    const entries = await getLog(dir, { branch: 'main' })
    expect(entries.map((e) => e.subject)).not.toContain('支线独有的提交')
  })
})
