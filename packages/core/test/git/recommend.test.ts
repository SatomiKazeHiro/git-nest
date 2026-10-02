import { afterAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { readRecommendation } from '../../src/git/inspect/recommend.ts'
import { cleanup, commit, git, tempDir } from '../helpers/repo.ts'

/**
 * 「推不推荐更新」的行为表。
 *
 * 这一组回答的是用户点名要的那个问题：**拉了会不会出事**
 * （原话：「推不推荐更新（尤其避免更新到作者删库或者重置仓库的情况）」）。
 *
 * 判据全部来自 `git merge-base --is-ancestor` 与 `merge-base`，
 * 退出码语义（0=是祖先 / 1=不是 / 其它=出错）已用独立探针在真实仓库上确认过。
 * 这里跑的是同样那批场景，只是搬进 vitest。
 *
 * **这批测试同时钉住一个诚实的限制**：见最后一个用例。
 */

const dirs: string[] = []
const track = <T>(d: T): T => (dirs.push(d as unknown as string), d)
afterAll(() => cleanup(...dirs))

/**
 * 远程（裸库）+ 两个克隆：`a` = 我们的仓库（观察者），`b` = 用来往远程推改动。
 *
 * origin 必须是**裸库**：往非裸库的当前分支 push 会被 git 拒绝
 * （`refusing to update checked out branch`），那是 git 的保护，不是测试环境问题。
 */
function pair(name: string) {
  const root = tempDir(`gitnest-rec-${name}-`)
  const origin = path.join(root, 'origin.git')
  fs.mkdirSync(origin, { recursive: true })
  git(origin, 'init', '--bare', '--initial-branch=main')

  // 播一个初始提交进裸库（裸库自己没法 commit）
  const seed = path.join(root, 'seed')
  git(root, 'clone', origin, 'seed')
  fs.writeFileSync(path.join(seed, 'a.txt'), 'base\n')
  git(seed, 'add', '-A')
  git(seed, 'commit', '-m', 'base')
  git(seed, 'push', '-u', 'origin', 'main')

  const a = path.join(root, 'a')
  git(root, 'clone', origin, 'a')
  const b = path.join(root, 'b')
  git(root, 'clone', origin, 'b')
  track(root)
  return { origin, a, b }
}

async function upstreamSha(dir: string): Promise<string> {
  return git(dir, 'rev-parse', '@{u}').trim()
}

describe('推不推荐更新', () => {
  it('正常落后 → safe，canPull 为 true', async () => {
    const { a, b } = pair('behind')
    commit(b, '远程提交')
    git(b, 'push')
    git(a, 'fetch')

    const rec = await readRecommendation(a)
    expect(rec).toMatchObject({ verdict: 'safe', ahead: 0, behind: 1, canPull: true })
    expect(rec?.reason).toContain('快进')
  })

  it('已是最新 → safe，但 canPull 为 false（没东西可拉）', async () => {
    const { a } = pair('uptodate')
    const rec = await readRecommendation(a)
    expect(rec).toMatchObject({ verdict: 'safe', ahead: 0, behind: 0, canPull: false })
  })

  it('本地领先 → safe，canPull 为 false（远程没有新东西）', async () => {
    const { a } = pair('ahead')
    commit(a, '只在本地的提交')
    const rec = await readRecommendation(a)
    expect(rec).toMatchObject({ verdict: 'safe', ahead: 1, behind: 0, canPull: false })
    expect(rec?.reason).toContain('还没推')
  })

  it('真分叉（有共同祖先）→ diverged，不能拉', async () => {
    const { a, b } = pair('diverged')
    commit(a, '本地提交')
    commit(b, '远程提交')
    git(b, 'push')
    git(a, 'fetch')

    const rec = await readRecommendation(a)
    expect(rec).toMatchObject({ verdict: 'diverged', ahead: 1, behind: 1, canPull: false })
  })

  /**
   * 这个就是用户要防的情况之一：**作者把整个历史换掉了**
   * （删库重建、或者用一棵全新的树覆盖了原来的分支）。
   *
   * 判据：本地那棵树和上游那棵树**没有共同祖先**（`merge-base` 输出为空）。
   * 这时候「落后 N 个提交」这个说法本身就是错的——拉进来不是更新，是换仓库。
   */
  it('作者重置仓库（历史不相干）→ unrelated，强烈不建议拉', async () => {
    const { a, b } = pair('unrelated')
    commit(b, '远程提交')
    git(b, 'push')
    git(a, 'fetch')

    // b 里造一棵全新的根提交，强推覆盖 main
    git(b, 'checkout', '--orphan', 'fresh')
    git(b, 'rm', '-rq', '--cached', '.')
    fs.writeFileSync(path.join(b, 'a.txt'), 'brand new\n')
    git(b, 'add', '-A')
    git(b, 'commit', '-m', '全新的根提交')
    git(b, 'branch', '-M', 'fresh', 'main')
    git(b, 'push', '--force', 'origin', 'main')
    git(a, 'fetch')

    const rec = await readRecommendation(a)
    expect(rec).toMatchObject({ verdict: 'unrelated', canPull: false })
    // 数字在这里没有意义，给 null 比给一个会误导的「落后 1」好
    expect(rec?.ahead).toBeNull()
    expect(rec?.behind).toBeNull()
    expect(rec?.reason).toContain('没有共同祖先')
  })

  /**
   * 用户要防的另一种情况：**作者删掉了这个分支**。
   *
   * 判据：配置里配着上游，但 `@{u}` 解析不出来（fetch --prune 之后正是这形态）。
   * 这时返回 null——调用方（`inspect/index.ts`）会把它报成 `gone`，
   * **绝不能**落到「推荐更新」那一侧。
   */
  it('上游分支被远程删掉 → null（交给调用方报 gone）', async () => {
    const { origin, a, b } = pair('gone')
    git(origin, 'config', 'receive.denyDeleteCurrent', 'ignore')
    git(b, 'push', 'origin', '--delete', 'main')
    git(a, 'fetch', '--prune')

    expect(await readRecommendation(a)).toBeNull()
  })

  it('没有上游 → null', async () => {
    const dir = track(tempDir())
    git(dir, 'init', '-b', 'main')
    fs.writeFileSync(path.join(dir, 'a.txt'), 'x\n')
    git(dir, 'add', '-A')
    git(dir, 'commit', '-m', 'one')

    expect(await readRecommendation(dir)).toBeNull()
  })

  /**
   * 作者 force push 覆盖了**本地已经读到过**的提交 → rewritten。
   *
   * 判据不是「本地 HEAD 还能不能快进」（那种情况下它照样能！），
   * 而是拿**上次检查时记下的上游 SHA** 去问：「那个提交还在新历史里吗？」
   * 不在 ⇒ 作者改写了历史 ⇒ 别直接拉。
   */
  it('作者 force push 覆盖掉见过的提交 → rewritten（靠上次记录的 SHA 才判得出）', async () => {
    const { a, b } = pair('rewritten')
    commit(b, '会被丢掉的那个提交')
    git(b, 'push')
    git(a, 'fetch')
    const seen = await upstreamSha(a) // 「上次检查时上游指向这里」

    // 作者改写：把这个提交丢掉，换成另一个
    git(b, 'reset', '--hard', 'HEAD~1')
    commit(b, '换成了这个')
    git(b, 'push', '--force')
    git(a, 'fetch')

    const rec = await readRecommendation(a, { baselineSha: seen })
    expect(rec).toMatchObject({ verdict: 'rewritten', canPull: false })
    expect(rec?.reason).toContain('改写')
  })

  /**
   * ⚠️ **诚实的限制**：同一次 force push，如果本地**从没读到过**被丢掉的那个提交，
   * 就判不出来——本地 HEAD 仍然是新历史的祖先，git 自己也会毫无怨言地快进。
   *
   * 这条用例把这个限制**钉下来**，免得以后有人以为 `rewritten` 能兜住所有 force push。
   * 这也正是 `lastUpstreamSha` 必须落库的原因。
   */
  it('本地没见过被丢掉的提交时，force push 看不出来 —— git 自己也会快进', async () => {
    const { a, b } = pair('unseen')
    commit(b, 'b 的提交')
    git(b, 'push')
    git(b, 'reset', '--hard', 'HEAD~1')
    commit(b, '改写后的提交')
    git(b, 'push', '--force')
    // a 这时才第一次 fetch，从没见过被丢掉的那个提交
    git(a, 'fetch')

    const rec = await readRecommendation(a)
    expect(rec).toMatchObject({ verdict: 'safe', canPull: true })

    // 顺带确认 git 也确实能快进（不是我们的实现漏了什么）：
    // HEAD 必须是上游的祖先 —— 这正是 `pull --ff-only` 会成功的前提。
    // 不去断言 `pull --dry-run` 的输出文本：它走 stderr，而且是给人看的措辞，
    // 版本之间会变；祖先关系才是它真正依赖的那个事实。
    expect(git(a, 'merge-base', '--is-ancestor', 'HEAD', '@{u}')).toBe('')
  })
})
