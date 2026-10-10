import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { UpdatePanel, type CheckTarget } from './UpdatePanel'
import { server } from '@/test/mocks/server'
import { FakeEventSource } from '@/test/setup'

/**
 * 这条链路的 happy path：
 * 检查更新 → 看到每个仓库的报告 → 勾选能更新的 → 更新 → 看到结果汇总。
 *
 * 进度靠 SSE 推，这里用可控的假 EventSource 驱动（见 test/setup.ts），
 * 比真 SSE 好测：事件顺序由测试决定，不会有时序抖动。
 */

/** 弹窗在开跑前就要把「将要检查谁」列出来，所以它拿到的是项目本身，不只是 id */
const TARGETS: CheckTarget[] = [
  { id: 1, name: 'behind-one', isOwn: false },
  { id: 2, name: 'up-to-date', isOwn: false },
  { id: 3, name: 'diverged', isOwn: false },
]

/** 默认给一份设置：阈值用默认值，免得干扰别的断言（需要别的值时用例自己覆盖） */
beforeEach(() => {
  server.use(
    http.get('/api/settings', () =>
      HttpResponse.json({
        settings: {
          includeOwn: false,
          gitTimeoutMs: 120_000,
          concurrency: 4,
          confirmThreshold: 20,
          scanDirs: [],
        },
      }),
    ),
  )
})

