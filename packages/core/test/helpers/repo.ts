import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** 测试里真的建 git 仓库，不 mock git：行为要和终端里一致才算数。 */

const IDENTITY = [
  '-c',
  'user.email=dev@git-nest.test',
  '-c',
  'user.name=git-nest test',
  '-c',
  'commit.gpgsign=false',
  '-c',
  'init.defaultBranch=main',
  '-c',
  'core.autocrlf=false',
]

export function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', [...IDENTITY, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' },
  })
}

export function tempDir(prefix = 'git-nest-'): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)))
}

export function write(dir: string, name: string, content: string): void {
  fs.writeFileSync(path.join(dir, name), content, 'utf8')
}

export function commit(dir: string, message: string, file = 'file.txt'): string {
  write(dir, file, `${message}\n`)
  git(dir, 'add', '-A')
  git(dir, 'commit', '-m', message)
  return git(dir, 'rev-parse', 'HEAD').trim()
}

/** 一个干净的单仓库，有 1 个提交，没有远程。 */
export function initRepo(message = 'first commit'): string {
  const dir = path.join(tempDir(), 'repo')
  fs.mkdirSync(dir, { recursive: true })
  git(dir, 'init', '-b', 'main')
  write(dir, 'README.md', '# demo\n\n一个用来测试的小仓库。\n')
  commit(dir, message)
  return dir
}

/** origin + clone，clone 落后 origin 若干提交（不 fetch）。 */
export function initClone(behindBy = 0): { origin: string; clone: string } {
  const root = tempDir()
  const origin = path.join(root, 'origin')
  fs.mkdirSync(origin, { recursive: true })
  git(origin, 'init', '-b', 'main')
  write(origin, 'README.md', '# origin\n\n远程仓库。\n')
  commit(origin, '初始提交')

  for (let i = 0; i < behindBy; i++) commit(origin, `远程提交 ${i + 1}`)

  const clone = path.join(root, 'clone')
  git(root, 'clone', origin, 'clone')
  return { origin, clone }
}

export function cleanup(...dirs: string[]): void {
  for (const dir of dirs) {
    try {
      fs.rmSync(dir, { recursive: true, force: true })
    } catch {
      // Windows 上文件句柄偶尔还开着，测试清理失败不该让整轮挂掉
    }
  }
}
