# 类型角标的图标

这里放**项目类型角标**用的图标。清单页里每个项目那一格（默认的文件夹图）右下角
会压一个 16×16 的白圆，圆里放这里的 12×12 图标。

- 文件名必须是 **`<type>.svg`**，`<type>` 与
  `packages/core/src/git/project-type.ts` 里规则表的 `type` **逐字相同**。
- 命名规则：**全小写、不带空格、不带点**；需要分词用连字符（`react-native`）。
- 图形请用**纯形状**（原始多边形那种），**不要自带圆形 / 方形底**——
  白圆底由界面提供，自带底会叠成两层。

加一个新类型 = 在规则表里加一条规则 + 在这里放一个同名 svg。**不需要改其它代码**：
图标是构建期用 `import.meta.glob` 收进来的（见 `apps/web/src/features/projects/typeIcons.ts`），
某个 `<type>.svg` 不存在时那一格就**不画角标**（不留空圈）。

## 第一批（建议先收集，49 个）

**平台 / 形态（11）**

- [ ] `tauri`
- [ ] `electron`
- [ ] `flutter`
- [ ] `react-native`
- [ ] `android`
- [ ] `ios`
- [ ] `unity`
- [ ] `godot`
- [ ] `chrome`（浏览器扩展）
- [ ] `vscode`（VS Code 扩展）
- [ ] `wordpress`

**前端框架（8）**

- [ ] `vue`
- [ ] `react`
- [ ] `nextjs`
- [ ] `nuxt`
- [ ] `svelte`
- [ ] `angular`
- [ ] `astro`
- [ ] `solid`

**后端框架（10）**

- [ ] `nestjs`
- [ ] `express`
- [ ] `spring`（Spring Boot）
- [ ] `aspnet`（ASP.NET Core）
- [ ] `django`
- [ ] `flask`
- [ ] `fastapi`
- [ ] `rails`
- [ ] `laravel`
- [ ] `phoenix`

**语言 / 运行时（12）**

- [ ] `typescript`
- [ ] `javascript`
- [ ] `python`
- [ ] `rust`
- [ ] `go`
- [ ] `java`
- [ ] `kotlin`
- [ ] `csharp`
- [ ] `cpp`
- [ ] `php`
- [ ] `ruby`
- [ ] `swift`

**领域（8）**

- [ ] `jupyter`
- [ ] `pytorch`
- [ ] `terraform`
- [ ] `docker`
- [ ] `kubernetes`
- [ ] `latex`
- [ ] `platformio`（嵌入式）
- [ ] `solidity`

## 第二批（有就更好，29 个）

**平台**：`wails` · `unreal` · `expo` · `obsidian`

**框架**：`gin` · `echo` · `fiber` · `axum` · `actix` · `fastify` · `symfony` · `streamlit`

**语言**：`dart` · `elixir` · `scala` · `haskell` · `ocaml` · `erlang` · `zig` · `julia` · `r` · `lua` · `perl`

**领域**：`arduino` · `mkdocs` · `sphinx` · `docusaurus` · `vitepress`

## 认不出来的情况

规则表认不出就是认不出（`archify` 那种根目录什么都没有、源码在子目录里的仓库
有可能落空），界面上**不画角标**——和 logo 一样：认不出来就什么也不显示，
不硬凑一个「未知」图标。
