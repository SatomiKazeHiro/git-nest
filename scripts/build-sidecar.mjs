#!/usr/bin/env node
/**
 * 把 `apps/server` 打成一份**可分发**的 sidecar 目录。
 *
 * ## 为什么需要它
 *
 * 今天服务端只有 `tsx watch src/index.ts`——那是 dev 专用形态：要有 node_modules、
 * 要有 tsx、要能读 `.ts`。Tauri 壳要「装完就能用」，服务就必须是一份自成一体、
 * 不依赖仓库的产物。这个脚本产出：
 *
 * ```
 * src-tauri/binaries/git-nest-server/
 *   git-nest-server-<target-triple>.exe   ← Tauri 的 externalBin（真正被 exec 的那支）
 *   index.mjs                             ← 打包后的服务（esbuild，单文件）
 *   run.cjs                               ← sidecar 入口：把 index.mjs 拉起来
 *   node.exe                              ← Node 运行时（随包分发，不依赖用户装 Node）
 *   node_modules/better-sqlite3/          ← 原生模块（.node 是二进制，打不进 bundle）
 *   node_modules/bindings/                ← better-sqlite3 运行时唯一的外部依赖
 * ```
 *
 * ## 为什么是「一个 exe 转发到一个脚本」而不是「一个 exe 干完」
 *
 * Tauri 的 `externalBin` 只接受**单个可执行文件**，没有「命令行参数」这一说，
 * 而 Node 要跑一个脚本必须把脚本路径传给它。所以要有一支薄的 exe 来拼这个命令行。
 * 那支 exe 就是当前平台的 Node 本体（复制过来），真正的入口是它旁边的 `run.cjs`。
 *
 * 代价（说清楚，别以为它没有）：这支 exe 就是**当前平台**的 Node，所以产物是
 * 平台相关的，交叉打包要先换一份对应平台的 Node。这一版只做本机平台。
 *
 * ## better-sqlite3 为什么必须留在 bundle 外面
 *
 * 它的 `lib/index.js` 最后 `require('bindings')('better_sqlite3.node')`——
 * 一个真正的 `.node` 二进制，esbuild 打不进去。它的运行时依赖只有 `bindings`
 * （纯 JS，无子依赖）与 `node:fs` / `node:path`，所以照抄这两包就够，`prebuild-install`
 * 是安装期的依赖、运行时用不到，不抄。
 *
 * 用法：node scripts/build-sidecar.mjs
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import * as esbuild from 'esbuild'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
/*
  解析锚点必须是 **apps/server**，不能是仓库根。

  理由：pnpm 的 node_modules 不是扁平的——`better-sqlite3` 只挂在
  `apps/server/node_modules` 下，仓库根根本解析不到它。用脚本自己的
  `createRequire(import.meta.url)` 会得到 `Cannot find module 'better-sqlite3/package.json'`，
  而那个报错看起来像「没装依赖」，实际是「问错了地方」。
*/
const serverRequire = createRequire(path.join(repoRoot, 'apps', 'server', 'package.json'))

/*
  产物分两处，**这是 Tauri 的路径规则逼出来的，不是随手分的**：

  - `externalBin` 的路径是相对 **`src-tauri/`**（不是相对 `tauri.conf.json` 所在目录——
    两者恰好同层所以极易混），而且必须写成 `<前缀>/<名字>`，Tauri 补的
    `-<target-triple>.exe` 是补在**整个路径的末尾**。所以
    `externalBin: ["binaries/git-nest-server"]` 要求文件真的叫
    `src-tauri/binaries/git-nest-server-<triple>.exe`。第一版写成了
    `binaries/git-nest-server/git-nest-server-<triple>.exe`，构建报
    `resource path ... doesn't exist`——**实测教训**。
  - 其余运行时文件走 `bundle.resources`。resources 里那条 glob 一旦带上前缀目录，
    那个前缀会被**剥掉**再落进资源目录，所以这里多包一层 `node-resources/`：
    它在资源目录里被剥掉，`resource_dir()/git-nest-server/index.mjs` 就能直接对上。
*/
const binDir = path.join(repoRoot, 'src-tauri', 'binaries')
const stageDir = path.join(binDir, 'node-resources', 'git-nest-server')
const expressDir = path.join(stageDir, 'node_modules')

/**
 * 端口从 core 读，不在这里写数字。
 *
 * 这份产物自己也要知道该监听哪个端口——但它**不是**权威：权威是
 * `packages/core/src/types.ts` 的 `DEFAULT_PORTS`。Rust 侧那份常量由
 * `src-tauri/build.rs` 从同一个文件生成，所以两边不会飘。
 */
function corePorts() {
  const source = readFileSync(path.join(repoRoot, 'packages', 'core', 'src', 'types.ts'), 'utf8')
  const at = source.indexOf('DEFAULT_PORTS')
  if (at < 0) throw new Error('core 的 types.ts 里找不到 DEFAULT_PORTS')
  const body = source.slice(at, source.indexOf('}', at))
  const read = (key) => {
    const match = new RegExp(`${key}\\s*:\\s*(\\d+)`).exec(body)
    if (!match) throw new Error(`DEFAULT_PORTS 里找不到 ${key}`)
    return Number(match[1])
  }
  return { web: read('web'), api: read('api') }
}

