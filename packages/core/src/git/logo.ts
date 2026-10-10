import fs from 'node:fs'
import path from 'node:path'
import { readReadme } from './readme.ts'

/**
 * 从仓库里认出这个项目的 logo。
 *
 * **只认仓库内的图片文件。** 远程 URL 一律不看——这是这个功能的边界，也是 README
 * 那条既有前提的延续（`urlPolicy` 只放行内联 `data:image/*`，因为渲染远程图就是
 * 几十个第三方请求、外加把 IP 和仓库名递出去）。**顺带的好处有两个**：
 * README 里的徽章全是远程 URL，于是「怎么识别徽章」这个问题根本不存在；
 * 而「这次识别要不要联网」也不用再当一个问题。
 *
 * **宁缺勿滥。** 认不出来就是没有——界面上什么都不显示，而不是随便拿一张图顶上。
 * 这条不是洁癖，是数出来的：真实 README 里的第一张图几乎总是截图
 * （`imgs/transcript.png`、`docs/images/workspace-overview.png`、
 * `docs/assets/archify-readme-hero.png`），缩到 16px 摆在项目名旁边就是一块脏东西。
 */

/**
 * 能当 logo 的图片类型。
 *
 * **gif 不在里头**：真机扫出来的唯一那个 gif 是 `archify-live-proof.gif`——
 * 一段演示录屏。用 gif 当 logo 的场合基本只剩「动图」，而一个在清单里自己动
 * 的 16px 图标就是噪音。bmp / ico 也不收：尺寸不可控，浏览器支持也参差。
 */
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.svg', '.avif'])

/** 超过这个大小就不当 logo：一张 2MB 的图缩到 16px，代价和收益不成比例。 */
export const LOGO_MAX_BYTES = 2 * 1024 * 1024

/** 只在 README 开头找：logo 总在前面，没必要为它读完整个文件。 */
const README_HEAD_BYTES = 16 * 1024

/**
 * 按常见文件名直接找时看的位置。**不递归**——只 stat 这几个目录下的一层，
 * 一个仓库通常只有一个 logo（`public/logo.svg` 这种 README 根本没引用的，
 * 就是靠这一条捞回来的）。
 */
const LOGO_DIRS = ['', 'docs', 'assets', 'static', 'public', 'img', 'images', 'resource', '.github']

/** 相对仓库根的路径，一律 `/` 分隔（Windows 上 `path.relative` 给的是 `\`）。 */
export interface LogoPick {
  path: string
  /** 线索来自哪：README 里引用的，还是按常见文件名直接找到的 */
  from: 'readme' | 'file'
}

export interface LogoCandidate {
  /** 相对仓库根的路径，`/` 分隔 */
  rel: string
  /** README 里那行的 alt 文本（按文件名找到的候选没有） */
  alt?: string
  /** 在 README 里的出现次序；按文件名找到的候选给一个大数 */
  order: number
  from: 'readme' | 'file'
}

/**
 * 预览图 / 截图一律**直接出局**，不是扣分。
 *
 * 它扣不住：`kun-hero-gui-tui-character-demo.jpg` 里明明有项目名（+3），
 * 扣 3 分正好回到 0——分数线一动就漏。而出局的代价只是「这个项目没有 logo」，
 * 那本来就是常见结局。
 *
 * **带 `logo` / `icon` 字样的名字不在此列**：`logo-preview.png` 仍然是 logo 的
 * 一张变体，而 `ui-zh-v085-project-config.png` 不是。少了这条例外，一个叫
 * 「UI Kit」的项目会连自己的 `ui-kit-logo.png` 都认不出来。
 */
const PREVIEWISH =
  /\b(preview|screenshot|screenshots|screen|capture|shot|demo|overview|hero|banner|chart|graph|plot|thumb|thumbnail|mockup|ui|og|output|result|results|proof|theme|dark|light)\b/
const LOGO_WORD = /\b(logo|icon)\b/

/**
 * alt 文本里的中文标记。「标识 / 标志 / 徽标」就是 logo。
 *
 * 真实 README 里很常见：`<img src="src/asset/img/kun.png" alt="Kun 蓝色 K 标识">`
 * ——文件名一点线索都没有，答案全在 alt 里。而 `words()` 会把汉字当分隔符切掉，
 * 所以这一条必须单独判原始文本。
 */
const CN_LOGO = /(标识|标志|徽标|商标)/
const CN_ICON = /图标/

/**
 * 把名字切成小写单词。`logo-dark.svg` → `logo dark`；`YouTube%20Digest.png`
 * 已经是解码后的 `YouTube Digest.png` → `youtube digest`。
 */
