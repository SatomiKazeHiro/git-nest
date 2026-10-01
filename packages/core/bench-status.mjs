/**
 * 列表页读取路径的基准：`full` 档 vs `lean` 档。
 *
 * 为什么留这个脚本：两档的差别（要不要读工作区、要不要读最后提交）是列表页
 * 从 7.8 秒降到 1 秒级的全部原因，而这个差别只有真仓库、真磁盘、真 Windows
 * 进程启动才量得出来——单测只能钉住「起了几条命令」，钉不住墙钟时间。
 *
 *   node packages/core/bench-status.mjs [仓库根目录] [并发]
 *
 * 缺省拿 `D:\Git\experiments` 下的真仓库；那个目录不在就跳过（CI 上没有）。
 * 每次先跑一遍丢弃，那是冷启动（模块初始化 + 文件系统缓存未热），量它没有意义。
 */
import fs from 'node:fs'
import path from 'node:path'
import { Scheduler } from './src/git/scheduler.ts'
import { readRepoStatuses } from './src/git/inspect/index.ts'
import { gitSpawnCount, resetGitSpawnCount } from './src/git/runner.ts'

const root = process.argv[2] ?? 'D:\\Git\\experiments'
const concurrency = Number(process.argv[3] ?? 8)

if (!fs.existsSync(root)) {
  console.log(`跳过：基准目录 ${root} 不存在（这个脚本只在有真仓库的机器上有意义）`)
  process.exit(0)
}

const repos = fs
  .readdirSync(root, { withFileTypes: true })
  .filter((d) => d.isDirectory() && fs.existsSync(path.join(root, d.name, '.git')))
  .map((d) => path.join(root, d.name))

if (repos.length === 0) {
  console.log(`跳过：${root} 下没有 git 仓库`)
  process.exit(0)
}

async function bench(profile) {
  const scheduler = new Scheduler({ concurrency })
  resetGitSpawnCount()
  const t = process.hrtime.bigint()
  const statuses = await readRepoStatuses(repos, { scheduler, profile })
  return { ms: Number(process.hrtime.bigint() - t) / 1e6, spawns: gitSpawnCount(), statuses }
}

console.log(`仓库 ${repos.length} 个，并发 ${concurrency}\n`)
await bench('lean') // 冷启动丢弃

const results = {}
for (const profile of ['full', 'lean']) {
  const runs = []
  let last = null
  for (let i = 0; i < 3; i++) {
    last = await bench(profile)
    runs.push(last.ms)
  }
  results[profile] = last
  console.log(
    `${profile.padEnd(5)} 最好 ${Math.min(...runs).toFixed(0).padStart(5)}ms  ` +
      `三次 ${runs.map((r) => r.toFixed(0)).join('/')}ms  ` +
      `共 ${last.spawns} 次 git 启动（每仓库 ${(last.spawns / repos.length).toFixed(2)}）`,
  )
}

const [full, lean] = [results.full, results.lean]
console.log(
  `\nlean 比 full 快 ${(full.ms / lean.ms).toFixed(1)} 倍，` +
    `少起 ${full.spawns - lean.spawns} 次进程（每仓库少 ${((full.spawns - lean.spawns) / repos.length).toFixed(1)} 次）`,
)

console.log('\n逐仓库结论（full vs lean，* = 不一致）：')
const leanByPath = new Map(lean.statuses.map((s) => [s.path, s]))
let differing = 0
for (const f of full.statuses) {
  const l = leanByPath.get(f.path)
  const same = f.status === l?.status
  if (!same) differing++
  console.log(
    ` ${same ? ' ' : '*'} ${path.basename(f.path).padEnd(24)} full=${f.status.padEnd(12)} ` +
      `lean=${(l?.status ?? '?').padEnd(12)} ↑${f.ahead ?? '-'} ↓${f.behind ?? '-'}` +
      (f.dirty ? `  [full 脏 ${f.dirtyCount}]` : ''),
  )
}

console.log(
  differing === 0
    ? '\n结论：两档状态结论完全一致'
    : `\n结论：${differing} 个仓库结论不同 —— 差异应全部来自 lean 不读的 dirty（` +
        `即 full=dirty 而 lean 报远程状态）。若不是这个形态，说明两档在别的字段上分了叉。`,
)
