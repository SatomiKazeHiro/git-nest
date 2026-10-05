/**
 * 「仓库元信息」的库实现：isomorphic-git（纯 JS，MIT）。
 *
 * **这一层绝不 spawn 进程。** Windows 上起一次 git.exe 约 70ms（20ms 是
 * CreateProcess 的地板），列表页十几个仓库就是好几秒——而这里读的每一条
 * （分支名、HEAD、上游配置、origin 地址）都只是读 `.git` 下的几个小文件，
 * 实测 0.5–3ms。
 *
 * 明确的边界（探针实测；这些边界由 `test/git/status-spawns.test.ts` 的
 * 「一条都不起」用例与 `test/git/status-equivalence.test.ts` 的行为等价表钉着）：
 *
 * - **不读对象**。`git.readObject` 要解析整个 pack index，290MB 的仓库上
 *   首次约 480ms、且 isomorphic-git 每次调用都新建 FileSystem（缓存不跨调用），
 *   于是每次都是 480ms —— 比 spawn 一次 git 还慢，所以这里一次都不用。
 *   代价：HEAD 指向一个**悬空**引用（refs 在、对象不在）时会误判成「有提交」。
 *   这种仓库本来就是坏的，真 git 报的也是这一类错误，不是 `no_commits`。
 * - **`upstreamGone` 只判「引用解析不出来」**。引用在、但对象从没 fetch 过
 *   （浅克隆或手工写坏 ref）这一种判不出来——库里查不到就得读对象，
 *   而读对象太贵。`via-cli.ts` 的 `rev-list` 会把这一种补上，索引层以它为准。
 */

import git from 'isomorphic-git'
import fs from 'node:fs'
import type { GitFactsError, InspectOptions, RepoFacts, RepoInspector } from './types.ts'

/** 这个目录不存在的报错。Windows 上是 ENOENT，别处可能是别的码，宽度放宽到「找不到」。 */
function isNotFound(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code
  return code === 'ENOENT' || code === 'NotFoundError'
}

/**
 * 借 `currentBranch` 判断「这是不是一个能读的仓库」。
 *
 * 它内部会走 `discoverGitdir`（认得 `.git` 文件、也认得 worktree 的 gitdir 指针），
 * 非仓库/目录不存在时抛 `NotFoundError`。`getConfig` 判不出来——它在这些情况下
 * 安静地返回 undefined，跟「仓库没问题、只是没配这个键」长得一模一样。
 */
async function classify(path: string, err: unknown): Promise<GitFactsError> {
  const isDir = await fs.promises
    .stat(path)
    .then((s) => s.isDirectory())
    .catch(() => false)

  if (!isDir) {
    return { kind: 'missing', message: '目录不在了' }
  }
  if (isNotFound(err)) {
    return { kind: 'not_a_repo', message: '这个目录不是 git 仓库' }
  }
  return {
    kind: 'unknown',
    message: `读不出仓库信息：${(err as Error)?.message ?? String(err)}`.slice(0, 200),
  }
}

/** `getConfig` 在「目录不存在」「键不存在」两种情况下都返回 undefined/null，统一成 null。 */
async function readConfig(dir: string, key: string): Promise<string | null> {
  try {
    const value = await git.getConfig({ fs, dir, path: key })
    const text = typeof value === 'string' ? value.trim() : ''
    return text.length > 0 ? text : null
  } catch {
    return null
  }
}

export const readRepoFacts: RepoInspector = async (
  dir: string,
  _options: InspectOptions = {},
): Promise<RepoFacts> => {
  const empty: RepoFacts = {
    isRepo: false,
    branch: null,
    detached: false,
    hasCommits: false,
    upstream: null,
    upstreamGone: false,
    remoteUrl: null,
    error: null,
  }

  let branch: string | null = null
  try {
    // fullname: false → 拿短名（`feat/foo` 而不是 `refs/heads/feat/foo`）。
    // 空仓库（HEAD 指向不存在的 ref）在这里也是 undefined，跟 detached 同一个出口，
    // 靠下面的 hasCommits 区分——前者没有提交，后者有。
    const raw = await git.currentBranch({ fs, dir, fullname: false })
    branch = typeof raw === 'string' && raw.length > 0 ? raw : null
  } catch (err) {
    return { ...empty, error: await classify(dir, err) }
  }

  // HEAD 解析得出来 = 有提交。空仓库/悬空引用会抛 NotFoundError。
  let headOid: string | null = null
  try {
    headOid = await git.resolveRef({ fs, dir, ref: 'HEAD' })
  } catch {
    headOid = null
  }
  // 空仓库时 resolveRef 直接失败；正常的 HEAD 一定是 40 位十六进制。
  // 拿不到 40 位十六进制就不是一个可用的 HEAD（悬空符号引用也走这里）。
  const hasCommits = headOid !== null && /^[0-9a-f]{40}$/i.test(headOid)

  const remoteUrl = await readConfig(dir, 'remote.origin.url')

  // 上游：git 里只有这两条 config 同时存在才算配了上游，少一条 git 自己也当没配。
  let upstream: string | null = null
  let upstreamGone = false
  if (branch !== null) {
    const remote = await readConfig(dir, `branch.${branch}.remote`)
    const merge = await readConfig(dir, `branch.${branch}.merge`)
    if (remote !== null && merge !== null) {
      // `refs/heads/x` → `refs/remotes/<remote>/x`。ref 名允许斜杠，直接拼就行。
      const short = merge.replace(/^refs\/heads\//, '')
      if (remote === '.') {
        /*
          上游是**本机另一个分支**（`git branch -u main` 写进 config 的就是
          `remote = .` + `merge = refs/heads/main`）。这一种绝不能去拼
          `refs/remotes/./main` —— 那必然解析不出来，于是把「上游是本机分支」
          误报成「上游被远程删掉了」（gone），而 gone 给用户的建议是
          「重新 push -u 或删掉本地分支」——**假警报引向真破坏**。

          这里不做第二遍存在性判断：本地分支真被删了的话，CLI 那条
          `rev-list HEAD...@{u}` 会失败并被认成 upstreamGone（见 via-cli.ts），
          判定权交给它，一处一个判据。
        */
        upstream = short
      } else {
        const ref = `refs/remotes/${remote}/${short}`
        try {
          await git.resolveRef({ fs, dir, ref })
          upstream = `${remote}/${short}`
        } catch {
          // 引用解析不出来 = 远程已经把这个分支删了（fetch --prune 之后就是这个形态）
          upstreamGone = true
        }
      }
    }
  }

  return {
    isRepo: true,
    branch,
    detached: branch === null,
    hasCommits,
    upstream,
    upstreamGone,
    remoteUrl,
    error: null,
  }
}
