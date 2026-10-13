import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { readmeUrl } from './urlPolicy'

/**
 * **Markdown 的正文渲染：整个应用只有这一处。**
 *
 * 三个地方用它，而且必须是同一套：
 * - README（`ReadmeView`，外面包着「加载完整」那一套）；
 * - 「记录」的**预览**（编辑资料弹窗里，跟着输入实时走）；
 * - 详情页那条**只读**的「记录」（`RecordView`）。
 *
 * ## 为什么只有一处
 *
 * 「记录」是**用户自己写的东西**，而写与看必须是同一套解释：预览里 `**粗体**` 是粗体，
 * 存下去之后详情页也得是粗体。两处各写一份渲染器，迟早会飘开——而飘开的表现是
 * 「我在这儿看着是这样，保存完怎么就变了」。
 *
 * 更要紧的是**安全策略**：这套渲染链里唯一那个闸门是 `urlTransform`（`readmeUrl`）。
 * 散成两处就会重演 `urlPolicy` 注释里记着的那个洞——「链接拦了、图片忘了」，
 * 而图片那条洞不报错，只是安静地往外发请求。所以闸门、`skipHtml`、
 * `components` 覆写这三件事一起住在这里，调用方只能给内容，改不了策略。
 *
 * ## 这里钉着的三件事（都是踩出来的，别在调用点上再写一遍）
 *
 * 1. **URL 一律过 `readmeUrl`**：拦下的返回空串，下面的 `components` 看到
 *    `href === ''` 就渲染成普通文字——不是留一个点了没反应的蓝链接。
 *    （图片与链接放行的协议不同，`node.tagName` 就是要区分的那一位。）
 * 2. **原始 HTML 一律丢掉**（`skipHtml`）：不装 `rehype-raw` 时，react-markdown 的
 *    默认行为是把 raw HTML **渲染成文本**，于是 `# store-install` 那种锚点会在界面上
 *    原样显示成一行尖括号标签。`skipHtml` 才是「不渲染」：丢的是标记，不是内容。
 * 3. **放行的外链一定带 `target="_blank" rel="noreferrer noopener"`**：
 *    README 不向外部发请求（图片那一档只放行内联 `data:image/*`），链接则是
 *    「用户点了才请求」——`noopener` 顺带挡掉 `window.opener` 那条路。
 *
 * ## 样式
 *
 * 外层的 `.readme` 是这套 markdown 排版的**唯一入口**（见 `index.css`）：
 * 它按「详情栏那种窄栏」调的字号与行高。记录那一侧也是同一个宽度量级，
 * 所以共用同一套，不另起一套视觉。
 */
export function MarkdownBody({ children, className = '' }: { children: string; className?: string }) {
  return (
    <div className={`readme ${className}`}>
      <Markdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        urlTransform={(url, _key, node) =>
          readmeUrl(url, node.tagName === 'img' ? 'image' : 'link')
        }
        components={{
          a: ({ href, children }) =>
            href ? (
              <a href={href} target="_blank" rel="noreferrer noopener">
                {children}
              </a>
            ) : (
              // 不可点的普通文字：文字还在，只是不再假装能点
              <span>{children}</span>
            ),
          img: ({ src, alt }) => {
            if (!src) {
              return alt ? (
                <span className="readme-badge">{alt}</span>
              ) : (
                <span className="readme-img-placeholder" aria-hidden />
              )
            }
            // 这里只会是 data:image/*，不联网
            return <img src={src} alt={alt ?? ''} />
          },
        }}
      >
        {children}
      </Markdown>
    </div>
  )
}