function words(name: string): string {
  return name
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * 这个路径的形状是不是「预览图 / 截图」。
 *
 * **看整条相对路径，不只看文件名**：真实的线索常常在目录上
 * （`docs/screenshots/desktop-console.png` 里，文件名本身什么也没说，
 * `screenshots` 那层目录才是判据）。
 */
export function isPreviewish(rel: string): boolean {
  const w = words(rel)
  if (LOGO_WORD.test(w)) return false
  return PREVIEWISH.test(w)
}

/** 扩展名在不在白名单里。服务端发字节前也要用它再判一次（不信任存下来的路径）。 */
export function isImagePath(rel: string): boolean {
  return IMAGE_EXT.has(path.posix.extname(rel).toLowerCase())
}

/**
 * 取 HTML 标签上的属性值。
 *
 * **引号里的空格必须留住**：真实 README 里 `alt="Kun 蓝色 K 标识"` 就是答案所在
 * （文件名 `kun.png` 一点线索都没有）。用 `[^\s>]+` 取值只会拿到 `"Kun`，
 * 「标识」两个字当场丢掉——第一版就是这么漏掉 Kun 的。
 */
function attr(tag: string, name: string): string {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'))
  return m?.[1] ?? m?.[2] ?? m?.[3] ?? ''
}

/**
 * 从 README 正文里提出图片引用，按出现顺序。markdown 的 `![](…)` 与 HTML 的
 * `<img src=…>` 都算——真实 README 里两种都常见，只认一种会漏掉一半的仓库。
 */
export function readmeImages(text: string): { src: string; alt: string }[] {
  const found: { index: number; src: string; alt: string }[] = []

  for (const m of text.matchAll(/!\[([^\]]*)\]\(\s*([^\s)]+)(?:\s+["'][^"']*["'])?\s*\)/g)) {
    found.push({ index: m.index ?? 0, src: m[2] ?? '', alt: m[1] ?? '' })
  }
  for (const m of text.matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0]
    found.push({ index: m.index ?? 0, src: attr(tag, 'src'), alt: attr(tag, 'alt') })
  }

  return found.sort((a, b) => a.index - b.index).map(({ src, alt }) => ({ src, alt }))
}

/**
 * 把 README 里的一个引用规范化成「仓库内的相对路径」；不是仓库内图片就 null。
 *
 * 四类一律不要：有 scheme 的（http/data/file…）、协议相对的 `//`、
 * 以 `/` 开头的绝对路径、以及任何想往上跳的 `..`。最后那条不只是洁癖——
 * 它正是路径逃逸的形状，而这里的输入来自仓库内容。
 */
