import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { RepoStatus } from '@git-nest/core'
import { StatusPanel } from './ProjectDetailPage'

/**
 * 这一条曾是一个真实的自相矛盾（用户报的）：
 *
 * 同一个仓库、同一次渲染里，
 *   提示行说「落后远程 2411 个提交。这个还没检查过更新…」
 *   表格的「状态」行却说「没查过远程」
 *
 * 根因在 `textFor`：freshness 为 never 时，up_to_date / behind / ahead / diverged
 * 四个状态被**压成同一句**「没查过远程」，把方向和数字都丢了。
 * 数字其实是可信的（它来自本地 refs，也就是上次 fetch 的结果），该显示出来，
 * 只是要标注「这是本地看到的、没联网确认」。
 *
 * 后来面板又从「6 行仪表盘」收敛成**一行摘要**（状态 / 当前分支 / 上游分支 /
 * 领先落后 / 远程地址 / 最后提交 → 结论 + ↑↓ + 上游 + 上游最后提交）。
 * 那个矛盾因此变成**结构上不可能**：结论和数字现在在同一个容器里，
 * 再也不可能一处说「落后 2411」、另一处说「不知道」。
 *
 * 所以这里钉两件事：结论与方向同现，且不再显示分支名。
 */

function makeStatus(overrides: Partial<RepoStatus> = {}): RepoStatus {
  return {
    path: 'D:/repos/some-repo',
    checkedAt: '2026-10-01T12:00:00+08:00',
    isRepo: true,
    branch: 'master',
    detached: false,
    dirty: false,
    dirtyCount: 0,
    upstream: 'origin/master',
    upstreamGone: false,
    ahead: 0,
    behind: 2411,
    remoteUrl: 'git@github.com:deepseek-ai/deepseek-harness.git',
    lastCommit: { hash: '6b1808f', subject: 'release(dsh): 0.1.6-alpha.2', author: 'me', date: '2026-09-28T10:00:00+08:00' },
    recommendation: null,
    status: 'behind',
    error: null,
    ...overrides,
  }
}

function renderPanel(status: RepoStatus, lastCheckAt: string | null = null) {
  return render(
    <StatusPanel
      status={status}
      isFetching={false}
      onRefresh={() => {}}
      lastCheckAt={lastCheckAt}
      lastCheckStatus={null}
    />,
  )
}

/** 摘要那一行的容器：结论、箭头、上游都在里面（`data-testid` 见 StatusPanel） */
function summaryLine(): HTMLElement {
  return screen.getByTestId('status-summary')
}

describe('git 状态摘要', () => {
  it('落后时：结论、数字、上游同现，不出现互相打架的说法', () => {
    renderPanel(makeStatus())

    const line = summaryLine()
    expect(line.textContent).toContain('落后远程')
    expect(line.textContent).toContain('↓2411')
    expect(line.textContent).toContain('origin/master')
    // 只要露了数字，就不能同时说「不知道」
    expect(line.textContent).not.toBe('没查过远程')
  })

  it('脏不脏不当主角：落后时标题仍是「落后」，脏只作为旁边一句提醒', () => {
    renderPanel(makeStatus({ dirty: true, dirtyCount: 9, status: 'dirty' }))

    const line = summaryLine()
    // 主角是远程相对结论，不是「有未提交改动」
    expect(line.textContent).toContain('落后远程')
    expect(line.textContent).toContain('↓2411')
    // 但脏这件事也不能被藏掉——它决定了「拉了会不会踩到你」
    expect(line.textContent).toContain('有未提交改动')
  })

  it('领先时同理：方向和数字都要在', () => {
    renderPanel(makeStatus({ behind: 0, ahead: 3, status: 'ahead' }))

    const line = summaryLine()
    expect(line.textContent).toContain('领先远程')
    expect(line.textContent).toContain('↑3')
  })

  it('从没配过上游时才是真的「无从比较」', () => {
    renderPanel(makeStatus({ upstream: null, ahead: null, behind: null, status: 'no_upstream' }))

    const line = summaryLine()
    expect(line.textContent).toContain('没有上游')
    expect(line.textContent).not.toContain('↓')
  })

  it('不再显示当前分支名——那是 git 客户端的事', () => {
    renderPanel(makeStatus())
    // 分支名 'master' 不该以独立文本出现（上游 'origin/master' 里含它是允许的）
    expect(screen.queryByText('master')).toBeNull()
  })

  it('显示上游最后一次提交的相对时间（回答「作者上次更新是什么时候」）', () => {
    renderPanel(makeStatus())
    expect(screen.getByText(/上游最后提交/)).toBeTruthy()
  })
})
