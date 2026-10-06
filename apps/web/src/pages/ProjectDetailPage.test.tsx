import { describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { VERDICT_LABEL, type RepoStatus, type UpdateVerdict } from '@git-nest/core'
import { StatusPanel, RecordView, RemoteRow, isWebUrl } from './ProjectDetailPage'

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
    dirtyTracked: 0,
    dirtyUntracked: 0,
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

  it('脏不脏不当主角：落后时标题仍是「落后」，脏只作为旁边一句提醒（且说清是哪一种）', () => {
    renderPanel(makeStatus({ dirty: true, dirtyCount: 9, dirtyTracked: 2, dirtyUntracked: 7, status: 'dirty' }))

    const line = summaryLine()
    // 主角是远程相对结论，不是「有未提交改动」
    expect(line.textContent).toContain('落后远程')
    expect(line.textContent).toContain('↓2411')
    // 但脏这件事也不能被藏掉——它决定了「拉了会不会踩到你」。
    // 而且要分开说「你改过的」和「未跟踪的」：一律说「有 N 处未提交改动」
    // 会让人以为工具在无理由地拦他（未跟踪的八成是构建产物）。
    expect(line.textContent).toContain('2 个文件被改')
    expect(line.textContent).toContain('7 个未跟踪')
  })

  it('只有未跟踪文件时不谎报「你改过文件」', () => {
    renderPanel(makeStatus({ dirty: true, dirtyCount: 7, dirtyTracked: 0, dirtyUntracked: 7, status: 'dirty' }))

    const line = summaryLine()
    expect(line.textContent).toContain('7 个未跟踪文件')
    expect(line.textContent).not.toContain('个文件被改')
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

/**
 * 判决块的底色。
 *
 * **绿色只给 `safe` 一个判决。** 这条很容易写坏：写成 `bad ? 红底 : 绿底`
 * 之后，`diverged`（要你决定）、`gone`（上游已被删）、`no_upstream`（没有上游）
 * 会被一律涂成绿色——而绿色在这个应用里只表示「可以安全快进」。
 * 「上游已被删」涂成绿色，正是本仓库反复要避免的**用颜色替用户下结论**。
 *
 * 而且颜色不能是唯一线索：无论底色如何，判决词本身必须以文字出现。
 */
describe('判决块的底色', () => {
  const verdictOf = (): HTMLElement => screen.getByTestId('recommendation')

  function withVerdict(verdict: UpdateVerdict): void {
    renderPanel(
      makeStatus({
        recommendation: {
          verdict,
          ahead: null,
          behind: 0,
          canPull: verdict === 'safe',
          reason: '理由',
        },
      }),
    )
  }

  it('safe：绿底（唯一可以安全快进的判决）', () => {
    withVerdict('safe')
    expect(verdictOf().className).toContain('bg-wash-ok')
  })

  it.each<UpdateVerdict>(['rewritten', 'unrelated'])('%s：红底（别拉）', (verdict) => {
    withVerdict(verdict)
    expect(verdictOf().className).toContain('bg-wash-bad')
  })

  it.each<UpdateVerdict>(['diverged', 'gone', 'no_upstream'])(
    '%s：不着色（既不是「可以」也不是「别拉」，是你得自己看一眼）',
    (verdict) => {
      withVerdict(verdict)
      const cls = verdictOf().className
      expect(cls).not.toContain('bg-wash-ok')
      expect(cls).not.toContain('bg-wash-bad')
    },
  )

  it('没查过时：不着色，且说清为什么给不出结论', () => {
    renderPanel(makeStatus({ recommendation: null }))
    const block = verdictOf()
    expect(block.className).not.toContain('bg-wash-ok')
    expect(block.className).not.toContain('bg-wash-bad')
    expect(block.textContent).toContain('还没查过')
    expect(block.textContent).toContain('本地是看不出来')
  })

  it('判决词始终以文字出现，不靠颜色单独传意', () => {
    for (const verdict of ['safe', 'rewritten', 'unrelated', 'gone'] as UpdateVerdict[]) {
      cleanup()
      withVerdict(verdict)
      expect(verdictOf().textContent).toContain(VERDICT_LABEL[verdict])
    }
  })
})

/**
 * 记录在页面上是**只读**的（唯一的编辑器是「编辑资料」弹窗），所以链接必须可点——
 * 记录里写的多是「在 B 站看到 → 顺着找到 GitHub」这类句子，链接不可点等于要手抄。
 *
 * 钉的是那个 `split` 的奇偶位技巧：带捕获组时奇数位才是 URL 本身。
 * 一处写错（比如反过来判断）整段文字就会串行，肉眼很难看出来。
 */
describe('记录（只读）', () => {
  it('正文里的多个 URL 都变成可点链接，其余文字原样保留', () => {
    const { container } = render(
      <RecordView record={'在 B 站看到 https://example.invalid/v/1 ，顺着它找到 https://example.invalid/r/2 的'} />,
    )

    const links = [...container.querySelectorAll('a')]
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      'https://example.invalid/v/1',
      'https://example.invalid/r/2',
    ])
    expect(container.textContent).toContain('在 B 站看到')
    expect(container.textContent).toContain('顺着它找到')
    expect(container.textContent).toContain('的')
  })

  it('换行照原样留着（记录是一段一段写的）', () => {
    const { container } = render(<RecordView record={'第一行\n第二行'} />)
    expect(container.textContent).toBe('第一行\n第二行')
  })

  it('空记录给一句「去哪儿写」，而不是留一片空白', () => {
    const { container } = render(<RecordView record="" />)
    expect(container.textContent).toContain('还没写')
    expect(container.querySelector('a')).toBeNull()
  })
})

/**
 * 用户报的 bug：远程写的是 `git@github.com:Hufe921/canvas-editor.git`，
 * 而那个 `<a href>` 把它当相对路径，点一下跳到
 * `http://localhost:5174/projects/git@github.com:Hufe921/canvas-editor.git`。
 *
 * 用户的裁决：给不出真的（可点开的网页地址）就别占这一行。
 * 所以现在是三态：https → 一行链接；SSH / file / 本地路径 → 整行不出；
 * 没有 remote → 整行不出（「git 状态」里写着没有配置 origin）。
 */
describe('远程那一行', () => {
  it('https 形式占一行，且 href 就是它本身', () => {
    const { container } = render(<RemoteRow url="https://github.com/Hufe921/canvas-editor.git" />)

    const link = container.querySelector('a')
    expect(link?.getAttribute('href')).toBe('https://github.com/Hufe921/canvas-editor.git')
    expect(link?.getAttribute('rel')).toBe('noreferrer')
    expect(container.textContent).toContain('远程')
  })

  it('SSH 形式整行不出（给不出真链接就别占位）', () => {
    const { container } = render(<RemoteRow url="git@github.com:Hufe921/canvas-editor.git" />)

    expect(container.textContent).toBe('')
    expect(container.querySelector('a')).toBeNull()
  })

  it('file:// 与 Windows 路径也不出行', () => {
    for (const url of ['file:///D:/repos/x', 'D:/repos/x', '\\\\server\\share\\x']) {
      const { container } = render(<RemoteRow url={url} />)
      expect(container.textContent, url).toBe('')
    }
  })

  it('没有 remote 时不出行', () => {
    const { container } = render(<RemoteRow url={null} />)
    expect(container.textContent).toBe('')
  })

  it('判据本身：只认 http/https（大小写不敏感）', () => {
    expect(isWebUrl('HTTP://example.invalid/x')).toBe(true)
    expect(isWebUrl('https://example.invalid/x')).toBe(true)
    expect(isWebUrl('git@example.invalid:x.git')).toBe(false)
    expect(isWebUrl('ssh://git@example.invalid/x.git')).toBe(false)
  })
})