export function normalizeLogoRef(src: string): string | null {
  const raw = src.trim()
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return null
  if (raw.startsWith('//') || raw.startsWith('/')) return null

  let decoded = raw
  try {
    decoded = decodeURIComponent(raw)
  } catch {
    // 坏的百分号编码：按原样用，后面的存在性检查会兜住
  }
  // `logo-dark.svg#gh-dark-mode-only` 与 `logo.png?raw=1` 都要能落到文件上
  const clean = (decoded.split('#')[0] ?? '').split('?')[0]?.trim() ?? ''
  if (!clean) return null

  const rel = clean.replace(/\\/g, '/').replace(/^\.\//, '')
  if (rel.split('/').some((seg) => seg === '..')) return null
  return isImagePath(rel) ? rel : null
}

/**
 * 有没有**明说是标志**：文件名或 alt 里的 `logo` / `icon`，或 alt 里的中文标记。
 *
 * 这是入选的**资格**，而项目名不是。真机上的反例很硬：archify 的截图全叫
 * `archify-xxx.png`（`archify-menu.png`、`archify-light.png`…），拿项目名当资格，
 * 它会连挑三张截图。项目名退到分数里当「并列时的偏好」是合适的，当资格不合适。
 */
export function explicitLogo(candidate: LogoCandidate): boolean {
  const name = words(path.posix.basename(candidate.rel))
  const alt = words(candidate.alt ?? '')
  const altRaw = candidate.alt ?? ''
  return (
    /\blogo\b/.test(name) ||
    /\blogo\b/.test(alt) ||
    CN_LOGO.test(altRaw) ||
    /\bicon\b/.test(name) ||
    /\bicon\b/.test(alt) ||
    CN_ICON.test(altRaw)
  )
}

/**
 * 给一个候选打分。加分项只有三个：`logo` / `icon` / 项目名（后者只在并列时起作用）。
 * 别的线索（位置靠前、目录叫 assets…）都不加分——数过一遍就知道它们分不出 logo
 * 和截图：`transcript.png` 的位置就很靠前。
 */
export function scoreLogo(candidate: LogoCandidate, projectName: string): number {
  const name = words(path.posix.basename(candidate.rel))
  const alt = words(candidate.alt ?? '')
  const altRaw = candidate.alt ?? ''
  const has = (word: string) =>
    new RegExp(`\\b${word}\\b`).test(name) || new RegExp(`\\b${word}\\b`).test(alt)

  let score = 0
  if (has('logo') || CN_LOGO.test(altRaw)) score += 4
  if (has('icon') || CN_ICON.test(altRaw)) score += 2
  if (mentionsProject(name, alt, projectName)) score += 3
  // 给深色底用的那一版，摆在浅色界面上常常看不见（`logo-dark.svg` 就是）。
  // 它**不会**被上面那张预览图名单排除掉：名字里有 `logo`，走的是豁免那条路。
  if (has('dark')) score -= 1
  /*
    名字**就是** `logo` / `icon`（`logo.svg`、`icon.png`）：并列时它该赢过
    `logo-share.svg` 那种变体。真机上踩到过——同一分下由文件名顺序决定了胜负，
    结果挑走的是分享用的那张。
  */
  const base = path.posix.basename(candidate.rel).replace(/\.[a-z0-9]+$/i, '')
  if (base === 'logo' || base === 'icon') score += 1
  return score
}

/**
 * 名字里有没有这个项目。
 *
 * 两种匹配：整个项目名去掉分隔符后出现在文件名里（`ai-novel-writer-logo-…`），
 * 或者项目名的**第一个词**作为一个独立的词出现（`Knowe-banner.png`、`kun.png`）。
 * 后一条是必要的——仓库里的图常常只带名字的前半段。
 * 少于 3 个字符的名字不当线索：`go` 会命中 `logo`、`google` 这类无关的词。
 */
function mentionsProject(name: string, alt: string, projectName: string): boolean {
  const tokens = words(projectName).split(' ').filter(Boolean)
  const whole = tokens.join('')
  const flat = (s: string) => s.replace(/ /g, '')
  if (whole.length >= 3 && (flat(name).includes(whole) || flat(alt).includes(whole))) return true

  const first = tokens[0] ?? ''
  if (first.length < 3) return false
  return new RegExp(`\\b${first}\\b`).test(name) || new RegExp(`\\b${first}\\b`).test(alt)
}

/** 选出唯一的一个；没有够格的候选就 null。同分时取 README 里靠前的。 */
export function chooseLogo(projectName: string, candidates: LogoCandidate[]): LogoPick | null {
  const usable = candidates
    .filter((c) => !isPreviewish(c.rel) && explicitLogo(c))
    .sort(
      (a, b) => scoreLogo(b, projectName) - scoreLogo(a, projectName) || a.order - b.order,
    )
  const best = usable[0]
  return best ? { path: best.rel, from: best.from } : null
}

/**
 * 识别入口：读 README 头部 + 看几个常见目录，选出一个。
 *
 * **目录不在了、没有 README、README 是二进制**都只是「认不出来」，不是错误——
 * 这个功能的失败态就是「没有 logo」，界面上什么都不显示。
 */
export async function findLogo(dir: string, projectName: string): Promise<LogoPick | null> {
  const candidates: LogoCandidate[] = []

  const readme = await readReadme(dir, { maxBytes: README_HEAD_BYTES }).catch(() => null)
  if (readme?.content) {
    readmeImages(readme.content).forEach((img, order) => {
      const rel = normalizeLogoRef(img.src)
      if (rel) candidates.push({ rel, alt: img.alt, order, from: 'readme' })
    })
  }

  // README 没引用、但仓库里确实躺着一个 logo 文件（`public/logo.svg` 这种）
  let order = 1000
  for (const sub of LOGO_DIRS) {
    const entries = await fs.promises.readdir(path.join(dir, sub)).catch(() => [])
    for (const entry of entries) {
      if (!LOGO_WORD.test(words(entry)) || !isImagePath(entry)) continue
      candidates.push({ rel: sub ? `${sub}/${entry}` : entry, order: order++, from: 'file' })
    }
  }

  const existing: LogoCandidate[] = []
  for (const c of candidates) {
    // `..` 已经在 normalizeLogoRef 里挡掉了；这里的 stat 只是「真有这个文件吗」
    const stat = await fs.promises.stat(path.join(dir, ...c.rel.split('/'))).catch(() => null)
    if (!stat?.isFile() || stat.size === 0 || stat.size > LOGO_MAX_BYTES) continue
    existing.push(c)
  }

  return chooseLogo(projectName, existing)
}
