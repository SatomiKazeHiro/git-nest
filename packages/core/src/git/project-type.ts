import fs from 'node:fs'
import path from 'node:path'

/**
 * 认出一个项目**是什么**：Tauri 应用、Vue 前端、Django 后端、Python 脚本……
 *
 * 这套判断比 logo 那套**可靠得多**：开发工具链留下的是结构化痕迹
 * （`go.mod`、`manage.py`、`pubspec.yaml`、`project.godot`），不是靠名字猜。
 *
 * ## `type` 就是图标文件名
 *
 * 返回的字符串（`'vue'`、`'nestjs'`、`'cpp'`…）**就是 `apps/web/src/assets/types/<type>.svg`**
 * 里那个 `<type>`。所以这张规则表同时是**命名约定**：加一个类型 = 加一条规则 +
 * 一个同名 svg，不用改别的地方。`apps/web/src/assets/types/README.md` 里有一份可勾选的清单。
 *
 * ## 一个仓库常常同时命中好几层
 *
 * Tauri 应用 = 壳 + Vue + TypeScript。而界面上只有一个角标位，所以必须定优先级：
 *
 * 1. **平台 / 形态**（它是什么应用：Tauri、Electron、Unity、安卓、扩展…）
 * 2. **框架**（用什么写的：Next、Vue、Django、Spring…）
 * 3. **领域**（Terraform、Notebook、嵌入式、LaTeX…）
 * 4. **语言 / 运行时**（兜底：Rust、Go、Python、TS…）
 * 5. **说不清但至少知道是啥**（只有 Dockerfile 那种）
 *
 * **领域排在语言之前**是有意的：一个满是 `.ipynb` 的仓库显示「Jupyter」比
 * 「Python」有用得多，一个全是 `.tf` 的仓库该显示 Terraform。语言是最后兜底。
 * 层小的先判，**同层内按下面数组的顺序**（具体在前）。
 *
 * ## 两种证据，强弱不同
 *
 * - **清单与必需文件**（根目录 readdir + 少数几个清单的前 64KB）：强证据。
 *   一个 `pom.xml` 里有 `spring-boot` 基本就说明了问题。
 * - **扩展名**（浅层遍历收集）：弱证据。`deploy/main.tf` 出现在一个 Java 仓库里
 *   不代表它是 Terraform 项目。所以扩展名那一档只在**清单那一档全落空**时才用
 *   ——但领域层的 `.ipynb`/`.tf` 恰好只能靠它，所以它仍然在语言层之前。
 */

export interface TypeRule {
  /** 图标文件名（不带 `.svg`） */
  type: string
  /** 1 平台 · 2 框架 · 3 领域 · 4 语言 · 5 兜底 */
  tier: 1 | 2 | 3 | 4 | 5
  /** 根目录下有这些路径之一（相对根，`/` 分隔；支持一个 `*`） */
  files?: string[]
  /** 代码树里有以这些后缀结尾的文件（浅层遍历） */
  suffix?: string[]
  /** 读某个根目录文件的内容找片段（`file` 支持一个 `*`） */
  contains?: { file: string; any: string[] }[]
  /** 给读规则表的人看的一句话（不是判据） */
  note: string
}

/** 读清单文件的字节上限：依赖名都在前面，没必要读完整包。 */
const MANIFEST_BYTES = 64 * 1024

/** 浅层遍历的上限。走的是目录树，所以必须有天花板。 */
const SCAN_MAX_ENTRIES = 600
const SCAN_MAX_DEPTH = 3
/** 这些目录里不可能有「这是什么项目」的答案，而且通常巨大。 */
const SCAN_SKIP = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'out',
  'target',
  'vendor',
  '.venv',
  'venv',
  '__pycache__',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.cache',
  '.turbo',
  'coverage',
  'Pods',
  '.idea',
  'obj',
])

/**
 * 规则表。**顺序就是同层内的优先级**（具体在前）。
 *
 * 判据只用「一个仓库里几乎必然存在」的东西。不用 `Dockerfile`、
 * `.github/workflows` 这类到处都有的东西——它们不是项目类型（Docker 只留在最后一档）。
 */
