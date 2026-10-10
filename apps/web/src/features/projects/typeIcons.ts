/*
  类型角标的图标：`docs/types/<type>.svg`，**由使用者自己放**（不随代码库一起提供）。

  为什么用 glob 而不是一张手写的映射表：**加一个类型不该改代码**。
  把 `vue.svg` 丢进那个目录，vue 项目立刻就有角标了；没有对应文件就不画角标
  ——和 logo 一样，认不出来（或没有图）时界面上什么都不显示，不留占位。

  `import.meta.glob` 是构建期的：Vite 会把匹配到的 svg 收集成一张表，
  所以运行时不需要额外请求去问「有没有这张图」。
*/
const ICONS = import.meta.glob('../../../../../docs/types/*.svg', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>

/**
 * `<type>` → 图标 URL。目录里没有这个文件就返回 `null`（界面上不画角标）。
 *
 * 命名约定见 `docs/types/README.md`：**小写、无空格、无点**（`nextjs`、`nestjs`、
 * `cpp`、`csharp`、`react-native` 用连字符）。规则表里的 `type` 就是文件名。
 */
export function typeIconUrl(type: string | null): string | null {
  if (!type) return null
  for (const [file, url] of Object.entries(ICONS)) {
    if (file.endsWith(`/${type}.svg`)) return url
  }
  return null
}
