/*
  类型角标的图标：`assets/types/<type>.svg`，**由使用者自己放**（不随代码库一起提供）。

  为什么用 glob 而不是一张手写的映射表：**加一个类型不该改代码**。
  把图标丢进那个目录，对应的项目立刻就有角标；没有对应文件就不画角标——和 logo
  一样，认不出来（或没有图）时界面上什么都不显示，不留占位。

  `import.meta.glob` 是构建期的：Vite 会把匹配到的 svg 收集成一张表，
  所以运行时不需要额外请求去问「有没有这张图」。
*/
const ICONS = import.meta.glob(
  [
    /*
      两个模式，都是刻意的：

      - `{svg,SVG}`：Windows 上很容易存成 `.SVG`。只写小写的话，那个文件**根本不进**
        这张表，而症状是「我明明放进去了，它还是缺」——最难查的一类。
      - 第二个模式多一层 `**`，允许按子目录分类（例如前端那个子目录里的 `Vue.svg`）。
        取的是文件名，所以放哪一层都认。

      （写这两条注释时注意：上面那个通配符别照着打进来——`星号加斜杠` 会把块注释
      提前闭合，整份文件跟着语法错，报的错还落在几十行之外。）
    */
    '@/assets/types/*.{svg,SVG}',
    '@/assets/types/**/*.{svg,SVG}',
  ],
  {
    eager: true,
    query: '?url',
    import: 'default',
  },
) as Record<string, string>

/**
 * 归一化：小写 + 去掉一切非字母数字。
 *
 * **不要求文件名与规则表逐字相同**：实际收来的是一套成套图标，用的是
 * `Vue.svg` / `React Native.svg` 这种 Title Case 带空格的名字，而规则表里是
 * `vue` / `react-native` 这种 slug。归一化之后 `React Native.svg` 与
 * `react-native` 都是 `reactnative`，直接对上；大小写也不再是问题。
 */
export function normalizeIconName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/**
 * 归一化也接不上的几个，靠这张别名表。键是**文件名**归一化后的样子，值是规则表里的 type。
 *
 * 只有两个：成套图标里它们叫 `Chrome Extension` / `VS Code Extension`，
 * 而规则表里是 `chrome` / `vscode`（类型名不该带上「扩展」这个形态词）。
 */
const ALIASES: Record<string, string> = {
  chromeextension: 'chrome',
  vscodeextension: 'vscode',
}

/** 这个文件名是不是某个 type 的图标。导出来是为了能直接单测（不依赖目录内容）。 */
export function matchesType(fileBase: string, type: string): boolean {
  const key = normalizeIconName(fileBase)
  return key === normalizeIconName(type) || ALIASES[key] === type
}

/**
 * `<type>` → 图标 URL。目录里没有这个文件就返回 `null`（界面上不画角标）。
 *
 * 命名约定见 `assets/types/README.md`：建议小写、无空格（`nextjs`、`react-native`），
 * 但**大写与空格也能对上**——见上面 `normalizeIconName` 的说明。
 */
export function typeIconUrl(type: string | null): string | null {
  if (!type) return null
  for (const [file, url] of Object.entries(ICONS)) {
    const base = file.split('/').pop()?.replace(/\.svg$/i, '') ?? ''
    if (matchesType(base, type)) return url
  }
  return null
}
