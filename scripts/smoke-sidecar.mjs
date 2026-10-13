// 临时冒烟测试（跑完就删，不属于交付物）：
// 把 sidecar 产物整份复制到一个**仓库外面**的临时目录，在那里拉起来真发一次 HTTP 请求。
//
// 为什么要复制出去：如果就地跑 `node src-tauri/binaries/git-nest-server/index.mjs`，
// Node 的模块解析会沿着目录树往上走，`better-sqlite3` 会命中**仓库根或 apps/server 的
// node_modules**——那样绿了也证明不了「随包能起」，因为随包形态下那些目录根本不存在。
// 复制到 %TEMP% 之后，最近的祖先里只有随包带的那份，才是有鉴别力的测试。
import { spawn } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const repoRoot = 'D:\\Git\\personal\\git-nest'
const binDir = path.join(repoRoot, 'src-tauri', 'binaries')
const resources = path.join(binDir, 'node-resources', 'git-nest-server')

// 端口从 core 读，别写死
const typesSource = readFileSync(path.join(repoRoot, 'packages', 'core', 'src', 'types.ts'), 'utf8')
const at = typesSource.indexOf('DEFAULT_PORTS')
const apiPort = Number(/api\s*:\s*(\d+)/.exec(typesSource.slice(at, typesSource.indexOf('}', at)))[1])

const root = mkdtempSync(path.join(tmpdir(), 'git-nest-isolated-'))
/*
  复刻**打包后的落点**，而不是照抄仓库里的目录形状：

  - externalBin（Node 运行时）被 Tauri 放进可执行文件所在目录 → root/git-nest-server.exe
  - resources 被解到资源目录 → root/git-nest-server/
*/
const exeName = 'git-nest-server-x86_64-pc-windows-msvc.exe'
const copied = path.join(root, 'git-nest-server')
cpSync(resources, copied, { recursive: true })
cpSync(path.join(binDir, exeName), path.join(root, exeName))
// 反向对照：`--no-native` 故意抽掉随包的原生模块，用来证明上面那次绿**真的是**
// 靠随包那份跑起来的（红了才说明这个测试有鉴别力），而不是靠临时目录外面的什么东西。
if (process.argv.includes('--no-native')) {
  rmSync(path.join(copied, 'node_modules'), { recursive: true, force: true })
  console.log('[smoke] 反向对照：已删除随包的 node_modules（预期这次会失败）')
}
const dbFile = path.join(root, 'smoke.db')

const variant = process.argv[2] // 'bin' | 'node'
const command = variant === 'bin' ? path.join(root, exeName) : process.execPath
// 脚本路径一律给**绝对**路径：壳那边也是这么传的（Tauri 的 sidecar API 用 exe 所在目录
// 当工作目录，所以相对路径在真机上也许能碰巧 work，但这里必须按真实契约来测）。
const args = variant === 'bin' ? [path.join(copied, 'run.cjs')] : [path.join(copied, 'index.mjs')]

console.log(`[smoke] 隔离目录 ${root}`)
console.log(`[smoke] 变体=${variant} 命令=${path.basename(command)}`)
const child = spawn(command, args, {
  cwd: root, // 也不在仓库里
  // PATH 保持原样（Node 自己要跑 git 子进程时得找得到 git），但 NODE_PATH 清掉，
  // 不留任何「帮它找到仓库依赖」的后门。
  env: { ...process.env, NODE_PATH: '', GIT_NEST_PORT: String(apiPort), GIT_NEST_DB: dbFile },
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
})

let out = ''
child.stdout.on('data', (b) => {
  out += b.toString()
})
child.stderr.on('data', (b) => {
  out += b.toString()
})

const deadline = Date.now() + 30_000
let result = null
while (Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 400))
  try {
    const res = await fetch(`http://127.0.0.1:${apiPort}/api/health`)
    if (res.ok) {
      result = await res.json()
      break
    }
  } catch {
    /* 还没起来 */
  }
  if (child.exitCode !== null) break
}

console.log(`[smoke] 进程 exitCode=${child.exitCode}`)
console.log(`[smoke] /api/health => ${JSON.stringify(result)}`)
console.log(`[smoke] 数据库文件已创建=${existsSync(dbFile)}`)
if (result === null) {
  console.log('[smoke] —— 子进程输出 ——')
  console.log(out.slice(-3000))
}

child.kill()
await new Promise((r) => setTimeout(r, 600))
rmSync(root, { recursive: true, force: true })
process.exit(result === null ? 1 : 0)
