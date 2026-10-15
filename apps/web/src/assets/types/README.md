# 类型角标的图标

这里放**项目类型角标**用的图标。清单页里每个项目那一格（默认的文件夹图）右下角
会压一个 16×16 的白圆，圆里放这里的 12×12 图标（`features/projects/ProjectTypeBadge.tsx`）。

## 命名：**建议**小写、无空格，但不是硬性要求

- 文件名就是 `<type>.svg`，`<type>` 是规则表 `TYPE_RULES`
  （`packages/core/src/git/project-type.ts`）里的那个 slug。
- **不要求与 slug 逐字相同**：匹配时会归一化（小写 + 去掉一切非字母数字），
  所以 `Vue.svg`、`React Native.svg` 与 `vue`、`react-native` 都对得上；
  只有两个走别名表——`Chrome Extension.svg` / `VS Code Extension.svg` 对应
  `chrome` / `vscode`（`features/projects/typeIcons.ts` 的 `normalizeIconName`
  与 `ALIASES`，有单测钉着）。目录里现存的三张带空格的文件名就是这么来的。
- **大小写不敏感**：`.svg` 与 `.SVG` 都收（Windows 上很容易存成大写）。
- 图形请用**纯形状**（原始多边形那种），**不要自带圆形 / 方形底**——
  白圆底由界面提供，自带底会叠成两层。

## 加一个新类型要动**三处**，不是「加一条规则 + 放一个 svg」

1. `TYPE_RULES`（`packages/core/src/git/project-type.ts`）——怎么认出来；
2. `PROJECT_TYPES`（`packages/core/src/project-types.ts`）——显示名与分组。
   两者必须一致：`packages/core/test/git/project-type.test.ts` 有一条
   「规则表与展示目录必须一致」钉着，漏一处直接红；
3. 再在这里放一个同名 svg。

图标是构建期用 `import.meta.glob` 收进来的（`features/projects/typeIcons.ts`），
某个 `<type>.svg` 不存在时那一格就**不画角标**（不留空圈）。

## 现在的收集情况

目录里已就位 63 张。按 `PROJECT_TYPES` 的 `firstBatch` 分：**第一批只剩 `nuxt` 一个没图**，
其余 15 个缺的都是第二批的——

`nuxt` · `gin` · `echo` · `fiber` · `axum` · `actix` · `fastify` · `symfony` ·
`streamlit` · `dart` · `elixir` · `scala` · `haskell` · `sphinx` · `docusaurus` ·
`vitepress`

缺图不是缺陷：没有那张图就不画角标，和认不出来是同一种表现。

## 认不出来的情况

规则表认不出就是认不出（`archify` 那种根目录什么都没有、源码在子目录里的仓库
有可能落空），界面上**不画角标**——和 logo 一样：认不出来就什么也不显示，
不硬凑一个「未知」图标。
