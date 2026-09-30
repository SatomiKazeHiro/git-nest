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
    /could not read (?:username|password)|authentication failed|terminal prompts disabled|invalid username or password|access denied|403 forbidden|401 unauthorized|repository not found/.test(
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
  if (/not a git repository|does not exist|no such file or directory/.test(lower)) {
    return 'not_a_repo'
  }
  return 'unknown'
}

function messageFor(kind: GitErrorKind, text: string, fallback: string): string {
  switch (kind) {
    case 'timeout':
      return 'git 命令超时，可能是网络卡住或远程很大'
    case 'auth':
      return '需要认证。私有仓库请先在终端里认证（推荐 gh auth login），git-nest 不会替你输入凭据'
    case 'network':
      return '连不上远程。检查网络、代理或 DNS'
    case 'locked':
      return '仓库被锁住了。多半是上一次 git 没跑完，手动删掉 .git/index.lock 再试'
    case 'not_a_repo':
      return fallback
    default:
      return text ? firstLine(text) : fallback
  }
}

function firstLine(text: string): string {
  return text.split('\n').find((l) => l.trim().length > 0)?.trim() ?? 'git 执行失败'
}
