import type { GitError, GitErrorKind } from './types.ts'

interface Raw {
  code: number
  stdout: string
  stderr: string
  timedOut: boolean
  message: string
}

/**
 * 失败归因。目的是让 UI 能给「可操作的提示」，
 * 比如 index.lock 残留要提示用户手动删，而不是把 stderr 原样甩出去。
 */
export function classifyError(raw: Raw): GitError {
  const text = `${raw.stderr}\n${raw.stdout}`.trim()
  const kind = detectKind(raw, text)
  return { kind, message: messageFor(kind, text, raw.message), ...(text ? { raw: text } : {}) }
}

function detectKind(raw: Raw, text: string): GitErrorKind {
  if (raw.timedOut) return 'timeout'

  const lower = text.toLowerCase()

  if (
    /could not read (?:username|password)|unable to get (?:username|password)|authentication failed|terminal prompts disabled|invalid username or password|access denied|403 forbidden|401 unauthorized/.test(
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
  if (
    /filename too long|path too long|cannot change to|specified path was too long|os error 206/.test(
      lower,
    )
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
      return 'git 命令超时，可能是网络卡住或远程很大'
    case 'auth':
      return '需要认证。私有仓库请先在终端里认证（推荐 gh auth login），git-nest 不会替你输入凭据'
    case 'network':
      return '连不上远程。检查网络、代理或 DNS'
    case 'locked':
      return '仓库被锁住了。多半是上一次 git 没跑完，手动删掉 .git/index.lock 再试'
    case 'path_too_long':
      return '路径超过 Windows 的长度上限（约 260 字符），git 进不去。把仓库移到浅一点的目录，或者开启系统的长路径支持（LongPathsEnabled）'
    case 'not_a_repo':
      return fallback
    default:
      return text ? firstLine(text) : fallback
  }
}

function firstLine(text: string): string {
  return text.split('\n').find((l) => l.trim().length > 0)?.trim() ?? 'git 执行失败'
}
