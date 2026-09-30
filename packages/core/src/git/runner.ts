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
  /** 仓库目录，等价于 git -C <dir> */
  cwd: string
  timeoutMs?: number
  env?: Record<string, string>
}

export interface GitResult {
  code: number
  stdout: string
  stderr: string
  timedOut: boolean
}

/** 每次调用都要带的配置：禁掉交互式凭证 */
const CONFIG_ARGS = ['-c', 'credential.interactive=false', '-c', 'core.askPass=']

export function runGit(args: string[], options: RunOptions): Promise<GitResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const finalArgs = [...CONFIG_ARGS, ...args]

  return new Promise<GitResult>((resolve) => {
    execFile(
      'git',
      finalArgs,
      {
        cwd: options.cwd,
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
        if (!error) return resolve({ code: 0, stdout: out, stderr: err, timedOut: false })

        const killed = (error as { killed?: boolean }).killed === true
        const code = typeof (error as { code?: unknown }).code === 'number'
          ? ((error as { code: number }).code)
          : 1
        resolve({ code: killed ? 124 : code, stdout: out, stderr: err, timedOut: killed })
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
