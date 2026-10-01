// 临时计量探针：数 getRepoStatus 在每个场景下起了几个 git 子进程。
// 用 PATH 里排在前面的 git shim 计数，不改生产代码。验完即删。
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { getRepoStatus } from './src/git/status.ts'

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'spawncount-')))
const shimDir = path.join(root, 'shim')
fs.mkdirSync(shimDir, { recursive: true })
const counter = path.join(root, 'count.txt')
fs.writeFileSync(counter, '0')

const realGit = execFileSync(process.platform === 'win32' ? 'where' : 'which', ['git'], {
  encoding: 'utf8',
})
  .split(/\r?\n/)[0]
  .trim()

/**
 * shim 用 Node 脚本写（`.cmd` 在 Windows 上经 execFile 的解析比较绕）。
 * 注意别自递归：用绝对路径直接调真正的 git。
 */
const shim = path.join(shimDir, 'git.js')
fs.writeFileSync(
  shim,
  [
    `import { spawnSync } from 'node:child_process'`,
    `import fs from 'node:fs'`,
    `const counter = ${JSON.stringify(counter)}`,
    `let n = 0`,
    `try { n = Number(fs.readFileSync(counter, 'utf8').trim()) || 0 } catch {}`,
    `fs.writeFileSync(counter, String(n + 1))`,
    `const r = spawnSync(${JSON.stringify(realGit)}, process.argv.slice(2), { stdio: 'inherit' })`,
    `process.exit(r.status ?? 1)`,
    '',
  ].join('\n'),
)

// 让 `git`（不带扩展名）能落到 git.js 上
fs.writeFileSync(
  path.join(shimDir, 'git.cmd'),
  `@node "%~dp0git.js" %*\r\n`,
)

const GIT = [
  '-c',
  'user.email=dev@git-nest.test',
  '-c',
  'user.name=test',
  '-c',
  'commit.gpgsign=false',
  '-c',
  'init.defaultBranch=main',
]
const git = (cwd, ...args) => execFileSync('git', [...GIT, ...args], { cwd, encoding: 'utf8' })
const count = () => Number(fs.readFileSync(counter, 'utf8').trim())

function commitFiles(dir, name) {
  fs.writeFileSync(path.join(dir, 'f.txt'), `${name}\n`)
  git(dir, 'add', '-A')
  git(dir, 'commit', '-m', name)
}

function makeRepo(name, setup) {
  const dir = path.join(root, name)
  fs.mkdirSync(dir, { recursive: true })
  git(dir, 'init', '-b', 'main')
  commitFiles(dir, '初始提交')
  if (setup) setup(dir)
  return dir
}

function makeClone(name) {
  const origin = path.join(root, `${name}-origin`)
  fs.mkdirSync(origin, { recursive: true })
  git(origin, 'init', '-b', 'main')
  commitFiles(origin, '初始提交')
  const clone = path.join(root, name)
  git(root, 'clone', origin, clone)
  return { origin, clone }
}

const scenarios = [
  ['无远程', () => makeRepo('plain')],
  ['有远程+上游', () => makeClone('cloned').clone],
  [
    '落后',
    () => {
      const { origin, clone } = makeClone('behind')
      commitFiles(origin, '远程新提交')
      return clone
    },
  ],
  ['脏工作区', () => makeRepo('dirty', (d) => fs.writeFileSync(path.join(d, 'x.txt'), 'x'))],
  [
    'detached',
    () => {
      const dir = makeRepo('detached')
      git(dir, 'checkout', '-q', git(dir, 'rev-parse', 'HEAD').trim())
      return dir
    },
  ],
  [
    '空仓库',
    () => {
      const dir = path.join(root, 'empty')
      fs.mkdirSync(dir, { recursive: true })
      git(dir, 'init', '-b', 'main')
      return dir
    },
  ],
]

const realPath = process.env.PATH
process.env.PATH = `${shimDir}${path.delimiter}${realPath}`

console.log('场景'.padEnd(14) + 'spawn 次数   状态')
console.log('-'.repeat(44))
for (const [name, build] of scenarios) {
  const dir = build()
  const before = count()
  const status = await getRepoStatus(dir)
  console.log(String(name).padEnd(14) + String(count() - before).padEnd(12) + status.status)
}

process.env.PATH = realPath
fs.rmSync(root, { recursive: true, force: true })