export const TYPE_RULES: readonly TypeRule[] = [
  // ── 1. 平台 / 形态 ────────────────────────────────────────────
  { type: 'tauri', tier: 1, files: ['src-tauri/tauri.conf.json', 'tauri.conf.json'], note: '桌面壳；里面往往还有 Vue/React' },
  { type: 'wails', tier: 1, files: ['wails.json'], note: 'Go 桌面壳' },
  { type: 'unity', tier: 1, files: ['ProjectSettings/ProjectVersion.txt'], note: '游戏引擎' },
  { type: 'godot', tier: 1, files: ['project.godot'], note: '游戏引擎' },
  { type: 'unreal', tier: 1, suffix: ['.uproject'], note: '游戏引擎' },
  { type: 'android', tier: 1, files: ['AndroidManifest.xml', 'app/src/main/AndroidManifest.xml'], note: '原生安卓' },
  { type: 'ios', tier: 1, suffix: ['.xcodeproj', '.xcworkspace'], note: 'Xcode 工程（只有 Package.swift 的算 Swift 库）' },
  { type: 'flutter', tier: 1, contains: [{ file: 'pubspec.yaml', any: ['sdk: flutter'] }], note: 'Dart + Flutter' },
  { type: 'expo', tier: 1, contains: [{ file: 'package.json', any: ['"expo"'] }], note: 'RN 的托管形态，比 react-native 具体' },
  { type: 'react-native', tier: 1, contains: [{ file: 'package.json', any: ['"react-native"'] }], note: '' },
  { type: 'electron', tier: 1, contains: [{ file: 'package.json', any: ['"electron"'] }], note: '' },
  { type: 'vscode', tier: 1, contains: [{ file: 'package.json', any: ['"vscode"'] }], note: '`engines.vscode`；`"vscode"` 带引号才匹配，避开 @types/vscode' },
  { type: 'chrome', tier: 1, contains: [{ file: 'manifest.json', any: ['"manifest_version"'] }], note: '**必须读内容**：manifest.json 是个共用名' },
  { type: 'obsidian', tier: 1, contains: [{ file: 'manifest.json', any: ['"minAppVersion"'] }], note: '同上' },
  { type: 'wordpress', tier: 1, files: ['wp-config.php', 'wp-content'], note: '' },
  { type: 'wordpress', tier: 1, contains: [{ file: 'style.css', any: ['Theme Name:'] }], note: '主题的 style.css 头部' },

  // ── 2. 框架 ──────────────────────────────────────────────────
  { type: 'nextjs', tier: 2, contains: [{ file: 'package.json', any: ['"next"'] }], note: '' },
  { type: 'nuxt', tier: 2, contains: [{ file: 'package.json', any: ['"nuxt"'] }], note: '' },
  { type: 'angular', tier: 2, files: ['angular.json'], note: '' },
  { type: 'astro', tier: 2, files: ['astro.config.*'], note: '有配置文件就算' },
  { type: 'svelte', tier: 2, contains: [{ file: 'package.json', any: ['"svelte"'] }], note: '' },
  { type: 'svelte', tier: 2, suffix: ['.svelte'], note: '有 .svelte 文件是铁证' },
  { type: 'vue', tier: 2, contains: [{ file: 'package.json', any: ['"vue"'] }], note: '' },
  { type: 'vue', tier: 2, suffix: ['.vue'], note: '有 .vue 文件是铁证（源码常在 src/ 下，靠浅遍历看得见）' },
  { type: 'solid', tier: 2, contains: [{ file: 'package.json', any: ['"solid-js"'] }], note: '' },
  { type: 'nestjs', tier: 2, files: ['nest-cli.json'], note: '' },
  { type: 'nestjs', tier: 2, contains: [{ file: 'package.json', any: ['"@nestjs/core"'] }], note: '' },
  { type: 'laravel', tier: 2, files: ['artisan'], note: '铁证' },
  { type: 'rails', tier: 2, files: ['bin/rails', 'config/application.rb'], note: '' },
  { type: 'symfony', tier: 2, files: ['bin/console'], note: '' },
  { type: 'django', tier: 2, files: ['manage.py'], note: '铁证' },
  { type: 'phoenix', tier: 2, contains: [{ file: 'mix.exs', any: ['phoenix'] }], note: '' },
  { type: 'spring', tier: 2, contains: [{ file: 'pom.xml', any: ['spring-boot'] }], note: 'Maven' },
  { type: 'spring', tier: 2, contains: [{ file: 'build.gradle', any: ['spring-boot'] }], note: '' },
  { type: 'spring', tier: 2, contains: [{ file: 'build.gradle.kts', any: ['spring-boot'] }], note: '' },
  { type: 'aspnet', tier: 2, contains: [{ file: '*.csproj', any: ['Microsoft.NET.Sdk.Web'] }], note: '' },
  { type: 'fastapi', tier: 2, contains: [{ file: 'pyproject.toml', any: ['fastapi'] }, { file: 'requirements.txt', any: ['fastapi'] }], note: '' },
  { type: 'flask', tier: 2, contains: [{ file: 'pyproject.toml', any: ['flask'] }, { file: 'requirements.txt', any: ['flask'] }], note: '' },
  { type: 'streamlit', tier: 2, contains: [{ file: 'requirements.txt', any: ['streamlit'] }], note: '' },
  { type: 'gin', tier: 2, contains: [{ file: 'go.mod', any: ['gin-gonic/gin'] }], note: '' },
  { type: 'echo', tier: 2, contains: [{ file: 'go.mod', any: ['labstack/echo'] }], note: '' },
  { type: 'fiber', tier: 2, contains: [{ file: 'go.mod', any: ['gofiber/fiber'] }], note: '' },
  { type: 'axum', tier: 2, contains: [{ file: 'Cargo.toml', any: ['axum'] }], note: '' },
  { type: 'actix', tier: 2, contains: [{ file: 'Cargo.toml', any: ['actix-web'] }], note: '' },
  { type: 'express', tier: 2, contains: [{ file: 'package.json', any: ['"express"'] }], note: '弱' },
  { type: 'fastify', tier: 2, contains: [{ file: 'package.json', any: ['"fastify"'] }], note: '' },
  /*
    **react 放在这一层的最后**：它是这一层里最弱的线索——很多仓库依赖 react
    只是为了渲染文档，而 `express`/`fastify` 出现在 package.json 里说明它真有服务端。
    全栈仓库（React + Express）显示哪个是见仁见智的，但「有服务端」更说明问题。
  */
  { type: 'react', tier: 2, contains: [{ file: 'package.json', any: ['"react"'] }], note: '弱' },

  // ── 3. 领域（在语言之前：Notebook 仓库该显示 Jupyter，不是 Python）──
  { type: 'jupyter', tier: 3, suffix: ['.ipynb'], note: '' },
  { type: 'pytorch', tier: 3, contains: [{ file: 'requirements.txt', any: ['torch'] }, { file: 'pyproject.toml', any: ['torch'] }], note: '机器学习' },
  { type: 'terraform', tier: 3, suffix: ['.tf'], note: '基础设施即代码' },
  { type: 'kubernetes', tier: 3, files: ['Chart.yaml', 'kustomization.yaml'], note: '' },
  { type: 'solidity', tier: 3, files: ['foundry.toml', 'hardhat.config.js', 'hardhat.config.ts'], note: '链上' },
  { type: 'solidity', tier: 3, suffix: ['.sol'], note: '' },
  { type: 'platformio', tier: 3, files: ['platformio.ini'], note: '嵌入式' },
  { type: 'arduino', tier: 3, suffix: ['.ino'], note: '嵌入式' },
  { type: 'latex', tier: 3, suffix: ['.tex'], note: '' },
  { type: 'mkdocs', tier: 3, files: ['mkdocs.yml', 'mkdocs.yaml'], note: '文档站' },
  { type: 'sphinx', tier: 3, files: ['conf.py'], note: '文档站' },
  { type: 'docusaurus', tier: 3, files: ['docusaurus.config.*'], note: '文档站' },
  { type: 'vitepress', tier: 3, files: ['.vitepress/config.ts', '.vitepress/config.js', '.vitepress/config.mts'], note: '文档站' },

  // ── 4. 语言 / 运行时（兜底）──────────────────────────────────
  { type: 'rust', tier: 4, files: ['Cargo.toml'], note: '' },
  { type: 'go', tier: 4, files: ['go.mod'], note: '' },
  { type: 'python', tier: 4, files: ['pyproject.toml', 'requirements.txt', 'setup.py', 'Pipfile'], note: '' },
  { type: 'python', tier: 4, suffix: ['.py'], note: '' },
  { type: 'dart', tier: 4, files: ['pubspec.yaml'], note: '不是 flutter 的纯 Dart 包' },
  { type: 'elixir', tier: 4, files: ['mix.exs'], note: '' },
  { type: 'ruby', tier: 4, files: ['Gemfile'], note: '' },
  { type: 'php', tier: 4, files: ['composer.json'], note: '' },
  { type: 'java', tier: 4, files: ['pom.xml', 'build.gradle', 'build.gradle.kts'], note: '' },
  { type: 'java', tier: 4, suffix: ['.java'], note: '' },
  { type: 'kotlin', tier: 4, suffix: ['.kt', '.kts'], note: '' },
  { type: 'csharp', tier: 4, suffix: ['.csproj', '.sln', '.cs'], note: '' },
  { type: 'cpp', tier: 4, files: ['CMakeLists.txt'], note: '' },
  { type: 'cpp', tier: 4, suffix: ['.cpp', '.cc', '.hpp', '.h'], note: '' },
  { type: 'swift', tier: 4, files: ['Package.swift'], note: 'SwiftPM' },
  { type: 'swift', tier: 4, suffix: ['.swift'], note: '' },
  { type: 'scala', tier: 4, files: ['build.sbt'], note: '' },
  { type: 'haskell', tier: 4, files: ['stack.yaml'], note: '' },
  { type: 'haskell', tier: 4, suffix: ['.cabal'], note: '' },
  { type: 'ocaml', tier: 4, files: ['dune-project'], note: '' },
  { type: 'erlang', tier: 4, files: ['rebar.config'], note: '' },
  { type: 'zig', tier: 4, files: ['build.zig'], note: '' },
  { type: 'julia', tier: 4, files: ['Project.toml'], note: '' },
  { type: 'r', tier: 4, files: ['DESCRIPTION'], note: 'R 包描述文件' },
  { type: 'lua', tier: 4, suffix: ['.lua'], note: '' },
  { type: 'perl', tier: 4, files: ['cpanfile', 'Makefile.PL'], note: '' },
  { type: 'typescript', tier: 4, files: ['tsconfig.json'], note: '' },
  /*
    `.ts` / `.js` 后缀是**弱**证据（一个 Python 仓库里也可能有个把脚本），
    但它们必须留着：真机上有仓库根目录什么都没有——源码在 `viewer/`、`archify/`
    这种子目录里，只有扩展名能说明它是什么。
  */
  { type: 'typescript', tier: 4, suffix: ['.ts', '.tsx', '.mts'], note: '弱' },
  { type: 'javascript', tier: 4, files: ['package.json'], note: '有 package.json 但前面什么都没命中' },
  { type: 'javascript', tier: 4, suffix: ['.js', '.jsx', '.mjs', '.cjs'], note: '弱' },

  // ── 5. 说不清，但至少知道有这么个东西 ────────────────────────
  { type: 'docker', tier: 5, files: ['Dockerfile', 'docker-compose.yml', 'compose.yaml'], note: '**不是项目类型**，最后兜底用' },
]

