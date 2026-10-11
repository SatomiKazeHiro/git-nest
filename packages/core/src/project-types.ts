/**
 * 类型目录：`type`（＝图标文件名）→ 显示名与分组。
 *
 * **这是展示用的清单，判定规则在 `git/project-type.ts`**（那边要读文件系统，
 * 所以只能待在 node-only 的入口里）。两边必须一致：`project-type.test.ts` 里有一条
 * 断言，钉住「规则表里出现的每个 type 都在这份目录里」——加规则忘了加目录会红。
 *
 * 为什么单独放一份而不是从规则表推：web 端要显示中文名与分组，而它**不能**
 * import 那个 node-only 的模块（它 import 了 `node:fs`）。
 */

export interface ProjectTypeInfo {
  /** 规则表里的那个 slug，也是图标文件名（归一化后比较，见 web 的 `typeIcons.ts`） */
  type: string
  /** 界面上显示的名字 */
  label: string
  group: string
  /** 第一批要收集的吗（`apps/web/src/assets/types/README.md` 里那份清单就是按它分的） */
  firstBatch: boolean
}

const group = (
  name: string,
  firstBatch: boolean,
  entries: readonly (readonly [string, string])[],
): ProjectTypeInfo[] => entries.map(([type, label]) => ({ type, label, group: name, firstBatch }))

export const PROJECT_TYPES: readonly ProjectTypeInfo[] = [
  ...group('平台 / 形态', true, [
    ['tauri', 'Tauri'],
    ['electron', 'Electron'],
    ['flutter', 'Flutter'],
    ['react-native', 'React Native'],
    ['android', 'Android'],
    ['ios', 'iOS'],
    ['unity', 'Unity'],
    ['godot', 'Godot'],
    ['chrome', 'Chrome 扩展'],
    ['vscode', 'VS Code 扩展'],
    ['wordpress', 'WordPress'],
  ]),
  ...group('平台 / 形态', false, [
    ['wails', 'Wails'],
    ['unreal', 'Unreal'],
    ['expo', 'Expo'],
    ['obsidian', 'Obsidian'],
  ]),
  ...group('前端框架', true, [
    ['vue', 'Vue'],
    ['react', 'React'],
    ['nextjs', 'Next.js'],
    ['nuxt', 'Nuxt'],
    ['svelte', 'Svelte'],
    ['angular', 'Angular'],
    ['astro', 'Astro'],
    ['solid', 'Solid'],
  ]),
  ...group('后端框架', true, [
    ['nestjs', 'NestJS'],
    ['express', 'Express'],
    ['spring', 'Spring Boot'],
    ['aspnet', 'ASP.NET Core'],
    ['django', 'Django'],
    ['flask', 'Flask'],
    ['fastapi', 'FastAPI'],
    ['rails', 'Rails'],
    ['laravel', 'Laravel'],
    ['phoenix', 'Phoenix'],
  ]),
  ...group('后端框架', false, [
    ['gin', 'Gin'],
    ['echo', 'Echo'],
    ['fiber', 'Fiber'],
    ['axum', 'Axum'],
    ['actix', 'Actix'],
    ['fastify', 'Fastify'],
    ['symfony', 'Symfony'],
    ['streamlit', 'Streamlit'],
  ]),
  ...group('语言 / 运行时', true, [
    ['typescript', 'TypeScript'],
    ['javascript', 'JavaScript'],
    ['python', 'Python'],
    ['rust', 'Rust'],
    ['go', 'Go'],
    ['java', 'Java'],
    ['kotlin', 'Kotlin'],
    ['csharp', 'C#'],
    ['cpp', 'C / C++'],
    ['php', 'PHP'],
    ['ruby', 'Ruby'],
    ['swift', 'Swift'],
  ]),
  ...group('语言 / 运行时', false, [
    ['dart', 'Dart'],
    ['elixir', 'Elixir'],
    ['scala', 'Scala'],
    ['haskell', 'Haskell'],
    ['ocaml', 'OCaml'],
    ['erlang', 'Erlang'],
    ['zig', 'Zig'],
    ['julia', 'Julia'],
    ['r', 'R'],
    ['lua', 'Lua'],
    ['perl', 'Perl'],
  ]),
  ...group('领域', true, [
    ['jupyter', 'Jupyter'],
    ['pytorch', 'PyTorch'],
    ['terraform', 'Terraform'],
    ['docker', 'Docker'],
    ['kubernetes', 'Kubernetes'],
    ['latex', 'LaTeX'],
    ['platformio', 'PlatformIO'],
    ['solidity', 'Solidity'],
  ]),
  ...group('领域', false, [
    ['arduino', 'Arduino'],
    ['mkdocs', 'MkDocs'],
    ['sphinx', 'Sphinx'],
    ['docusaurus', 'Docusaurus'],
    ['vitepress', 'VitePress'],
  ]),
  /*
    「远程仓库」不是项目类型：它说的是这个仓库有没有远程。逻辑后面再定，
    但图标已经在 `apps/web/src/assets/types/` 里了，预览页先把它一起显示出来。
  */
  ...group('其它', false, [['remote', '远程仓库']]),
]