/** 当前平台的 target triple。Tauri 的 externalBin 靠这个后缀找对应平台的二进制。 */
function targetTriple() {
  const result = spawnSync('rustc', ['--print', 'host-tuple'], { encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(`跑 rustc --print host-tuple 失败：${result.stderr || result.error}`)
  }
  return result.stdout.trim()
}

/**
 * 解析一个包的真实目录（pnpm 下是符号链接，要拿到 store 里的真身）。
 *
 * `anchorFile` 决定「从谁的视角去找这个包」——pnpm 的 node_modules 不是扁平的，
 * 同一个包从不同锚点看到的结果不同（`bindings` 从 `apps/server` 就看不到，
 * 它只挂在 `better-sqlite3` 自己那个虚拟目录下）。
 * 默认从 `apps/server` 找，因为服务端依赖都是装在那里的。
 */
function resolvePackageDir(spec, anchorFile = path.join(repoRoot, 'apps', 'server', 'package.json')) {
  return path.dirname(createRequire(anchorFile).resolve(`${spec}/package.json`))
}

const ports = corePorts()
const triple = targetTriple()
const isWindows = process.platform === 'win32'
const exeSuffix = isWindows ? '.exe' : ''

// 每次都从零开始：上一次的残留（换平台、换版本、或改了目录布局）比重新构建更危险。
// 整个 binaries/ 都是这个脚本的地盘，所以整棵删掉重建——只删 stageDir 会留下旧布局的
// 孤儿文件（实测：改布局那次就留下了旧的 binaries/git-nest-server/ 一整份）。
rmSync(binDir, { recursive: true, force: true })
mkdirSync(expressDir, { recursive: true })

// ---- 1. 服务端本体：esbuild 打成单文件 ESM ----
//
// better-sqlite3 标成 external（原生 .node 打不进去）。它会被解析到的位置是
// **运行时** Node 去找的位置：`index.mjs` 同级目录下的 `node_modules/`，
// 所以下面第 2 步把 JS 与已编译的 .node 一起摆到那里。
//
// 试过但行不通的一条：用 esbuild 的 `alias` 把 `better-sqlite3` 指到暂存目录。
// alias 的改写发生在 external 判定之前，于是 esbuild 反过来去**解析文件**
// （"was remapped to … which then couldn't be resolved"），而那个目录本来就
// 不该在打包期存在。留着这条注释是为了下一个人不再试一遍。
const bundlePath = path.join(stageDir, 'index.mjs')
await esbuild.build({
  entryPoints: [path.join(repoRoot, 'apps', 'server', 'src', 'index.ts')],
  outfile: bundlePath,
  bundle: true,
  platform: 'node',
  // 跟着根 package.json 的 engines（node >= 22）走：产物不必兼容更老的 Node
  target: 'node22',
  format: 'esm',
  sourcemap: false,
  // 原生模块与它的 loader 必须留在外面（见文件头注释）
  external: ['better-sqlite3', 'bindings'],
  /*
    `banner` 这一行是**必须的**，不是装饰。

    Fastify 与它的一串依赖（avvio 等）是 CommonJS，esbuild 把它们内联进 ESM 产物后，
    它们的 `require('node:events')` 会被改写成 esbuild 自己的 `__require` 兜底，
    而那个兜底在 ESM 里只会抛
    `Dynamic require of "node:events" is not supported` —— 服务**起不来**。
    （实测：不加这行，`node index.mjs` 直接就是这个错。）

    加一个真的 `require` 到产物顶部的词法作用域里，esbuild 的兜底就会转而用它。
    这是 esbuild 官方 FAQ 对「bundle 到 ESM 时 CJS 依赖要 require」给的解法。
  */
  banner: {
    js: "import { createRequire as __gitNestCreateRequire } from 'node:module'; const require = __gitNestCreateRequire(import.meta.url);",
  },
  logLevel: 'info',
})

// ---- 2. 原生模块：better-sqlite3 的 JS 部分 + 已编译的 .node ----
const sqliteSource = resolvePackageDir('better-sqlite3')
const betterSqliteDir = path.join(expressDir, 'better-sqlite3')
mkdirSync(betterSqliteDir, { recursive: true })
const sqliteVersion = JSON.parse(readFileSync(path.join(sqliteSource, 'package.json'), 'utf8')).version
cpSync(path.join(sqliteSource, 'package.json'), path.join(betterSqliteDir, 'package.json'))
cpSync(path.join(sqliteSource, 'lib'), path.join(betterSqliteDir, 'lib'), { recursive: true })
const prebuilt = path.join(sqliteSource, 'build', 'Release', 'better_sqlite3.node')
if (!existsSync(prebuilt)) {
  throw new Error(
    `找不到预编译的 ${prebuilt}。better-sqlite3 需要装好构建产物（pnpm install 时会 prebuild-install）。`,
  )
}
mkdirSync(path.join(betterSqliteDir, 'build', 'Release'), { recursive: true })
cpSync(prebuilt, path.join(betterSqliteDir, 'build', 'Release', 'better_sqlite3.node'))

// bindings：better-sqlite3 在运行时唯一 require 的外部包（纯 JS，无子依赖）。
// 锚点必须是 better-sqlite3 自己——这就是它运行时会用的解析路径，也正是
// pnpm 把 bindings 摆在它旁边的那个位置。
const bindingsDir = path.join(expressDir, 'bindings')
const bindingsSource = resolvePackageDir('bindings', path.join(sqliteSource, 'package.json'))
cpSync(bindingsSource, bindingsDir, { recursive: true })

/*
  file-uri-to-path：`bindings` 无条件 require 它（`bindings.js` 第 7 行），
  而它又只挂在 `bindings` 自己的虚拟目录下。

  **这一条是实测逼出来的**，不是照抄依赖表：不带上它，产物一启动就是
  `Cannot find module 'file-uri-to-path'`（从 bindings.js 抛出来，栈里看起来像
  better-sqlite3 的问题，其实是它下面第三层的 loader）。

  只拷一个文件 + package.json，不整个目录递归：这个包就一个 .js，
  而它的依赖（`node:path`）是内置的。
*/
const fileUriSource = resolvePackageDir('file-uri-to-path', path.join(bindingsSource, 'package.json'))
const fileUriDir = path.join(expressDir, 'file-uri-to-path')
mkdirSync(fileUriDir, { recursive: true })
for (const name of ['package.json', 'index.js']) {
  cpSync(path.join(fileUriSource, name), path.join(fileUriDir, name))
}

// ---- 3. externalBin：一支 Node 运行时 ----
//
// 路径必须是 src-tauri/binaries/<名字>-<triple><.exe>：Tauri 把 triple 后缀补在
// **整条路径末尾**，多一层子目录就会对不上（实测报 resource path doesn't exist）。
//
// 为什么是「复制当前进程自己」而不是从 nodejs.org 下载对应平台的包：第一段只要能
// 证明「产物挪到别处也能跑起来」，下载/校验/解压那套属于打包流程，等真做跨平台
// 产物时再补。代价：产物与构建机同平台。
//
// **只在 externalBin 放一份**：它就是壳 exec 的那支 Node，内容与 node.exe 无异，
// 再往 resources 里放第二份纯属把安装包撑大一倍（实测单份约 80MB）。
const nodeSource = process.execPath
const externalBin = path.join(binDir, `git-nest-server-${triple}${exeSuffix}`)
cpSync(nodeSource, externalBin)

/*
  run.cjs 是 sidecar 的**真正入口**（externalBin 那支 exe 的 argv[1]）。

  为什么用 CJS 而不是 .mjs：CJS 里 `require` 的解析规则是同步可预测的，
  而且 `./index.mjs` 是 ESM、不能被 require——所以这里用动态 import()。
  入口脚本只有三行，不引任何依赖。
*/
writeFileSync(
  path.join(stageDir, 'run.cjs'),
  [
    '// 由 scripts/build-sidecar.mjs 生成，不要手改。',
    '// 上级目录里的 node_modules 就是 better-sqlite3 的家，不用额外设 NODE_PATH。',
    "import('./index.mjs').catch((err) => {",
    "  console.error('[git-nest-server] 启动失败：', err)",
    '  process.exit(1)',
    '})',
    '',
  ].join('\n'),
)

// externalBin 与 resources 的落点：Tauri 会把 externalBin 换名放进目标目录，
// 把 resources 里的目录树解到资源目录——两处的入口都是这支 exe + run.cjs。
writeFileSync(
  path.join(stageDir, 'README.txt'),
  [
    '这份目录由 scripts/build-sidecar.mjs 生成，是 Tauri 的 sidecar 产物。',
    '',
    `目标平台：${triple}`,
    `better-sqlite3：${sqliteVersion}`,
    `默认端口：API ${ports.api} / WEB ${ports.web}（权威定义在 packages/core/src/types.ts）`,
    '',
    '启动方式（壳里由 tauri-plugin-shell 的 sidecar API 调起）：',
    `  ${path.basename(externalBin)} run.cjs`,
    '',
    '运行期环境变量：',
    '  GIT_NEST_PORT  监听端口（壳会传 core 里的 API 端口）',
    '  GIT_NEST_DB    数据库文件（壳传应用数据目录；不传就是仓库里的默认路径）',
    '',
  ].join('\n'),
)

console.log(`sidecar 产物：${path.relative(repoRoot, stageDir)}`)
console.log(`  externalBin：${path.relative(repoRoot, externalBin)}`)
console.log(`  入口脚本：run.cjs → index.mjs（${Math.round(readFileSync(bundlePath).length / 1024)} KB）`)
