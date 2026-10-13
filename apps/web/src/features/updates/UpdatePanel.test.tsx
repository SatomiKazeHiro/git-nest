import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { delay, http, HttpResponse } from 'msw'
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

/**
 * 某一行当前的全部文字。
 *
 * 状态词不能直接 `getByText('检查中…')`：底部那个按钮上可能是同一个词，
 * 「行里说了什么」和「按钮上说了什么」是两件事，得分开断言。
 */
function rowText(name: string): string {
  return screen.getByText(name).closest('li')?.textContent ?? ''
}

/** 一行里那句状态词所在的那个 `<span>`（名字右边那一格），用来比对两种状态的视觉 */
function stateSpan(name: string, text: string): HTMLElement {
  const row = screen.getByText(name).closest('li')
  const found = [...(row?.querySelectorAll('span') ?? [])].find((s) => s.textContent === text)
  expect(found, `「${name}」那一行里应该有一句「${text}」`).toBeTruthy()
  return found as HTMLElement
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

/**
 * 用户报的两件事，都在同一行字上：
 *
 * ① 「更新的时候，每一行还在说检查中」——那句词原来**写死**成「检查中…」，
 *    可用户点的是「更新选中的 N 个」，做的事是 ff-only 更新。
 *    这一轮到底是检查还是更新，服务端任务快照里本来就分得清（`kind`），
 *    所以断言的是「词跟着 `kind` 走」，而不是「多了一个本地开关」。
 * ② 「排队的时候整行是空的，看着像卡死」——检查受并发限流会排队，
 *    更新更是严格串行，`pending` 原来什么都不画。
 */
describe('每一行那句状态词要说实话', () => {
  /** 一路走到「可以点更新」：检查跑完、报告落在行里、勾上能快进的那一个 */
  async function readyToApply() {
    server.use(
      http.post('/api/updates/check', () => HttpResponse.json(lastCheckTask, { status: 202 })),
      http.post('/api/updates/apply', () => HttpResponse.json(applyTask, { status: 202 })),
    )
    renderPanel(TARGETS.slice(0, 2))

    await click(/开始检查/)
    const checkStream = await waitForStream()
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
      type: 'finished',
      total: 2,
      summary: { behind: 1, upToDate: 1, ahead: 0, diverged: 0, skipped: 0, failed: 0 },
    })
    checkStream.emit({ type: 'closed' })
    await waitFor(() => expect(screen.getByText(/检查完：/)).toBeTruthy())

    fireEvent.click(screen.getByLabelText('选择 behind-one'))
    await waitFor(() =>
      expect((useButton(/更新选中的/) as HTMLButtonElement).disabled).toBe(false),
    )
  }

  it('更新跑起来时，行里说「更新中…」，不是「检查中…」', async () => {
    await readyToApply()

    await click(/更新选中的/)
    const applyStream = await waitForStream()
    expect(applyStream.url).toContain('/api/updates/task-apply/events')

    // 服务端把这个项目标成 running（`/updates/apply` 的快照 kind 就是 apply）
    applyStream.emit({ type: 'item', item: { projectId: 1, name: 'behind-one', state: 'running' } })

    await waitFor(() => expect(rowText('behind-one')).toContain('更新中…'))
    expect(rowText('behind-one')).not.toContain('检查中…')
    // 底部那个主动作按钮此刻也是禁用的，同样不能说自己在检查
    expect(screen.getAllByRole('button', { name: /更新中…/ })).toHaveLength(1)
    expect(screen.queryByRole('button', { name: /检查中…/ })).toBeNull()
  })

  it('检查跑起来时，行里仍然是「检查中…」', async () => {
    server.use(
      http.post('/api/updates/check', () => HttpResponse.json(lastCheckTask, { status: 202 })),
    )
    renderPanel(TARGETS.slice(0, 2))

    await click(/开始检查/)
    const stream = await waitForStream()
    stream.emit({ type: 'item', item: { projectId: 1, name: 'behind-one', state: 'running' } })

    await waitFor(() => expect(rowText('behind-one')).toContain('检查中…'))
    expect(rowText('behind-one')).not.toContain('更新中…')
  })

  it('还没轮到的行说「排队中」，不是一片空白', async () => {
    server.use(
      http.post('/api/updates/check', () => HttpResponse.json(lastCheckTask, { status: 202 })),
    )
    renderPanel(TARGETS.slice(0, 2))

    await click(/开始检查/)
    const stream = await waitForStream()

    // 任务快照一到，三行都从「待检查」变成任务项：还没轮到的那行原来什么都不画
    await waitFor(() => expect(rowText('behind-one')).toContain('排队中'))
    expect(rowText('up-to-date')).toContain('排队中')

    // 视觉沿用 running 那一档（次级灰 + 等宽），两个词来回换时行不会跳
    stream.emit({ type: 'item', item: { projectId: 1, name: 'behind-one', state: 'running' } })
    await waitFor(() => expect(rowText('behind-one')).toContain('检查中…'))
    expect(stateSpan('up-to-date', '排队中').className).toBe(
      stateSpan('behind-one', '检查中…').className,
    )
  })
})

