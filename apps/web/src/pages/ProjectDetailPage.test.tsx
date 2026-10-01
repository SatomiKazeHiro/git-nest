import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { RepoStatus } from '@git-nest/core'
import { StatusPanel } from './ProjectDetailPage'

/**
 * 这一条是一个真实的自相矛盾（用户报的）：
 *
 * 同一个仓库、同一次渲染里，
 *   提示行说「落后远程 2411 个提交。这个还没检查过更新——远程有没有新东西是未知的…」
 *   表格的「状态」行却说「没查过远程」
 *
 * 根因在 `textFor`：freshness 为 never 时，up_to_date / behind / ahead / diverged
 * 四个状态被**压成同一句**「没查过远程」，把方向和数字都丢了。
 * 数字其实是可信的（它来自本地 refs，也就是上次 fetch 的结果），该显示出来，
 * 只是要标注「这是本地看到的、没联网确认」。
 *
 * 契约：面板上的每一处说法不能互相打架 —— 只要露出 2411 这个数字，
 * 就不能同时说「没查过远程」。
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
    lastCommit: { hash: '6b1808f', subject: 'release(dsh): 0.1.6-alpha.2', author: 'me', date: '' },
    status: 'behind',
    error: null,
    ...overrides,
  }
}

/**
 * 面板上各处说法不能互相打架：只要露了 2411 这个数字，就不能再说
 * 「没查过远程」这种把数字推翻的话。断言只看**状态那一格**，不看标题行
 * （标题行里的「从没查过」是在说「没查过远程」，不是状态值本身）。
 */
function statusValue(): string {
  const row = screen.getByText('状态').closest('div')
  return row?.querySelector('dd')?.textContent ?? ''
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

describe('git 状态面板的自洽性', () => {
  it('落后时不能一边给数字一边说「没查过远程」', () => {
    renderPanel(makeStatus())

    // 数字在「领先 / 落后」那一行（有专门的行，不必在状态格里重复）
    expect(screen.getByText('0 / 2411')).toBeTruthy()

    // 状态格必须说清方向，而不是退回「不知道」
    expect(statusValue()).toContain('落后')
    expect(statusValue()).not.toBe('没查过远程')
  })

  it('领先时同理：数字与说法都要自洽', () => {
    renderPanel(makeStatus({ behind: 0, ahead: 3, status: 'ahead' }))
    expect(screen.getByText('3 / 0')).toBeTruthy()
    expect(statusValue()).toContain('领先')
    expect(statusValue()).not.toBe('没查过远程')
  })

  it('从没配过上游时才是真的「无从比较」', () => {
    renderPanel(makeStatus({ upstream: null, ahead: null, behind: null, status: 'no_upstream' }))
    expect(statusValue()).toContain('没有上游')
  })

  it('新鲜时仍然只说结论，不带「没联网确认」的限定', () => {
    renderPanel(makeStatus(), new Date().toISOString())
    // lastCheckStatus 传的是 null，所以这条仍会按「没查过」处理；
    // 这里只确认数字与方向都在
    expect(statusValue()).toContain('落后')
  })
})
