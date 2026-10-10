import type { GitError, GitErrorKind } from './types.ts'

interface Raw {
  code: number
  stdout: string
  stderr: string
  timedOut: boolean
  message: string
}

/**
 * Windows 上 git 进不去的路径长度门槛。
 *
 * 240 这个数字刻意比 MAX_PATH（约 260）保守一截：实测 258 字符的目录**存在**，
 * 但 `git -C <它>` 直接 exit 128，带上 `core.longpaths=true` 也一样
 * ——那个选项救不了最初的 chdir。
 *
 * 放在这里（而不是只留在 inspect 层的探针里）：归因也要用它
 * ——`cannot change to` 这一个报错同时对应「路径太长」与「目录没了」两种情况。
 */
 const PATH_LENGTH_LIMIT = 240

/** 这个路径长到 git 进不去吗？（只有 Windows 有这个问题） */
export function isPathTooLong(path: string): boolean {
  return path.length > PATH_LENGTH_LIMIT && process.platform === 'win32'
}

/**
 * 把 URL 里内嵌的凭证抹掉：`https://user:token@host/x.git` → `https://***@host/x.git`。
 *
 * 为什么要在**归因的入口**做：`error.raw` 会带着 stderr 原文落进
 * `update_checks.detail`（SQLite），也会顺 HTTP 回到前端。remote 地址里内嵌
 * `user:token@` 时，那条错误就是唯一会把 token 写进库的通道。
 * 只脱敏「有冒号（＝有密码）」的形式：`ssh://git@host/x`、`git@host:x` 这种
 * 只有用户名的正常写法要原样留着，否则排查时看不出访问的是谁。
 */
 function redactCredentials(text: string): string {
  return text.replace(/([a-z][a-z0-9+.-]*:\/\/)[^/\s@]+:[^/\s@]*@/gi, '$1***@')
}

/**
 * 失败归因。目的是让 UI 能给「可操作的提示」，
 * 比如 index.lock 残留要提示用户手动删，而不是把 stderr 原样甩出去。
 */
export function classifyError(raw: Raw): GitError {
  const text = redactCredentials(`${raw.stderr}\n${raw.stdout}`.trim())
  const kind = detectKind(raw, text)
  return { kind, message: messageFor(kind, text, raw.message), ...(text ? { raw: text } : {}) }
}

function detectKind(raw: Raw, text: string): GitErrorKind {
  if (raw.timedOut) return 'timeout'

  const lower = text.toLowerCase()

  /*
    HTTP 状态码要在 network 之前判：git 对「401/403」和「连不上」都用同一个前缀
    `fatal: unable to access '<url>': ...`，而 network 那条正则含 `unable to access`
    ——顺序反了的话，私有仓库返回 401 会被报成「连不上远程，检查网络、代理或 DNS」，
    正好把人引向错的方向——把原因说反，比不说更坏。
  */
  if (
    /could not read (?:username|password)|unable to get (?:username|password)|authentication failed|terminal prompts disabled|invalid username or password|access denied|the requested url returned error: ?(?:401|403)|403 forbidden|401 unauthorized/.test(
      lower,
    )
  ) {
    return 'auth'
  }
  if (
    /could not resolve host|connection (?:timed out|refused|reset)|network is unreachable|failed to connect|ssl certificate problem|temporary failure in name resolution|early eof|unable to access/.test(
      lower,
    )
  ) {
    return 'network'
  }
  if (/index\.lock|unable to create .*\.lock|cannot lock ref|reference already exists/.test(lower)) {
    return 'locked'
  }

  /*
    「进不去这个目录」必须分两种，而 git 的文案分不出来：
    路径太长、目录被移动/删掉，报的都是
    `fatal: cannot change to '<dir>': No such file or directory`。
    判据只能是那个被引号括起来的路径**本身**有多长——把它当成路径太长，
    用户会去「把仓库移到浅一点的目录」（白折腾）；当成目录不存在，他才知道要重新指路。
  */
  const cannotChange = /cannot change to ['"]([^'"]*)['"]/i.exec(text)
  if (cannotChange) {
    return isPathTooLong(cannotChange[1] ?? '') ? 'path_too_long' : 'missing'
  }

  if (
    /filename too long|path too long|specified path was too long|os error 206/.test(lower)
  ) {
    return 'path_too_long'
  }
  if (/not a git repository|does not exist|no such file or directory/.test(lower)) {
    return 'not_a_repo'
  }
  return 'unknown'
}

function messageFor(kind: GitErrorKind, text: string, fallback: string): string {
  // 远程仓库不存在单独说：把它当成「要认证」会让人往错的方向修
  if (/repository .* not found|does not appear to be a git repository/i.test(text)) {
    return '远程仓库找不到。确认地址没写错；如果它是私有仓库，先在终端里认证（gh auth login）'
  }
  switch (kind) {
    case 'timeout':
      return 'git 命令超时被杀掉了（不是 git 自己报错，是我们按超时上限掐的）。多半是网络卡住或远程很大；私有仓库 / 大仓库可以在设置页把「git 超时」调大'
    case 'auth':
      return '需要认证。私有仓库请先在终端里认证（推荐 gh auth login），git-nest 不会替你输入凭据'
    case 'network':
      return '连不上远程。检查网络、代理或 DNS'
    case 'locked':
      return '仓库被锁住了。多半是上一次 git 没跑完，手动删掉 .git/index.lock 再试'
    case 'path_too_long':
      return '路径超过 Windows 的长度上限（约 260 字符），git 进不去。把仓库移到浅一点的目录，或者开启系统的长路径支持（LongPathsEnabled）'
    case 'missing':
      return '这个目录不在了（被移动、改名或删掉了）。用「编辑资料」把路径指到新位置，或者把它移出清单'
    case 'not_a_repo':
      return fallback
    default:
      return text ? firstLine(text) : fallback
  }
}

function firstLine(text: string): string {
  return text.split('\n').find((l) => l.trim().length > 0)?.trim() ?? 'git 执行失败'
}