function renderPanel(targets: CheckTarget[] = TARGETS) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  return render(
    <QueryClientProvider client={client}>
      {/* 面板里有指向项目详情的 Link，需要路由上下文 */}
      <MemoryRouter>
        <UpdatePanel targets={targets} onClose={() => {}} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const lastCheckTask = {
  id: 'task-check',
  kind: 'check' as const,
  status: 'running' as const,
  total: 3,
  done: 0,
  items: [
    { projectId: 1, name: 'behind-one', state: 'pending' as const },
    { projectId: 2, name: 'up-to-date', state: 'pending' as const },
    { projectId: 3, name: 'diverged', state: 'pending' as const },
  ],
}

const applyTask = {
  id: 'task-apply',
  kind: 'apply' as const,
  status: 'running' as const,
  total: 1,
  done: 0,
  items: [{ projectId: 1, name: 'behind-one', state: 'pending' as const }],
}

function report(status: string, behind: number, subject = '远程提交', verdict?: string) {
  // 真实报告**总是带判决**（`UpdateReport.recommendation`，core 里写着它是
  // 「这个软件一阶段最要紧的一条输出」）。这里按 status 给一个默认判决，
  // 需要「作者改写了历史」这类情形时用第 4 个参数覆盖。
  const v = verdict ?? (status === 'behind' ? 'safe' : status === 'diverged' ? 'diverged' : 'safe')
  return {
    status,
    ahead: 0,
    behind,
    incoming:
      behind > 0
        ? [{ shortHash: 'abc1234', subject, author: 't', date: '' }]
        : [],
    outgoing: [],
    tags: [],
    recommendation: {
      verdict: v,
      ahead: 0,
      behind,
      canPull: v === 'safe' && status === 'behind',
      reason:
        v === 'rewritten'
          ? '上游历史被改写过（上次见过的那个提交已经不在远程分支上了，作者可能 force push 或回退了）。'
          : `可以直接快进到远程的 ${behind} 个提交。`,
    },
    upstreamSha: null,
    error: null,
  }
}

function useButton(name: RegExp | string) {
  return screen.getByRole('button', { name })
}

async function click(name: RegExp | string) {
  const el = useButton(name) as HTMLButtonElement
  expect(el.disabled, `按钮「${name}」应该是可点的`).toBe(false)
  fireEvent.click(el)
}

/** 等假 EventSource 建好（React Query 建连接是异步的） */
async function waitForStream() {
  await waitFor(() => expect(FakeEventSource.instances.length).toBeGreaterThan(0))
  return FakeEventSource.instances[FakeEventSource.instances.length - 1]!
}

describe('勾选更新流程', () => {
  it('报告是一个弹窗，不再是插进页面流里的一块区域', () => {
    renderPanel()

    // 插进页面流那种做法是 `<section class="border">`，屏幕上会和清单表凑成两张「表」；
    // 现在是 role=dialog 的宽版弹窗（标题即 aria-label）
    expect(screen.getByRole('dialog', { name: '联网检查更新' })).toBeTruthy()
  })

  it('检查 → 看报告 → 只勾能快进的 → 更新 → 汇总', async () => {
    const applied: number[][] = []

    server.use(
      http.post('/api/updates/check', () => HttpResponse.json(lastCheckTask, { status: 202 })),
      http.post('/api/updates/apply', async ({ request }) => {
        applied.push(((await request.json()) as { ids: number[] }).ids)
        return HttpResponse.json(applyTask, { status: 202 })
      }),
    )

    renderPanel()

    // 1. 点「开始检查」→ 拿到 task → 订阅进度
    await click(/开始检查/)
    const checkStream = await waitForStream()
    expect(checkStream.url).toContain('/api/updates/task-check/events')

    // 2. 逐个仓库的报告推过来
    checkStream.emit({
      type: 'item',
      done: 1,
      item: { projectId: 1, name: 'behind-one', state: 'done', result: report('behind', 2) },
    })
    checkStream.emit({
      type: 'item',
      done: 2,
      item: { projectId: 2, name: 'up-to-date', state: 'done', result: report('up_to_date', 0) },
    })
    checkStream.emit({
      type: 'item',
      done: 3,
      item: {
        projectId: 3,
        name: 'diverged',
        state: 'done',
        result: report('diverged', 1, '分叉那边的提交'),
      },
    })

    // 报告里的关键信息真的渲染出来了
    await waitFor(() => expect(screen.getByText('落后远程')).toBeTruthy())
    expect(screen.getByText('已是最新')).toBeTruthy()
    expect(screen.getByText('已分叉')).toBeTruthy()
    expect(screen.getByText('远程提交')).toBeTruthy() // 待拉取的提交标题
    expect(screen.getByText('分叉那边的提交')).toBeTruthy()

    // 检查任务收尾，底部才出现「更新选中的」按钮
    checkStream.emit({
      type: 'finished',
      total: 3,
      summary: { behind: 1, upToDate: 1, ahead: 0, diverged: 1, skipped: 0, failed: 0 },
    })
    checkStream.emit({ type: 'closed' })
    await waitFor(() => expect(screen.getByText(/检查完：/)).toBeTruthy())

    // 分叉的仓库不能勾（勾了也没用），behind 的可以
    const divergedBox = screen.getByLabelText('选择 diverged') as HTMLInputElement
    const behindBox = screen.getByLabelText('选择 behind-one') as HTMLInputElement
    expect(divergedBox.disabled).toBe(true)
    expect(behindBox.disabled).toBe(false)

    // 3. 勾上，底部按钮的计数跟着变
    const applyBtn = useButton(/更新选中的/) as HTMLButtonElement
    expect(applyBtn.disabled).toBe(true) // 还没勾
    fireEvent.click(behindBox)
    await waitFor(() =>
      expect((useButton(/更新选中的/) as HTMLButtonElement).textContent).toContain('1'),
    )    // 4. 更新
    await click(/更新选中的/)
    const applyStream = await waitForStream()
    expect(applyStream.url).toContain('/api/updates/task-apply/events')
    expect(applied).toEqual([[1]]) // 只有勾的那个，不是全部

    // 5. 结果汇总
    applyStream.emit({
      type: 'item',
      done: 1,
      item: {
        projectId: 1,
        name: 'behind-one',
        state: 'done',
        result: {
          outcome: 'updated',
          newCommits: 2,
          status: 'up_to_date',
          reason: null,
          error: null,
          summary: '已更新 2 个提交',
        },
      },
    })
    applyStream.emit({
      type: 'finished',
      total: 1,
      summary: { updated: 1, upToDate: 0, skipped: 0, failed: 0, commits: 2 },
    })
    applyStream.emit({ type: 'closed' })

    await waitFor(() =>
      expect(screen.getByText(/已更新 1 个仓库，共 2 个提交/)).toBeTruthy(),
    )
  })

  it('开跑前就列出将要检查的项目；你自己写的那些不在列表里，只在上面交代一句', async () => {
    renderPanel([
      { id: 1, name: 'behind-one', isOwn: false },
      { id: 9, name: 'visperse', isOwn: true },
    ])

    // 会检查的那个在列表里，状态是「待检查」
    await waitFor(() => expect(screen.getByText('behind-one')).toBeTruthy())
    expect(screen.getByText('待检查')).toBeTruthy()

    // 你自己写的那个**不在列表里**（列表里的名字各占一个元素；上面那句话是一整段）
    expect(screen.queryByText('visperse')).toBeNull()
    expect(screen.getByText(/visperse 是你自己写的项目，跳过不查/)).toBeTruthy()
  })

  it('单独重试某一行：只重查那一个，别的行留着上一次的结论', async () => {
    const requested: (number[] | undefined)[] = []
    /*
      重试那一次的任务**只带一个项目**——真实服务端就是这样：items 由它收到的
      ids 生成。第一版夹具图省事复用了三条的 lastCheckTask，于是三行都被刷成
      pending，「别的行留着结论」当场就不成立了（测试把我拦下来了）。
    */
    const retryTask = {
      id: 'task-retry',
      kind: 'check' as const,
      status: 'running' as const,
      total: 1,
      done: 0,
      items: [{ projectId: 1, name: 'behind-one', state: 'pending' as const }],
    }

    server.use(
      http.post('/api/updates/check', async ({ request }) => {
        const body = (await request.json()) as { ids?: number[] }
        requested.push(body.ids)
        return HttpResponse.json(requested.length === 1 ? lastCheckTask : retryTask, {
          status: 202,
        })
      }),
    )

    renderPanel()

    // 第一轮：整批。1 号连不上远程，2、3 号有结论
    await click(/开始检查/)
    const first = await waitForStream()
    /*
      **这是真实形状**：网络失败不会让任务项失败——`analyze` 把 git 的报错收成一个
      带 `error` 的报告（状态 `error`），服务端照样 `markDone`。
      第一版测试图省事用了 `state: 'failed'`（那只在 analyze 抛异常时出现），
      于是测试绿着、真机上一个「重试」都不显示。
    */
    first.emit({
      type: 'item',
      done: 1,
      item: {
        projectId: 1,
        name: 'behind-one',
        state: 'done',
        result: {
          ...report('error', 0),
          error: { kind: 'network', message: '连不上远程。检查网络、代理或 DNS' },
        },
      },
    })
    first.emit({
      type: 'item',
      done: 2,
      item: { projectId: 2, name: 'up-to-date', state: 'done', result: report('up_to_date', 0) },
    })
    first.emit({
      type: 'item',
      done: 3,
      item: {
        projectId: 3,
        name: 'diverged',
        state: 'done',
        result: report('diverged', 1, '分叉那边的提交'),
      },
    })
    first.emit({ type: 'closed' })

    await waitFor(() =>
      expect(screen.getByText('连不上远程。检查网络、代理或 DNS')).toBeTruthy(),
    )
    // 只有失败的那一行有「重试」
    expect(screen.getAllByRole('button', { name: '重试' })).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: '重试' }))

    // **只发了这一个 id**——不是把整批再来一遍
    await waitFor(() => expect(requested).toHaveLength(2))
    expect(requested[1], '重试只该重查失败的那一个').toEqual([1])

    const second = await waitForStream()
    second.emit({
      type: 'item',
      done: 1,
      item: { projectId: 1, name: 'behind-one', state: 'done', result: report('behind', 2) },
    })
    second.emit({ type: 'closed' })

    // 这一行换成了新结论；另外两行的旧结论**没有被抹掉**
    await waitFor(() => expect(screen.getByText('落后远程')).toBeTruthy())
    expect(screen.queryByText('连不上远程。检查网络、代理或 DNS')).toBeNull()
    expect(screen.getByText('已是最新')).toBeTruthy()
    expect(screen.getByText('已分叉')).toBeTruthy()
    // 整张表都跑过了，没有谁退回「待检查」
    expect(screen.queryByText('待检查')).toBeNull()
  })

  it('超过确认阈值时先问一遍，不直接开跑', async () => {
    let checks = 0
    let settingsCalls = 0
    server.use(
      http.get('/api/settings', () => {
        settingsCalls += 1
        return HttpResponse.json({
          settings: {
            includeOwn: false,
            gitTimeoutMs: 120_000,
            concurrency: 4,
            confirmThreshold: 2, // 故意调小
            scanDirs: [],
          },
        })
      }),
      http.post('/api/updates/check', () => {
        checks += 1
        return HttpResponse.json(lastCheckTask, { status: 202 })
      }),
    )

    renderPanel()
    // 等设置真的到了再点：阈值是从设置里读的
    await waitFor(() => expect(settingsCalls).toBe(1))
    // 开跑之前就把「将要检查谁」列出来（这一句原来是一段「将检查当前筛选出的 3 个项目」的说明）
    await waitFor(() => expect(screen.getByText('behind-one')).toBeTruthy())
    expect(screen.getAllByText('待检查')).toHaveLength(3)

    // 第一次点：只弹确认，还没发请求
    await click(/开始检查/)
    await waitFor(() => expect(screen.getByText(/要对 3 个项目联网 fetch/)).toBeTruthy())
    expect(checks).toBe(0)

    // 「再想想」可以撤销
    await click(/再想想/)
    await waitFor(() => expect(screen.queryByText(/要对 3 个项目联网 fetch/)).toBeNull())

    // 再点一次仍然是确认，确认之后才真的发
    await click(/开始检查/)
    await click(/确认，检查这 3 个/)
    await waitFor(() => expect(checks).toBe(1))
  })

  it('启动失败时把后端的原话显示出来', async () => {
    server.use(
      http.post('/api/updates/check', () =>
        HttpResponse.json(
          { code: 'bad_request', message: '选中的项目都是你自己写的，没法自动检查（3 个）' },
          { status: 400 },
        ),
      ),
    )

    renderPanel()
    await click(/开始检查/)

    await waitFor(() =>
      expect(screen.getByText(/都是你自己写的/)).toBeTruthy(),
    )
  })
})

