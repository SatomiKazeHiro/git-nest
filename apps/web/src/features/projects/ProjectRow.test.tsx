import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import type { ProjectListItem } from '@git-nest/core'
import { ProjectRow } from './ProjectRow'

/**
 * 刷新页面时「同步状态」那一列跳动——**这个 bug 的实际现场**。
 *
 * 清单先到（它带着库里的 `attention`，所以 `hasCheck` 一开始就是真），
 * 逐仓库的 git 状态 1–2 秒后才到。在那一刻 `ProjectRow` 拿到的 `status` 是
 * `undefined`，它递下去的 `ahead/behind` 就是 `null`。
 *
 * 组件层的约定在 `features/status/badges.test.tsx`（那是「没依据就别给结论」）；
 * 这条钉的是**接线**：`ProjectRow` 必须把「读没读到」这件事一起传下去，
 * 否则上游修好了、这里漏传，症状原样回来。
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
  // 库里有上次检查的结论 → hasCheck 为真 → 修之前这一行会显示「一致」
  latestCheck: {
    checkedAt: '2026-10-05T00:00:00Z',
    status: 'up_to_date',
    aheadCount: 0,
    behindCount: 0,
    recommendation: null,
  },
  attention: 'synced',
}

function renderRow() {
  return render(
    <MemoryRouter>
      <table>
        <tbody>
          <ProjectRow
            project={project}
            status={undefined}
            current={false}
            onOpen={() => {}}
            onRemove={() => {}}
          />
        </tbody>
      </table>
    </MemoryRouter>,
  )
}

describe('ProjectRow · 状态还没读回来时的两列', () => {
  it('不给「一致」，也不给编出来的「↓0 ↑0」，只给「—」', () => {
    const { container } = renderRow()
    const text = container.textContent ?? ''

    expect(text).not.toContain('一致')
    expect(text).not.toContain('↓')
    expect(text).not.toContain('↑')
    // 占位符在场：证明这一行确实渲染了，而不是「什么都没渲染」把上面两条蒙过去
    expect(text).toContain('—')
  })
})
