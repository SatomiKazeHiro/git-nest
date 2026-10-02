import { execFile } from 'node:child_process'
import { classifyError } from './errors.ts'

/**
 * 所有 git 调用都从这里走。硬规则照抄 github-kb（实测有效）：
 *
 * 1. 关掉一切凭证交互（GIT_TERMINAL_PROMPT=0 + credential.interactive=false + GIT_ASKPASS），
 *    私有仓库弹凭证框会把整个进程挂死
 * 2. 单命令硬超时，默认 120s
 * 3. 用 execFile + argv 数组传参，不走 shell：路径与 ref 一律不用手动加引号，
 *    也就不存在引号被绕过导致的命令注入
 * 4. 探测命令逐个执行、单独判退出码：「没有上游」「detached HEAD」是预期内的非零退出
 */

export const DEFAULT_TIMEOUT_MS = 120_000

export interface RunOptions {
  /** 仓库目录，等价于 git -C &lt;dir&gt; */
  cwd: string
  timeoutMs?: number
  env?: Record<string, string>
  /**
   * 谁发起的这次调用（`auto-fetch` / `check` / `pull` / `status` …）。
   * 只进命令日志，不影响行为。见 `CommandLogEntry.label`。
   */
  label?: string
}

export interface GitResult {
  code: number
  stdout: string
  stderr: string
  timedOut: boolean
}

/**
 * 每次调用都要带的配置。
 *
 * `credential.helper=` 是实测出来的关键：只设 GIT_TERMINAL_PROMPT=0 是不够的，
 * 遇到要密码的远程时 git 仍会卡在凭证链上直到超时（实测挂住 8 秒以上无任何输出），
 * 把 helper 清空之后它会立即报「unable to get password from user」。
 * 这一条决定了「批量检查更新」不会因为一个私有仓库整体卡死。
 */
const CONFIG_ARGS = [
  '-c',
  'credential.interactive=false',
  '-c',
  'credential.helper=',
  // core.askPass= 只是双保险，真正起作用的是上面那条 + GIT_ASKPASS
  '-c',
  'core.askPass=',
  // Windows 上 MAX_PATH 约 260 字符，深目录仓库会超；临时打开长路径支持
  '-c',
  'core.longpaths=true',
]

/**
 * 起了多少次 git 子进程。
 *
 * Windows 上每条 git 命令要几百毫秒，所以「一个仓库要跑几条命令」直接决定
 * 批量操作的耗时。状态读取一度是每个仓库 6–7 条，这里留个计数器给测试用，
 * 免得以后又悄悄涨回去。
 */
let spawnCount = 0

export function gitSpawnCount(): number {
  return spawnCount
}

export function resetGitSpawnCount(): void {
  spawnCount = 0
}

/**
 * 命令日志：**最近执行过的 git 命令，记在内存里，供排查用**。
 *
 * 为什么要有它：这个软件会**自己联网**（自动 fetch）。自动做的事如果不留痕，
 * 用户没法知道它到底跑了什么、什么时候跑的、有没有失败。日志只记「执行过什么」，
 * 不是审计系统——重启就没了，也只留最近 `COMMAND_LOG_LIMIT` 条。
 *
 * `label` 是「谁发起的」（比如 `auto-fetch` / `check` / `status`）。没有它就只是
 * 一堆看不出上下文的命令，等于没记。
 */
export interface CommandLogEntry {
  at: string
  /** 发起者：auto-fetch / check / pull / status … 未知时为空串 */
  label: string
  /** 去掉固定配置项之后的实参（那些每条都一样，记了只是噪音） */
  args: string[]
  /** 仓库目录 */
  cwd: string
  code: number
  ms: number
  timedOut: boolean
}

const COMMAND_LOG_LIMIT = 1000
const commandLog: CommandLogEntry[] = []

/** 最近执行的命令，**新的在后**。 */
export function recentCommands(): readonly CommandLogEntry[] {
  return commandLog
}

export function clearCommandLog(): void {
  commandLog.length = 0
}

function record(entry: CommandLogEntry): void {
  commandLog.push(entry)
  // 环形缓冲：只留最近 N 条，长时间跑的服务也不会无限涨
  if (commandLog.length > COMMAND_LOG_LIMIT) {
    commandLog.splice(0, commandLog.length - COMMAND_LOG_LIMIT)
  }
}

export function runGit(args: string[], options: RunOptions): Promise<GitResult> {
  spawnCount += 1
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const startedAt = Date.now()
  // 用 -C 而不是 spawn 的 cwd：cwd 走的是 OS 的 SetCurrentDirectory，
  // 路径超过 MAX_PATH 时会直接 spawn 失败（ENOENT），而 -C 是把路径交给 git 自己处理。
  // 跨平台通用，也和 github-kb 的做法一致。
  const finalArgs = [...CONFIG_ARGS, '-C', options.cwd, ...args]

  return new Promise<GitResult>((resolve) => {
    execFile(
      'git',
      finalArgs,
      {
        timeout: timeoutMs,
        killSignal: 'SIGKILL',
        maxBuffer: 32 * 1024 * 1024,
        windowsHide: true,
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: '0',
          GIT_ASKPASS: 'echo',
          // 让 git 的报错信息稳定在英文，归因逻辑才好写
          LC_ALL: 'C',
          ...options.env,
        },
      },
      (error, stdout, stderr) => {
        const out = stdout.toString()
        const err = stderr.toString()
        const finish = (code: number, timedOut: boolean) => {
          record({
            at: new Date().toISOString(),
            label: options.label ?? '',
            args,
            cwd: options.cwd,
            code,
            ms: Date.now() - startedAt,
            timedOut,
          })
          resolve({ code, stdout: out, stderr: err, timedOut })
        }
        if (!error) return finish(0, false)

        const killed = (error as { killed?: boolean }).killed === true
        const code = typeof (error as { code?: unknown }).code === 'number'
          ? ((error as { code: number }).code)
          : 1
        finish(killed ? 124 : code, killed)
      },
    )
  })
}

/** 探针：只关心成功与否与输出，失败时返回 null 而不是抛错。 */
export async function probe(
  args: string[],
  options: RunOptions,
): Promise<{ ok: true; stdout: string } | { ok: false; result: GitResult }> {
  const result = await runGit(args, options)
  if (result.code === 0) return { ok: true, stdout: result.stdout }
  return { ok: false, result }
}

/** 把失败的 git 结果转成带归因的错误对象。 */
export function toGitError(result: GitResult, fallbackMessage: string) {
  return classifyError({
    timedOut: result.timedOut,
    code: result.code,
    stderr: result.stderr,
    stdout: result.stdout,
    message: fallbackMessage,
  })
}
