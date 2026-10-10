import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import type { ProjectListItem, RepoStatus } from '@git-nest/core'
import { ProjectRow } from './ProjectRow'

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
  // 库里有上次检查的结论 → hasCheck 为真 → 修之前这两条路都会显示「一致」
  latestCheck: {
    checkedAt: '2026-10-05T00:00:00Z',
    status: 'up_to_date',
    aheadCount: 0,
    behindCount: 0,
    recommendation: null,
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

function renderRow(s?: RepoStatus) {
  return render(
    <MemoryRouter>
      <table>
        <tbody>
          <ProjectRow
            project={project}
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

describe('ProjectRow · 「同步状态」列不许说没依据的话', () => {
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

  it('读到了、真落后 3 个：正常显示「远程领先」与 ↓3', () => {
    const { container } = renderRow(status({ behind: 3 }))
    const text = container.textContent ?? ''

    expect(text).toContain('远程领先')
    expect(text).toContain('↓3')
  })
})