/**
 * 更新进行中，「更新选中的」按钮留在原地并报进度。
 *
 * 用户报的：「更新跑起来，那个『更新选中的 N 个』按钮就不见了」。
 *
 * 原来底部的判据是 `finished?.kind === 'check'`——更新一开跑 `task` 换成了 apply 快照，
 * `finished` 落空，整个动作带子掉回**另一个**禁用的检查按钮，于是「正在更新几个 /
 * 已经几个」整段时间看不到。现在按钮留在原地、禁用、并把进度写进文案。
 *
 * 进度数字不另记一份：它的来源就是面板本来那份**按项目 id 累积的任务行**
 * （`rows`，见 `applyProgress`）——更新的结果是 `PullResult`，一行有它就说明这行的
 * 更新落地了；分母是这一轮开跑时勾下的那几个。
 */
describe('更新进行中，「更新选中的」按钮留在原地并报进度', () => {
  /** 三个项目：1、2 能快进，3 已是最新（凑出一批 2 个，才看得出「1/2」这种中间态） */
  const THREE: CheckTarget[] = [
    { id: 1, name: 'behind-one', isOwn: false },
    { id: 2, name: 'behind-two', isOwn: false },
    { id: 3, name: 'up-to-date', isOwn: false },
  ]

  /**
   * 底部主按钮现在的样子，拼成一句话。
   *
   * 专门为了「断言失败时能一眼看出点到了什么」：这个按钮的文案本身是状态机的输出
   * （`更新选中的 N 个` / `更新中…启动中` / `更新中…（N/M）`），把它连 disabled
   * 一起塞进断言的说明里，就不用再靠 `expected [] to have a length of 1` 猜。
   */
  const footerState = () =>
    [...document.querySelectorAll('button')]
      .filter((b) => /更新/.test(b.textContent ?? ''))
      .map((b) => `「${b.textContent}」${(b as HTMLButtonElement).disabled ? '（禁用）' : '（可点）'}`)
      .join(' + ') || '（底部没有任何更新按钮）'

  /**
   * 底部主按钮（就是「更新选中的」那枚）。
   *
   * 判据必须**只说这枚按钮**：底部还有一个「全选可更新的 N 个」，它也含「更新」二字，
   * 用 `/更新/` 去查会同时命中两个——`getByRole` 要么抛「找到多个」，要么取到那个
   * 触发「全选」的节点，点下去当然不会发 apply 请求。用 `/^更新选中的/` 锚住开头。
   */
  const applyButtonNow = () => {
    /*
      **按可见文案选，不按可访问名字。** 上面那条定位哨兵断言的也是 `textContent`，
      两处必须是同一个判据——否则会出现「哨兵说它在、紧接着取它却取不到」这种自相矛盾
      （这条用例前几轮就栽在这上面：`/更新/` 能命中、`/^更新选中的/` 却一个都命中不到）。
      选中不了时把自己看到的东西说出来，而不是抛一句 "Unable to find"。
    */
    const found = screen
      .getAllByRole('button')
      .find((b) => /^更新选中的/.test(b.textContent ?? ''))
    if (!found) {
      throw new Error(`底部找不到「更新选中的」那枚按钮（此刻底部：${footerState()}）`)
    }
    return found as HTMLButtonElement
  }

  /** 底部所有「更新中…」那一档的按钮（正常的更新中只有一个，多了就是回归） */
  const applyButtonsNow = () => screen.queryAllByRole('button', { name: /^更新中/ })

  /**
   * 检查跑完、报告落在行里、勾上能快进的那两个——走到「可以点更新」。
   *
   * `applyRequests` 传进来就把每次 apply 的 ids 记下来：用例靠它证明
   * 「这一次点击真的打到了服务端」，而不是点了个禁用按钮、页面什么都没发生。
   *
   * `applyDelayMs` 给 apply 的 202 加一段延迟，把「点下去 → 快照回来」那个窗口
   * **撑开成确定的**：不然窗口可能只有一两个 microtask 宽，观察它的断言必然时红时绿
   * （这条用例前几轮就是栽在这儿）。生产里这个窗口是真实存在的（一次网络往返）。
   *
   * 注意 handler 里**先把 ids 记下来、再 await 延迟**：这样「请求真的发出去了」在
   * 窗口一打开就成立，能在窗口内断言，而不是等响应回来才知道。
   */
  async function checkedTwoPullable(applyRequests?: number[][], applyDelayMs = 0) {
    server.use(
      http.post('/api/updates/check', () =>
        HttpResponse.json({ ...lastCheckTask, total: 3 }, { status: 202 }),
      ),
      http.post('/api/updates/apply', async ({ request }) => {
        applyRequests?.push(((await request.json()) as { ids: number[] }).ids)
        if (applyDelayMs > 0) await delay(applyDelayMs)
        return HttpResponse.json(
          {
            id: 'task-apply',
            kind: 'apply' as const,
            status: 'running' as const,
            total: 2,
            done: 0,
            items: [
              { projectId: 1, name: 'behind-one', state: 'pending' as const },
              { projectId: 2, name: 'behind-two', state: 'pending' as const },
            ],
          },
          { status: 202 },
        )
      }),
    )
    renderPanel(THREE)

    await click(/开始检查/)
    const checkStream = await waitForStream()
    checkStream.emit({
      type: 'item',
      done: 1,
      item: { projectId: 1, name: 'behind-one', state: 'done', result: report('behind', 2) },
    })
    checkStream.emit({
      type: 'item',
      done: 2,
      item: { projectId: 2, name: 'behind-two', state: 'done', result: report('behind', 1) },
    })
    checkStream.emit({
      type: 'item',
      done: 3,
      item: { projectId: 3, name: 'up-to-date', state: 'done', result: report('up_to_date', 0) },
    })
    checkStream.emit({
      type: 'finished',
      total: 3,
      summary: { behind: 2, upToDate: 1, ahead: 0, diverged: 0, skipped: 0, failed: 0 },
    })
    checkStream.emit({ type: 'closed' })
    await waitFor(() => expect(screen.getByText(/检查完：/)).toBeTruthy())

    fireEvent.click(screen.getByLabelText('选择 behind-one'))
    fireEvent.click(screen.getByLabelText('选择 behind-two'))
    await waitFor(() =>
      expect((useButton(/更新选中的/) as HTMLButtonElement).disabled).toBe(false),
    )
  }

  /** 一行更新的结果（形状取自 `PullResult`；`incoming` 那种是检查报告，不是这个） */
  function applied(projectId: number, name: string) {
    return {
      type: 'item',
      item: {
        projectId,
        name,
        state: 'done' as const,
        result: {
          outcome: 'updated',
          newCommits: 1,
          status: 'up_to_date',
          reason: null,
          error: null,
          summary: '已更新 1 个提交',
        },
      },
    }
  }

  it('按钮还在（不是换成那个禁用的检查按钮）、是禁用的、文案里带「已完成/这一轮总数」', async () => {
    const applyRequests: number[][] = []
    /*
      apply 的 202 故意晚 60ms 回来：这样「点下去 → 快照回来」那段窗口**看得见**
      （生产里它是一次真实网络往返）。60ms 够跑完下面那几步同步断言，又不会让用例变慢。
      ids 在 handler 入口就记下了，所以「请求发出去了」不用等这段延迟。
    */
    await checkedTwoPullable(applyRequests, 60)

    /*
      ① 先证明「点得到」：主按钮在文档里、可点，而且底部含「更新」的按钮就是它们几个。
      连着两轮都栽在「请求没发出去」上，所以**取节点、断言、点击挨着写**，
      中间不夹任何 `await`——`await` 会放行重渲染，那个节点可能已经不是文档里那个了，
      而 `fireEvent.click(脱离文档的节点)` 不会冒泡到 React 根，handler 根本不执行
      （脱开的节点上读 `disabled` 还照样是 false，所以「可点断言过了却什么都没发生」）。

      中间那句 `queryAllByRole(/更新/)` 是**定位歧义的哨兵**：底部还有一个
      「全选可更新的 N 个」也含「更新」二字。取节点用的 `/^更新选中的/` 已经锚住开头
      不会取错，但若哪天又冒出一个候选，这句话会把它指名道姓地打出来。
    */
    const candidates = screen.queryAllByRole('button', { name: /更新/ })
    expect(
      candidates.map((b) => b.textContent),
      `勾满之后底部含「更新」的按钮只该剩这一枚（此刻底部：${footerState()}）`,
    ).toEqual(['更新选中的 2 个'])

    const btn = applyButtonNow()
    expect(
      btn.isConnected,
      `点击前这枚按钮必须还在文档里（此刻底部：${footerState()}）`,
    ).toBe(true)
    expect(btn.disabled, `点击前这枚按钮必须真的可点（此刻底部：${footerState()}）`).toBe(false)
    expect(applyRequests, '点击前不该已经发过 apply 请求').toHaveLength(0)

    fireEvent.click(btn)

    // ② 点击真的打到了服务端：apply 请求发出去了一条，带的就是勾的那两个
    await waitFor(
      () =>
        expect(applyRequests, `apply 请求没发出去（此刻底部：${footerState()}）`).toHaveLength(1),
      { timeout: 2000 },
    )
    expect(applyRequests[0]).toEqual([1, 2])

    /*
      ③ 快照还没回来这一小段：按钮**留在原地**、禁用、并说「更新中…启动中」。
      这一档以前不存在——判据只看 `finished` 与 `runKind`，而这两者在快照回来之前
      都还指着上一轮那张检查快照，于是底部当场掉回那个禁用的检查按钮，等快照到了再跳回来。
    */
    const applyingMaybe = applyButtonsNow()
    expect(
      applyingMaybe.length,
      `快照回来之前，底部应恰好有一枚更新中按钮（此刻底部：${footerState()}）`,
    ).toBe(1)
    const applyingNow = applyingMaybe[0] as HTMLButtonElement
    expect(applyingNow.textContent, `此刻底部：${footerState()}`).toBe('更新中…启动中')
    expect(applyingNow.disabled).toBe(true)
    expect(screen.queryByRole('button', { name: /检查中…/ })).toBeNull() // ← 原来就是它顶掉了这枚按钮

    const applyStream = await waitForStream()
    expect(applyStream.url).toContain('/api/updates/task-apply/events')

    // ④ 进度：这一轮勾了 2 个，此刻一个都还没跑完
    await waitFor(() =>
      expect((useButton(/更新中…/) as HTMLButtonElement).textContent).toBe('更新中…（0/2）'),
    )

    // 行里的状态攒上来了，分子跟着走——数字是从那份累积行里数的，不是另记的
    applyStream.emit(applied(1, 'behind-one'))
    await waitFor(() =>
      expect((useButton(/更新中…/) as HTMLButtonElement).textContent).toBe('更新中…（1/2）'),
    )

    applyStream.emit(applied(2, 'behind-two'))
    await waitFor(() =>
      expect((useButton(/更新中…/) as HTMLButtonElement).textContent).toBe('更新中…（2/2）'),
    )

    /*
      ④ 更新收尾：文案回到它正常的样子（勾选还在，所以计数仍是勾的那 2 个），
      不再是进度文案——进度只属于进行中那一刻。
    */
    applyStream.emit({
      type: 'finished',
      total: 2,
      summary: { updated: 2, upToDate: 0, skipped: 0, failed: 0, commits: 3 },
    })
    applyStream.emit({ type: 'closed' })

    /*
      收尾之后：**进度文案必须消失**（否则用户会以为还在跑）。
      注意「更新按钮」本身会离开底部 —— 那是**改动前就有的行为**（底部按"最近一次跑完的是哪一档"
      决定显示哪一组：apply 跑完后 `finished.kind === 'apply'`，于是回到检查那一档的「重新检查」）。
      这次没动它；要改成"跑完也留在原地（禁用或恢复可点）"是另一件事，留给用户定。
    */
    await waitFor(() => expect(screen.queryByRole('button', { name: /更新中…/ })).toBeNull())
    // 左侧那句汇总仍由既有的 applySummary 给
    expect(screen.getByText(/已更新 2 个仓库，共 3 个提交/)).toBeTruthy()
    // 底部回到检查那一档
    expect(screen.getByRole('button', { name: /重新检查/ })).toBeTruthy()
  })

  it('更新这一轮起跑失败时那枚按钮要放得开，不能把底部永久锁在更新档', async () => {
    const applyRequests: number[][] = []
    await checkedTwoPullable(applyRequests, 60)
    server.use(
      http.post('/api/updates/apply', async ({ request }) => {
        /*
          覆盖 handler 时**也必须把 ids 记下来**：这条用例靠 `applyRequests` 证明
          "这一次点击真的打到了服务端"。上一版覆盖时忘了记，于是那条断言永远不可能通过
          ✗（自己把自己的前提掐了）。
        */
        applyRequests.push(((await request.json()) as { ids: number[] }).ids)
        // 同样把窗口撑开一点，让「启动中」那一档看得见
        await delay(60)
        return HttpResponse.json(
          { code: 'bad_request', message: '这批里没有可以更新的' },
          { status: 400 },
        )
      }),
    )

    // 取节点、断言、点击挨着写，中间不夹 await（见上一条用例的①）
    const btn = applyButtonNow()
    expect(
      btn.isConnected,
      `点击前这枚按钮必须还在文档里（此刻底部：${footerState()}）`,
    ).toBe(true)
    expect(btn.disabled, `点击前这枚按钮必须真的可点（此刻底部：${footerState()}）`).toBe(false)

    fireEvent.click(btn)

    // 请求真的发出去了（点了个空气的话这里就红，不会再「空绿」）
    await waitFor(
      () =>
        expect(applyRequests, `apply 请求没发出去（此刻底部：${footerState()}）`).toHaveLength(1),
      { timeout: 2000 },
    )

    /*
      鉴别力放在**只有真的开跑才会出现**的东西上：「更新中…」这一档。
      点了个空气 / 按钮没被点到的话，底部根本不会有这枚按钮（这一档不存在），
      而「更新中…启动中 / （0/2）」这一族也只有真的开了这一轮才会出现。
      精确到哪一个子状态交给上一条用例（那里把窗口定死），这里只钉「它在、且禁用」。
    */
    const applyingMaybe = applyButtonsNow()
    expect(
      applyingMaybe.length,
      `失败回来之前，底部应恰好有一枚更新中按钮（此刻底部：${footerState()}）`,
    ).toBe(1)
    const applyingNow = applyingMaybe[0] as HTMLButtonElement
    expect(applyingNow.textContent, `此刻底部：${footerState()}`).toMatch(/^更新中/)
    expect(applyingNow.disabled).toBe(true)

    // 随后失败要说出来，并且这一轮要放掉（否则按钮永远停在「启动中」）
    await screen.findByText(/这批里没有可以更新的/)
    await waitFor(() =>
      expect(applyButtonNow().disabled).toBe(false),
    )
  })

  it('检查那一档的底部行为不变：仍然只有一个禁用的「检查中…」', async () => {
    server.use(
      http.post('/api/updates/check', () => HttpResponse.json(lastCheckTask, { status: 202 })),
    )
    renderPanel(TARGETS.slice(0, 2))

    await click(/开始检查/)
    const stream = await waitForStream()
    stream.emit({ type: 'item', item: { projectId: 1, name: 'behind-one', state: 'running' } })

    await waitFor(() => expect(rowText('behind-one')).toContain('检查中…'))
    // 这一档不报进度，也不该冒出一枚「更新选中的」（那是检查读完才有的事）
    expect((useButton(/检查中…/) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.queryByRole('button', { name: /更新中…/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /更新选中的/ })).toBeNull()
  })
})
