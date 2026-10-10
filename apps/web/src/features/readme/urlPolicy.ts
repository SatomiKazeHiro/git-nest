/**
 * README 里会变成 URL 的东西只有两类，而两类**放行的协议不同**。
 *
 * 这一整个设计的安全前提是这个软件**打开一个仓库不向外部发任何请求**：
 * README 里最常见的是徽章图片（`[![CI](https://img.shields.io/…)]`），
 * 渲染成 `<img>` 就是几十个第三方请求，还顺带把 IP 和仓库名递出去，
 * 而用户点开某个仓库时并没有预期这件事。
 *
 * 一个函数两个 `kind`，而不是散在各个组件里各判一次：散开就会出现
 * 「链接拦了、图片忘了」这种洞，而图片那条洞恰好最不容易发现——
 * 因为它不报错，只是安静地往外发请求。
 */
export type ReadmeUrlKind = 'image' | 'link'

/**
 * 图片只放行内联的 `data:image/*`。
 *
 * `data:image/svg+xml` 也在这一档里，而它在 `<img>` 里是安全的：
 * img 上下文不执行脚本，也不加载外部资源。（放进 `data:` 链接里才危险，
 * 而 `data:` 压根不在链接那一档。）
 */
const IMAGE_ALLOWED = ['data:image/']

/** 链接放行这三种，且一律 `target="_blank" rel="noreferrer noopener"`。 */
const LINK_ALLOWED = ['http:', 'https:', 'mailto:']

/**
 * 放行返回原值，拦下返回**空串**。
 *
 * 返回空串而不是原值：空串让下游知道「这个不可用」，好把它渲染成普通文字；
 * 返回原值则会被照常渲染成那个链接——那才是洞。
 */
export function readmeUrl(url: string, kind: ReadmeUrlKind): string {
  const value = url.trim()
  // 没有 scheme 就是相对路径（或页内锚点），一律不放行。
  // 仓库里那些文件我们不显示，可点的就是一个死链接。
  if (!/^[a-z][a-z0-9+.-]*:/i.test(value)) return ''

  const lower = value.toLowerCase()
  const allowed = kind === 'image' ? IMAGE_ALLOWED : LINK_ALLOWED
  return allowed.some((p) => lower.startsWith(p)) ? value : ''
}