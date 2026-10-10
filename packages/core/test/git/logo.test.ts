import { afterAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  chooseLogo,
  findLogo,
  isPreviewish,
  normalizeLogoRef,
  readmeImages,
  type LogoCandidate,
} from '../../src/git/logo.ts'
import { cleanup, tempDir } from '../helpers/repo.ts'

/**
 * Logo 识别。
 *
 * 这些用例里的文件名**全是从真实仓库里抄来的**（本机清单里 15 个项目的 README）：
 * `imgs/transcript.png`、`docs/images/workspace-overview.png`、
 * `assets/logo-dark.svg#gh-dark-mode-only`、`YouTube%20Digest%20demo.png`、
 * `docs/assets/readme/ai-novel-writer-logo-transparent.png`、`src/asset/img/kun.png`、
 * `docs/assets/archify-readme-hero.png`、`public/logo.svg`。
 *
 * 自己编的漂亮样例护不住这些东西：真正难的是「第一张图是截图」「明暗两版选哪个」
 * 「名字里带空格且被百分号编码」「README 压根没引用那个 logo 文件」。
 */

const dirs: string[] = []
const track = (dir: string) => (dirs.push(dir), dir)
afterAll(() => cleanup(...dirs))

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00])

/** 搭一个仓库形状的目录。 */
function repo(files: Record<string, string | Buffer>): string {
  const dir = track(tempDir())
  for (const [name, data] of Object.entries(files)) {
    const abs = path.join(dir, name)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, data)
  }
  return dir
}

const candidate = (rel: string, extra: Partial<LogoCandidate> = {}): LogoCandidate => ({
  rel,
  order: 0,
  from: 'readme',
  ...extra,
})

describe('readmeImages', () => {
  it('markdown 与 HTML 两种写法都提，按出现顺序', () => {
    const text = [
      '# 标题',
      '![架构](docs/arch.png)',
      '<p align="center"><img src="assets/logo.svg" width="200"></p>',
      '![演示](imgs/demo.gif "标题")',
    ].join('\n')
    expect(readmeImages(text).map((i) => i.src)).toEqual([
      'docs/arch.png',
      'assets/logo.svg',
      'imgs/demo.gif',
    ])
    expect(readmeImages(text)[0]?.alt).toBe('架构')
  })

  it('HTML 属性里带空格要留住：`alt="Kun 蓝色 K 标识"`', () => {
    const text = '<img src="src/asset/img/kun.png" width="88" alt="Kun 蓝色 K 标识">'
    expect(readmeImages(text)[0]).toEqual({
      src: 'src/asset/img/kun.png',
      alt: 'Kun 蓝色 K 标识',
    })
  })
})

describe('findLogo（Kun 那条真实写法）', () => {
  it('文件名没线索，答案在 alt 里：`标识` 两个字就是判据', async () => {
    const dir = repo({
      'README.md': [
        '# Kun',
        '',
        '<p align="center">',
        '  <img src="src/asset/img/kun.png" width="88" alt="Kun 蓝色 K 标识">',
        '</p>',
      ].join('\n'),
      'src/asset/img/kun.png': png,
    })
    expect(await findLogo(dir, 'Kun')).toEqual({ path: 'src/asset/img/kun.png', from: 'readme' })
  })
})

describe('normalizeLogoRef', () => {
  it('远程、绝对、协议相对、想往上跳的，一律不要', () => {
    expect(normalizeLogoRef('https://img.shields.io/badge/ci-pass-green')).toBeNull()
    expect(normalizeLogoRef('data:image/png;base64,AAAA')).toBeNull()
    expect(normalizeLogoRef('//cdn.example.com/logo.png')).toBeNull()
    expect(normalizeLogoRef('/static/logo.png')).toBeNull()
    expect(normalizeLogoRef('../../../etc/passwd')).toBeNull()
    expect(normalizeLogoRef('docs/../../outside.png')).toBeNull()
  })

  it('只认图片扩展名', () => {
    expect(normalizeLogoRef('docs/manual.pdf')).toBeNull()
    expect(normalizeLogoRef('LICENSE')).toBeNull()
  })

  it('百分号编码、`./`、片段、查询串都落到真实文件上', () => {
    expect(normalizeLogoRef('YouTube%20Digest%20demo.png')).toBe('YouTube Digest demo.png')
    expect(normalizeLogoRef('./public/logo.svg')).toBe('public/logo.svg')
    expect(normalizeLogoRef('assets/logo-dark.svg#gh-dark-mode-only')).toBe(
      'assets/logo-dark.svg',
    )
    expect(normalizeLogoRef('public/icon.png?raw=1')).toBe('public/icon.png')
  })
})