/**
 * 认出这个目录是什么项目。认不出来返回 `null`（界面上就不显示角标）。
 *
 * 代价：一次根目录 readdir + 少数几个清单文件的前 64KB + 一次**有上限**的浅层遍历
 * （≤600 个条目、深度 ≤3、跳过 `node_modules` 这类）。不深挖、不读源码内容。
 */
export async function detectProjectType(dir: string): Promise<string | null> {
  const entries = await fs.promises.readdir(dir).catch(() => null)
  if (!entries) return null

  const names = entries.map((e) => e.toLowerCase())
  const rootFiles = new Set(names)
  const manifests = new Map<string, string | null>()
  let suffixes: Set<string> | null = null

  const readManifest = async (name: string): Promise<string | null> => {
    if (manifests.has(name)) return manifests.get(name) ?? null
    const text = await readHead(path.join(dir, name), MANIFEST_BYTES)
    manifests.set(name, text)
    return text
  }

  /** 规则里那个可能带一个 `*` 的文件名，落到根目录里真实存在的哪一个上。 */
  const resolve = (pattern: string): string | null => {
    const lower = pattern.toLowerCase()
    if (!lower.includes('*')) return rootFiles.has(lower) ? pattern : null
    const [before = '', after = ''] = lower.split('*')
    const index = names.findIndex((n) => n.startsWith(before) && n.endsWith(after))
    return index >= 0 ? (entries[index] ?? null) : null
  }

  const matches = async (rule: TypeRule): Promise<boolean> => {
    for (const rel of rule.files ?? []) {
      if (rel.includes('*')) {
        if (resolve(rel)) return true
        continue
      }
      const segments = rel.split('/')
      if (segments.length === 1) {
        if (rootFiles.has(rel.toLowerCase())) return true
        continue
      }
      // 嵌套的几个（src-tauri/…、ProjectSettings/…）真去 stat
      const stat = await fs.promises.stat(path.join(dir, rel)).catch(() => null)
      if (stat) return true
    }
    if (rule.suffix?.length) {
      suffixes ??= await collectSuffixes(dir)
      if (rule.suffix.some((s) => suffixes?.has(s))) return true
    }
    for (const check of rule.contains ?? []) {
      const file = resolve(check.file)
      if (!file) continue
      const text = (await readManifest(file))?.toLowerCase()
      if (text === undefined || text === null) continue
      if (check.any.some((fragment) => text.includes(fragment.toLowerCase()))) return true
    }
    return false
  }

  for (const tier of [1, 2, 3, 4, 5] as const) {
    for (const rule of TYPE_RULES) {
      if (rule.tier !== tier) continue
      if (await matches(rule)) return rule.type
    }
  }
  return null
}