/**
 * 用户问的：「弹窗里面，看起来没有『推荐』？不怕更新到错误的东西吗」。
 *
 * 他问对了：`UpdateReport` 一直带着 `recommendation`，而报告行既不渲染它、
 * 勾选判据也只看 `status === 'behind'`。**而「作者 force push 改写了历史」
 * 恰恰表现为 `behind`**（本地 refs 只看到「落后 N 个」），判决却是 `rewritten`
 * ——那就正是这个软件要防的「更新到作者重置/删掉的东西」。
 */
describe('判决必须在弹窗里看得见，而且决定能不能勾', () => {
  function emitRewriteCase(stream: FakeEventSource) {
    stream.emit({
      type: 'item',
      done: 1,
      item: {
        projectId: 1,
        name: 'force-pushed',
        state: 'done',
        // status 是 behind，但判决是 rewritten
        result: report('behind', 2, '被改写掉的那些提交', 'rewritten'),
      },
    })
    stream.emit({
      type: 'item',
      done: 2,
      item: { projectId: 2, name: 'behind-ok', state: 'done', result: report('behind', 1) },
    })
  }

  it('改写过历史的仓库：显示判决与理由，而且不能勾', async () => {
    server.use(
      http.post('/api/updates/check', () => HttpResponse.json(lastCheckTask, { status: 202 })),
    )
    renderPanel(TARGETS.slice(0, 2))

    await click(/开始检查/)
    const stream = await waitForStream()
    emitRewriteCase(stream)
    stream.emit({
      type: 'finished',
      total: 2,
      summary: { behind: 2, upToDate: 0, ahead: 0, diverged: 0, skipped: 0, failed: 0 },
    })
    stream.emit({ type: 'closed' })

    // 判决短标签出现在这一行里（清单页那一格叫「推荐」）
    await waitFor(() => expect(screen.getByText('别拉')).toBeTruthy())
    // 理由要写全，不能只靠 tooltip —— 这是「别拉」的场合
    expect(screen.getByText(/上游历史被改写过/)).toBeTruthy()

    // 关键：status 是 behind，但判决说别拉 ⇒ 勾不了
    expect((screen.getByLabelText('选择 force-pushed') as HTMLInputElement).disabled).toBe(true)
    // 同一批里真的能快进的那个照常可勾
    expect((screen.getByLabelText('选择 behind-ok') as HTMLInputElement).disabled).toBe(false)

    // 「全选可更新的」也只该数到 1 个
    expect(useButton(/全选可更新的 1 个/)).toBeTruthy()

    // 汇总那句话不能再说「2 个可更新」——它必须按**判决**分，
    // 否则和上面被禁用的勾选框自相矛盾
    await waitFor(() => expect(screen.getByText(/检查完：/)).toBeTruthy())
    const line = screen.getByText(/检查完：/)
    expect(line.textContent).toContain('1 个可安全快进')
    expect(line.textContent).toContain('1 个别拉')
    expect(line.textContent).not.toContain('2 个可更新')

    // 还有一句单独的警告，点名是哪个仓库（埋在 20 行里就没人看见了）
    const warning = screen.getByText(/判定为「别拉」，不能勾选/)
    expect(warning.textContent).toContain('force-pushed')
  })
})
