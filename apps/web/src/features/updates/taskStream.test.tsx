import { describe, expect, it } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/mocks/server'
import { FakeEventSource } from '@/test/setup'
import { useUpdateTask } from './taskStream'

/**
 * 进度流断掉时的兜底。这是审计发现的一条**卡死**路径：
 *
 * 服务端只在收尾时发 `{"type":"closed"}`。如果服务端进程被杀 / 网络断掉，
 * 这个事件永远不会到，而复位 `busy` 的地方**只有**那一个分支 ——
 * 于是更新面板的「检查更新」按钮永久禁用、进度永远停在「N/M · 连接中」，
 * 用户唯一的出路是点 × 关掉面板，界面上没有任何提示告诉他这一点。
 *
 * 另一个同源问题：`closed` 事件里调的 `close()` 关的是 `sourceRef.current`，
 * 而事件来自**旧的** source —— 若此时已经开了新连接，就会把新连接关掉。
 */

const task = {
  id: 'task-hang',
  kind: 'check' as const,
  status: 'running' as const,
  total: 2,
  done: 0,
  items: [
    { projectId: 1, name: 'a', state: 'pending' as const },
    { projectId: 2, name: 'b', state: 'pending' as const },
  ],
}

describe('进度流断掉时的兜底', () => {
  /**
   * 依次让每条连接失败，直到实现放弃（不再重连）。
   *
   * 关键是每次都等**新实例**出现再打：真实 EventSource 出错后不会复用同一实例，
   * 而实现里「旧 source 的迟到回调不许影响新连接」的护栏（本身是对的）会把对
   * 已关闭实例的重复 onerror 丢弃。早期版本没等新实例，循环把重试次数烧在了
   * 同一个死实例上，测试自己超时——那是测试的错，不是实现的错。
   */
  async function failStreamsUntilGivenUp(
    isBusy: () => boolean,
    limit = 8,
  ): Promise<number> {
    for (let i = 0; i < limit; i++) {
      const source = FakeEventSource.instances[FakeEventSource.instances.length - 1]!
      const seen = FakeEventSource.instances.length
      act(() => {
        source.onerror?.()
      })
      await waitFor(
        () => expect(FakeEventSource.instances.length > seen || !isBusy()).toBe(true),
        { timeout: 3000 },
      )
      if (!isBusy()) break
    }
    return FakeEventSource.instances.length
  }

  it('服务端一直不发 closed 时，busy 必须复位（不能永久卡在「检查中」）', async () => {
    server.use(http.post('/api/updates/check', () => HttpResponse.json(task, { status: 202 })))

    const { result } = renderHook(() => useUpdateTask(undefined, { retryDelayMs: 20 }))

    act(() => {
      void result.current.startCheck([1, 2])
    })
    await waitFor(() => expect(result.current.busy).toBe(true))
    await waitFor(() => expect(FakeEventSource.instances.length).toBeGreaterThan(0))

    await failStreamsUntilGivenUp(() => result.current.busy)

    // 关键断言：不管流怎么断，最后必须把 busy 放掉，并且给出可见的错误
    await waitFor(() => expect(result.current.busy).toBe(false), { timeout: 5000 })
    expect(result.current.error).not.toBeNull()
  })

  it('重连不无上限：断太多次之后必须放弃并说清', async () => {
    server.use(http.post('/api/updates/check', () => HttpResponse.json(task, { status: 202 })))

    const { result } = renderHook(() => useUpdateTask(undefined, { retryDelayMs: 20 }))

    act(() => {
      void result.current.startCheck([1, 2])
    })
    await waitFor(() => expect(FakeEventSource.instances.length).toBeGreaterThan(0))

    const connections = await failStreamsUntilGivenUp(() => result.current.busy)

    await waitFor(() => expect(result.current.busy).toBe(false), { timeout: 5000 })
    expect(result.current.error).not.toBeNull()
    // 初始 1 条 + 最多 3 次重连，不能无限重开
    expect(connections).toBeLessThanOrEqual(5)
  })

  it('旧流的 closed 不能关掉新连接', async () => {
    const second = { ...task, id: 'task-second' }
    let call = 0
    server.use(
      http.post('/api/updates/check', () => {
        call += 1
        return HttpResponse.json(call === 1 ? task : second, { status: 202 })
      }),
    )

    const { result } = renderHook(() => useUpdateTask())

    act(() => {
      void result.current.startCheck([1, 2])
    })
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1))
    const first = FakeEventSource.instances[0]!

    // 开第二个任务：会先 close 掉旧流、再建新流
    act(() => {
      result.current.reset()
    })
    act(() => {
      void result.current.startCheck([1, 2])
    })
    await waitFor(() => expect(FakeEventSource.instances.length).toBeGreaterThan(1))

    const latest = FakeEventSource.instances[FakeEventSource.instances.length - 1]!

    // 旧流这时候才补发一个 closed（现实中会：缓冲事件晚到、或服务端刚收尾）
    act(() => {
      first.emit({ type: 'closed' })
    })

    // 新连接必须还活着
    expect(latest.closed).toBe(false)
    expect(result.current.busy).toBe(true)
  })

  /*
    心跳（服务端每 25s 一条 `{"type":"tick"}`）的唯一用途是让看门狗知道流还活着。

    它必须是**消息帧**：`EventSource` 不派发注释帧（`: ping`），所以心跳一旦退回
    注释帧，这些 tick 就收不到了——而一个仓库的 fetch 卡过 75 秒（默认 git 超时
    是 120s）时，流明明活着也会被判死，面板报「进度流断了，没能恢复」并把这条
    流扔掉。这条用例同时钉两件事：tick 不该动任何状态，但必须能续命。
  */
  it('心跳 tick 不动状态，但能让看门狗知道流还活着', async () => {
    server.use(http.post('/api/updates/check', () => HttpResponse.json(task, { status: 202 })))

    // 看门狗 250ms；下面 500ms 里每 25ms 一条心跳，累计远超阈值
    const { result } = renderHook(() =>
      useUpdateTask(undefined, { retryDelayMs: 20, silenceTimeoutMs: 250 }),
    )

    act(() => {
      void result.current.startCheck([1, 2])
    })
    await waitFor(() => expect(FakeEventSource.instances.length).toBe(1))
    const source = FakeEventSource.instances[0]!

    for (let i = 0; i < 20; i++) {
      source.emit({ type: 'tick' })
      await new Promise((r) => setTimeout(r, 25))
    }

    // 看门狗被心跳续上了：没有报错、还在跑、条目还是原样
    expect(result.current.error).toBeNull()
    expect(result.current.busy).toBe(true)
    expect(result.current.task?.status).toBe('running')
    expect(result.current.task?.items.map((i) => i.state)).toEqual(['pending', 'pending'])
  })

  /*
    「任务已经不在服务端了」（服务端重启 / 任务被清扫）走的也是这条流：

    服务端**故意不回 404**，而是按正常收尾推一条 `error` + `closed`。原因是
    `EventSource` 读不到状态码——404 在客户端眼里和断网一模一样，只会换来三次
    注定失败的重连，最后给用户一句「重连几次都没成功」，把责任推给网络。
  */
  it('任务没了时，把服务端说的原因原样留下来（不是写成断流）', async () => {
    server.use(http.post('/api/updates/check', () => HttpResponse.json(task, { status: 202 })))

    const { result } = renderHook(() => useUpdateTask(undefined, { retryDelayMs: 20 }))

    act(() => {
      void result.current.startCheck([1, 2])
    })
    await waitFor(() => expect(FakeEventSource.instances.length).toBe(1))
    const source = FakeEventSource.instances[0]!

    source.emit({ type: 'error', message: '这次检查的任务已经不在了（服务端重启过？）。点「重新检查」重跑一次。' })
    source.emit({ type: 'closed' })

    await waitFor(() => expect(result.current.busy).toBe(false))
    // 那句「断流」兜底的 error 不该出现，真正的原因是任务没了
    expect(result.current.error).toBeNull()
    expect(result.current.task?.status).toBe('failed')
    expect(result.current.task?.error).toContain('重新检查')
  })
})