/**
 * 浅层遍历收集扩展名，**有硬上限**：≤ {@link SCAN_MAX_ENTRIES} 个条目、深度 ≤
 * {@link SCAN_MAX_DEPTH}，并跳过 `node_modules`/`dist`/`target` 这类目录。
 *
 * 只收集扩展名，不读文件内容——这一档是**弱证据**（`deploy/main.tf` 不代表
 * 这是个 Terraform 项目），所以它只在清单与必需文件那一档全落空时才起作用。
 */
async function collectSuffixes(dir: string): Promise<Set<string>> {
  const found = new Set<string>()
  let visited = 0
  let frontier = [dir]
  for (let depth = 0; depth <= SCAN_MAX_DEPTH && frontier.length > 0; depth += 1) {
    const next: string[] = []
    for (const current of frontier) {
      const entries = await fs.promises.readdir(current, { withFileTypes: true }).catch(() => [])
      for (const entry of entries) {
        if (visited >= SCAN_MAX_ENTRIES) return found
        visited += 1
        if (entry.isDirectory()) {
          if (!SCAN_SKIP.has(entry.name)) next.push(path.join(current, entry.name))
          continue
        }
        const ext = path.extname(entry.name).toLowerCase()
        if (ext) found.add(ext)
      }
    }
    frontier = next
  }
  return found
}

/** 读文件开头的一段；读不出来返回 null（没那么个文件、是目录、没权限都算）。 */
async function readHead(file: string, maxBytes: number): Promise<string | null> {
  const handle = await fs.promises.open(file, 'r').catch(() => null)
  if (!handle) return null
  try {
    const stat = await handle.stat()
    if (!stat.isFile()) return null
    const buf = Buffer.alloc(Math.min(maxBytes, stat.size))
    const { bytesRead } = await handle.read(buf, 0, buf.length, 0)
    return buf.subarray(0, bytesRead).toString('utf8')
  } finally {
    await handle.close()
  }
}