describe('isPreviewish', () => {
  it('预览图 / 截图那一家子出局——这些名字全是真的', () => {
    /*
      `imgs/transcript.png` **不在这个名单里**：它不是「预览图」那一家子的名字，
      它是靠**分数不够**出局的（没有任何 logo / icon / 项目名的线索，得 0 分）。
      两条路都要有——只靠名单挡不住随便一个 `cover.png`。

      `docs/screenshots/desktop-console.png` 靠的是目录名：文件名什么都没说。
    */
    for (const name of [
      'docs/images/workspace-overview.png',
      'docs/assets/archify-readme-hero.png',
      'docs/assets/archify-demo-story.png',
      'docs/screenshots/desktop-console.png',
      'public/og-image.png',
      'docs/assets/readme/ui-zh-v085-project-config.png',
      'assets/images/Knowe-banner.png',
      'resource/output/all_naive_unigram_tsne_chart.png',
      'docs/screen capture 2024.png',
    ]) {
      expect(isPreviewish(name), name).toBe(true)
    }
  })

  it('看整条路径：目录叫 screenshots 就够，文件名不必再说什么', () => {
    expect(isPreviewish('docs/screenshots/anything.png')).toBe(true)
    expect(isPreviewish('docs/screenshots/logo.png')).toBe(false)
  })

  it('名字里带 logo / icon 的**不算**预览图——`ui-kit-logo.png` 是 logo', () => {
    expect(isPreviewish('ui-kit-logo.png')).toBe(false)
    expect(isPreviewish('logo-preview.png')).toBe(false)
  })
})

describe('chooseLogo', () => {
  it('截图再多也压不过一个 logo：bilibili-digest 那种「第一张是截图」', () => {
    const picked = chooseLogo('bilibili-digest', [
      candidate('imgs/transcript.png', { order: 0 }),
      candidate('imgs/overview.png', { order: 1 }),
      candidate('docs/bilibili-digest-logo.png', { order: 2 }),
    ])
    expect(picked?.path).toBe('docs/bilibili-digest-logo.png')
  })

  it('截图自己一个都不够格：宁可没有，也不要一张缩成 16px 的截图', () => {
    expect(
      chooseLogo('bilibili-digest', [
        candidate('imgs/transcript.png', { order: 0 }),
        candidate('imgs/overview.png', { order: 1 }),
        candidate('docs/cover.png', { order: 2 }),
      ]),
    ).toBeNull()
  })

  it('明暗两版同时存在时挑浅色那版（我们的界面是浅色底）', () => {
    const picked = chooseLogo('goink', [
      candidate('assets/logo-dark.svg', { order: 0 }),
      candidate('assets/logo-light.svg', { order: 1 }),
    ])
    expect(picked?.path).toBe('assets/logo-light.svg')
  })

  it('**只有项目名不算资格**：archify 的截图全叫 `archify-xxx.png`', () => {
    expect(chooseLogo('archify', [candidate('docs/assets/archify-menu.png')])).toBeNull()
    expect(
      chooseLogo('archify', [candidate('docs/assets/archify-light.png', { alt: 'Light theme' })]),
    ).toBeNull()
  })

  it('项目名是**并列时的偏好**，不是资格', () => {
    expect(
      chooseLogo('Kun', [
        candidate('docs/icon.png', { order: 0 }),
        candidate('docs/kun-icon.png', { order: 1 }),
      ])?.path,
    ).toBe('docs/kun-icon.png')
  })

  it('主题变体图出局：archify 的 `## Preview` 那张「Dark / Light」对照表', () => {
    expect(
      chooseLogo('archify', [
        candidate('docs/assets/archify-dark.png', { alt: 'Dark theme', order: 0 }),
        candidate('docs/assets/archify-light.png', { alt: 'Light theme', order: 1 }),
      ]),
    ).toBeNull()
  })

  it('但名字里有 logo 的不受影响：goink 的两版仍然认得出，还是挑浅色那版', () => {
    expect(
      chooseLogo('goink', [
        candidate('assets/logo-dark.svg', { alt: 'Goink', order: 0 }),
        candidate('assets/logo-light.svg', { alt: 'Goink', order: 1 }),
      ])?.path,
    ).toBe('assets/logo-light.svg')
  })

  it('文件名没线索、答案在 alt 里：`alt="Kun 蓝色 K 标识"`', () => {
    expect(chooseLogo('Kun', [candidate('src/asset/img/mark.png', { alt: 'Kun 蓝色 K 标识' })])?.path)
      .toBe('src/asset/img/mark.png')
  })

  it('名字就是 `logo` 的那个赢过变体（真机上是 `logo.svg` vs `logo-share.svg`）', () => {
    expect(
      chooseLogo('a-share-heatmap', [
        candidate('public/logo-share.svg', { from: 'file', order: 1000 }),
        candidate('public/logo.svg', { from: 'file', order: 1001 }),
      ])?.path,
    ).toBe('public/logo.svg')
  })

  it('生成的产物不当 logo：`resource/output/…tsne.png` 是一张图表，只是名字里有项目名', () => {
    expect(
      chooseLogo('fanren-novel-stylometry', [
        candidate('resource/output/fanren_naive_unigram_tsne.png'),
      ]),
    ).toBeNull()
  })

  it('gif 不当候选：真机上那个是演示录屏（`archify-live-proof.gif`）', () => {
    expect(normalizeLogoRef('docs/assets/archify-live-proof.gif')).toBeNull()
    expect(chooseLogo('archify', [candidate('docs/assets/archify-live-proof.gif')])).toBeNull()
  })

  it('名字太短的线索不算数：`go` 不该命中 `logo`', () => {
    expect(chooseLogo('Go', [candidate('docs/setup.png')])).toBeNull()
  })

  it('alt 文本里有 logo 也算（`![logo](docs/mark.png)`）', () => {
    expect(chooseLogo('x', [candidate('docs/mark.png', { alt: 'logo' })])?.path).toBe(
      'docs/mark.png',
    )
  })
})

