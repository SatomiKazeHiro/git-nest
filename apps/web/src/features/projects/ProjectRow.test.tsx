import { describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import type { ProjectListItem, RepoStatus } from '@git-nest/core'
import { formatRelative } from '@/lib/format'
import { ProjectRow } from './ProjectRow'

/*
  类型角标的图标来自使用者自己填的 `assets/types/`（现在大概还是空的），
  所以「查图标」那一层换成可控的：这里要测的是**角标出不出现在该出现的地方**。
*/
vi.mock('./typeIcons', () => ({
  typeIconUrl: (type: string | null) => (type === 'vue' ? 'data:image/svg+xml,<svg/>' : null),
}))

/**
 * 「同步状态」那一列不许说出没有依据的话——**这个 bug 的实际现场**。
 *
 * 两条路都钉在这里，因为它们看起来完全不同、根因却是同一个（把 `null` 当 0）：
 * 1. **刷新页面**：清单先到（带着库里的 `attention`，所以 `hasCheck` 一开始就是真），
 *    逐仓库的 git 状态 1–2 秒后才到；此间 `status` 是 `undefined`。
 * 2. **取消上游配置之后**：状态读回来了，但 `upstream` 是 null，
 *    而库里上次的结论还在（`hasCheck` 仍为真）。
 *
 * 组件层的约定在 `features/status/badges.test.tsx`；这里钉的是**接线**：
 * `ProjectRow` 必须把「有没有可比的对象」这件事传下去，否则上游修好了、
 * 这里漏传，症状原样回来。
 */
const project: ProjectListItem = {
  id: 5,
  name: 'canvas-editor',
  path: 'D:/repos/canvas-editor',
  remoteUrl: 'https://example.invalid/canvas-editor.git',
  isOwn: false,
  category: 'tools',
  record: '',
  addedAt: '2026-10-01T00:00:00Z',
  sortOrder: 1,
  tags: [],
  hasLogo: false,
  projectType: null,
  // 库里有上次检查的结论 → hasCheck 为真 → 修之前这两条路都会显示「一致」
  latestCheck: {
    checkedAt: '2026-10-05T00:00:00Z',
    status: 'up_to_date',
    aheadCount: 0,
    behindCount: 0,
    recommendation: null,
  },
  // 这一份是「最近一次尝试」；默认这条夹具里它是成功的，警示那组用例再覆盖它
  lastAttempt: {
    at: '2026-10-05T00:00:00Z',
    status: 'up_to_date',
    error: null,
  },
  attention: 'synced',
}

/** 一个刚读过、与远程一致的仓库，再按需覆盖字段 */
function status(overrides: Partial<RepoStatus> = {}): RepoStatus {
  return {
    path: project.path,
    checkedAt: '2026-10-05T00:00:00Z',
    isRepo: true,
    branch: 'main',
    detached: false,
    dirty: false,
    dirtyCount: 0,
    dirtyTracked: 0,
    dirtyUntracked: 0,
    upstream: 'origin/main',
    upstreamGone: false,
    ahead: 0,
    behind: 0,
    remoteUrl: project.remoteUrl,
    lastCommit: null,
    recommendation: null,
    status: 'up_to_date',
    error: null,
    ...overrides,
  }
}

function renderRow(s?: RepoStatus, overrides: Partial<ProjectListItem> = {}) {
  return render(
    <MemoryRouter>
      <table>
        <tbody>
          <ProjectRow
            project={{ ...project, ...overrides }}
            status={s}
            current={false}
            onOpen={() => {}}
            onRemove={() => {}}
          />
        </tbody>
      </table>
    </MemoryRouter>,
  )
}

describe('ProjectRow · 差异列不许说没依据的话', () => {
  it('状态还没读回来：不给「一致」，也不给编出来的「↓0 ↑0」，只给「—」', () => {
    const { container } = renderRow()
    const text = container.textContent ?? ''

    expect(text).not.toContain('一致')
    expect(text).not.toContain('↓')
    expect(text).not.toContain('↑')
    // 占位符在场：证明这一行确实渲染了，而不是「什么都没渲染」把上面两条蒙过去
    expect(text).toContain('—')
  })

  it('读到了、但这个分支没有上游：「没有上游」，不是「一致」', () => {
    const { container } = renderRow(status({ upstream: null, ahead: null, behind: null }))
    const text = container.textContent ?? ''

    expect(text).not.toContain('一致')
    expect(text).toContain('没有上游')
  })

  it('读不出来（目录不在了）：「—」，不是「没有上游」也不是「一致」', () => {
    const { container } = renderRow(
      status({
        isRepo: false,
        status: 'missing',
        upstream: null,
        ahead: null,
        behind: null,
        error: { kind: 'missing', message: '目录不在了' },
      }),
    )
    const text = container.textContent ?? ''

    expect(text).not.toContain('一致')
    expect(text).not.toContain('没有上游')
    expect(text).toContain('—')
  })

  it('读到了、真落后 3 个：正常显示 ↓3', () => {
    const { container } = renderRow(status({ behind: 3 }))
    const text = container.textContent ?? ''

    // 「远程领先」那个词原本住在「同步状态」那一列，那一列按设计文档收掉了；
    // 数字还在（而且它才是真正查到的东西）
    expect(text).toContain('↓3')
  })
})

/**
 * 「上次检查」这一格：**时间来自更早一次成功的检查，而最近一次尝试可能失败了**。
 *
 * 这是用户遇到过的真实困惑：一边写着「上次检查 42 分钟前 / 落后远程 ↓631」，
 * 一边最近三次检查全都失败（fetch 到 github 443 被重置），界面上一个字都不说。
 * 库里早就存着失败原因（`update_checks.detail.error`），只是没有任何地方读它。
 *
 * 两条一起钉：**警示只由「最近一次尝试」决定**，而**格子里显示的时间仍然来自
 * 最近一次成功**。只钉前者的话，一个「拿失败时间刷新格子」的实现也能过——
 * 那正是这个软件最要消灭的「没有依据的肯定」。
 */
describe('ProjectRow · 最近一次检查失败时，那一格要说出来', () => {
  const failedAttempt = {
    at: '2026-10-06T00:00:00Z',
    status: 'error' as const,
    error: {
      kind: 'network' as const,
      message: '连不上远程。检查网络、代理或 DNS',
      raw: 'fatal: unable to access ... Connection reset by peer',
    },
  }
  /** 上一次**成功**检查的时间，与上面那次失败**故意不同** */
  const lastSuccessAt = '2026-10-05T00:00:00Z'

  /** 那一格（`col-checked`），按类名取——`getByText` 会连标题里的文案一起命中 */
  const checkedCell = (container: HTMLElement) =>
    container.querySelector('td.col-checked') as HTMLElement

  it('最近一次尝试失败：加警示标记，标题里写清哪一次失败、为什么', () => {
    const { container } = renderRow(status(), {
      lastAttempt: failedAttempt,
      latestCheck: { ...project.latestCheck!, checkedAt: lastSuccessAt },
    })
    const cell = checkedCell(container)

    expect(cell.querySelector('[role="img"]')).not.toBeNull()
    const title = cell.getAttribute('title') ?? ''
    expect(title).toContain('最近一次检查失败')
    expect(title).toContain(failedAttempt.error.message)
  })

  it('**警示归警示，时间还是上次成功那一次的**（不拿失败时间冒充检查结论）', () => {
    const { container } = renderRow(status(), {
      lastAttempt: { ...failedAttempt, at: '2026-10-06T00:00:00Z' },
      latestCheck: { ...project.latestCheck!, checkedAt: '2026-10-05T00:00:00Z' },
    })
    const cell = checkedCell(container)
    const successText = formatRelative('2026-10-05T00:00:00Z')
    const attemptText = formatRelative('2026-10-06T00:00:00Z')

    // 文案要把两件事分开说：这是更早一次成功的时间
    expect(cell.getAttribute('title')).toContain('更早一次成功')
    // 而且显示的就是那个成功的时刻——前置断言两个时间的显示**确实不同**，
    // 否则这条用例在两天都落进同一个粒度（比如都变成日期）时会静默失效
    expect(successText).not.toBe(attemptText)
    expect(cell.textContent).toContain(successText)
    expect(cell.textContent).not.toContain(attemptText)
  })

  it('最近一次尝试是成功的：不加警示（这一格不是「检查出了问题」的告示栏）', () => {
    const { container } = renderRow(status(), {
      lastAttempt: { at: lastSuccessAt, status: 'up_to_date', error: null },
      latestCheck: { ...project.latestCheck!, checkedAt: lastSuccessAt },
    })
    const cell = checkedCell(container)

    expect(cell.querySelector('[role="img"]')).toBeNull()
    expect(cell.textContent).toContain(formatRelative(lastSuccessAt))
  })

  it('状态异常但没有归因（旧记录 / 半条记录）：只照旧显示时间，不塞一枚说不出原因的警示', () => {
    const { container } = renderRow(status(), {
      lastAttempt: { at: '2026-10-06T00:00:00Z', status: 'missing', error: null },
      latestCheck: { ...project.latestCheck!, checkedAt: lastSuccessAt },
    })
    const cell = checkedCell(container)

    expect(cell.querySelector('[role="img"]')).toBeNull()
    expect(cell.textContent).toContain(formatRelative(lastSuccessAt))
  })

  it('连一次成功的检查都没有，而最近一次尝试失败了：说清「还没有过成功的检查」', () => {
    const { container } = renderRow(status(), { lastAttempt: failedAttempt, latestCheck: null })
    const cell = checkedCell(container)

    expect(cell.querySelector('[role="img"]')).not.toBeNull()
    // 这一格里没有「上次成功的时间」可指，所以不能照抄那一句
    expect(cell.getAttribute('title')).toContain('还没有过一次成功的检查')
    expect(cell.textContent).toContain('没查过')
  })
})

/**
 * logo 与那张**默认文件夹图**是同一格：认出 logo 就顶掉它，认不出来才留着。
 * 并排放两个图标只是占地方——它们回答的是同一个问题（「这是哪个仓库」）。
 * 而且两种答案现在是同一类东西（都是 32×32 的图），不再是一图一 lucide 图标。
 */
describe('ProjectRow · 仓库那一格的图标', () => {
  it('认出了 logo：用它顶掉默认的文件夹图', () => {
    const { container } = renderRow(status(), { hasLogo: true })
    const imgs = [...container.querySelectorAll('img')]

    expect(imgs).toHaveLength(1)
    expect(imgs[0]?.getAttribute('src')).toBe('/api/projects/5/logo')
  })

  it('没认出来：显示 assets/folder.svg 那张默认图（认不出来是常态）', () => {
    const { container } = renderRow(status())
    const imgs = [...container.querySelectorAll('img')]
    const src = imgs[0]?.getAttribute('src') ?? ''

    expect(imgs).toHaveLength(1)
    expect(imgs[0]?.getAttribute('width')).toBe('32')
    /*
      钉的是**契约**而不是 URL 的样子：这张默认图不是取图接口。
      小于 4KB 的资源会被 Vite 内联成 data URI（构建与测试里就是这样），
      开发服务器上则是普通 URL——两种形态都对，断言不该依赖其中一种。
    */
    expect(src.startsWith('/api/')).toBe(false)
    expect(src.includes('folder.svg') || src.startsWith('data:image/svg+xml')).toBe(true)
  })

  it('默认文件夹图上压着类型角标（16×16 白圆那一个）', () => {
    const { container } = renderRow(status(), { projectType: 'vue' })

    // 两张图：默认文件夹 + 白圆里的类型图标
    expect(container.querySelectorAll('img')).toHaveLength(2)
    /*
      按**角标自己的特征**找，不按 `rounded-full`：行里那枚状态药丸也是圆角的，
      拿它当判据会两边都命中（第一版就是这么写的，另一条用例当场露了馅）。
    */
    expect(container.querySelector('span[style*="width: 16px"]')).not.toBeNull()
  })

  it('有 logo 的行**不压**角标——角标只叠在默认文件夹图上', () => {
    const { container } = renderRow(status(), { hasLogo: true, projectType: 'vue' })

    expect(container.querySelectorAll('img')).toHaveLength(1)
    expect(container.querySelector('span[style*="width: 16px"]')).toBeNull()
  })
})