describe('findLogo', () => {
  it('README 里的徽章（远程）一个都不看，认仓库里那个 logo', async () => {
    const dir = repo({
      'README.md': [
        '# AI-Novel-Writer',
        '',
        '[![CI](https://img.shields.io/badge/ci-pass-green)](https://ci.example.com)',
        '![界面](docs/assets/readme/ui-zh-v085-project-config.png)',
        '<img src="docs/assets/readme/ai-novel-writer-logo-transparent.png" width="120">',
      ].join('\n'),
      'docs/assets/readme/ui-zh-v085-project-config.png': png,
      'docs/assets/readme/ai-novel-writer-logo-transparent.png': png,
    })
    const pick = await findLogo(dir, 'AI-Novel-Writer')
    expect(pick).toEqual({
      path: 'docs/assets/readme/ai-novel-writer-logo-transparent.png',
      from: 'readme',
    })
  })

  it('README 没引用、但 public/ 里躺着一个 logo.svg：捞回来（a-share-heatmap）', async () => {
    const dir = repo({
      'README.md': '# a-share-heatmap\n\n![预览](./public/og-image.png)\n![界面](./public/preview.png)\n',
      'public/og-image.png': png,
      'public/preview.png': png,
      'public/logo.svg': '<svg/>',
    })
    const pick = await findLogo(dir, 'a-share-heatmap')
    expect(pick).toEqual({ path: 'public/logo.svg', from: 'file' })
  })

  it('引用了一个不存在的文件：不当候选（README 里写错了很常见）', async () => {
    const dir = repo({ 'README.md': '# x\n\n![logo](docs/logo.png)\n' })
    expect(await findLogo(dir, 'x')).toBeNull()
  })

  it('想往上跳的引用不认，哪怕那个文件真的存在', async () => {
    const dir = repo({
      'README.md': '# x\n\n![logo](../../secret/logo.png)\n',
      'secret/logo.png': png,
    })
    expect(await findLogo(dir, 'x')).toBeNull()
  })

  it('过大的图不当 logo', async () => {
    const dir = repo({
      'README.md': '# x\n\n![logo](docs/logo.png)\n',
      'docs/logo.png': Buffer.alloc(3 * 1024 * 1024),
    })
    expect(await findLogo(dir, 'x')).toBeNull()
  })

  it('没有 README 也没有 logo 文件 → null', async () => {
    const dir = repo({ 'src/index.ts': 'export {}\n' })
    expect(await findLogo(dir, 'x')).toBeNull()
  })

  it('目录不在了 → null（识别不出来不是错误，界面上就是没有 logo）', async () => {
    expect(await findLogo(path.join(tempDir(), '不存在'), 'x')).toBeNull()
  })
})
