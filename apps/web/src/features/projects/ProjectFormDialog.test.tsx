import { describe, expect, it, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { builtinCategoryList } from '@git-nest/core'
import { server } from '@/test/mocks/server'
import { ProjectFormDialog } from './ProjectFormDialog'
import { UNCATEGORIZED, useUiStore } from '@/store/ui'

/**
 * 标签输入框。
 *
 * 两件事在这里钉住：
 * 1. **规则和服务端同一份**（core 的 `tagNameSchema`）。标签有三个写入口，
 *    名字的最长 40 字只在 `POST /api/tags` 上校验过——从项目的标签这条路能塞进
 *    任意长的名字。现在输入框自己就说清楚，而不是敲完一段、保存时吃一个 422。
 * 2. **`Field` 生成的 id 要真的落到输入框上**：`标签` 这个 `<label htmlFor>` 原来
 *    指向一个不存在的 id（TagPicker 忽略了它），点 label 没反应，读屏也关联不上。
 */

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 60_000, gcTime: 0 } },
  })
}

beforeEach(() => {
  useUiStore.setState({ formOpen: false, editingId: null })
  server.use(http.get('/api/tags', () => HttpResponse.json({ tags: [] })))
})

function renderDialog() {
  const view = render(
    <QueryClientProvider client={makeClient()}>
      <ProjectFormDialog />
    </QueryClientProvider>,
  )
  /*
    按应用里真实的接法**先挂上、再打开**（`ProjectFormDialog` 一直挂在窗口外壳上，
    `formOpen` 才决定它在不在）。这样弹窗打开时详情已经取回来了，表单从第一帧起
    就有值——挂在「打开着、但数据还没到」的中间态上时，受控控件会先无值再有值，
    React 会报一句 controlled → uncontrolled，把真问题盖掉。

    这一次 setState 触发的是**这个组件树之外**的渲染，所以要用 `act` 包住让它当场
    落定。不包的话它是「稍后」发生的：同步的 `getByRole` 会在一个还空着的身体上找
    东西，而浮层里那批选项取的是**打开那一刻**的名单，早一拍就等于拿到兜底那份。
  */
  act(() => {
    useUiStore.setState({ formOpen: true })
  })
  return view
}

describe('标签输入框', () => {
  it('「标签」这个 label 关联到输入框（不是指向一个不存在的 id）', async () => {
    renderDialog()
    const input = (await screen.findByLabelText('标签')) as HTMLInputElement
    expect(input.tagName).toBe('INPUT')
    expect(input.getAttribute('id')).toBeTruthy()
  })

  it('超过 40 字：当场说清楚，并且**不**悄悄吞掉草稿', async () => {
    renderDialog()
    const input = (await screen.findByLabelText('标签')) as HTMLInputElement

    fireEvent.change(input, { target: { value: 'x'.repeat(41) } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => expect(screen.getByText('标签名过长')).toBeTruthy())
    // 草稿留着 —— 清掉等于让他重打一遍，还会以为「加上了」
    expect(input.value).toBe('x'.repeat(41))
    // 也没真的加成标签（加成标签会渲染出一个可点的 chip）
    expect(screen.queryByTitle('点击移除')).toBeNull()
  })

  it('正常名字：回车加成标签，并清掉草稿与错误', async () => {
    renderDialog()
    const input = (await screen.findByLabelText('标签')) as HTMLInputElement

    fireEvent.change(input, { target: { value: '值得回头看' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => expect(screen.getByTitle('点击移除').textContent).toContain('值得回头看'))
    expect(input.value).toBe('')
  })

  it('重复的名字：说明原因，不再加一遍', async () => {
    renderDialog()
    const input = (await screen.findByLabelText('标签')) as HTMLInputElement

    fireEvent.change(input, { target: { value: '工具' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(screen.getByTitle('点击移除').textContent).toContain('工具'))

    fireEvent.change(input, { target: { value: '工具' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => expect(screen.getByText('这个标签已经加上了')).toBeTruthy())
    expect(screen.getAllByTitle('点击移除')).toHaveLength(1)
  })
})

/**
 * 分类那一格：**一个下拉**（原来是一排可点的 chip，中间还过了一版原生 `<select>`）。
 *
 * 这里钉住的是「提交出去的值」——形态换了三次，写进库的东西不能跟着变：
 * 选中的分类提交它的 `key`，`UNCATEGORIZED` 那一项提交**空串**。空串那条尤其要钉住：
 * 库里存的是空串而不是「未分类」这三个字，拿哨兵去写库，列表按分类筛时就永远匹配不到
 * 这一组。
 *
 * 控件本身的行为（开合、键盘、清空、没有空名字的选项）在
 * `components/Select.test.tsx` 里；这里测的是它在**这个表单里**接对了没有。
 */
describe('分类 · 下拉', () => {
  const ownCategory = { key: 'zebra', label: 'AI 项目', icon: null, builtin: false, projectCount: 0 }

  /** 这一格的触发控件。`Field` 那个 label 关联到的就是它 */
  function trigger() {
    return screen.getByRole('button', { name: '分类' })
  }

  /**
   * 等弹窗真的画出来。
   *
   * `formOpen` 是从 store 里改的，那一次重渲染**不在** `fireEvent` 的那个事件循环里，
   * 所以要 `await` 一下才拿得到身体——直接用同步的 `getByRole` 会在**下一帧才出现**
   * 的界面上找不到任何东西。
   */
  async function triggerLater() {
    return screen.findByRole('button', { name: '分类' })
  }

  /**
   * 打开浮层，并等这一次渲染用的是**服务端给的那份名单**，而不是 `useCategories()`
   * 的兜底。
   *
   * 兜底是内置四个，服务端那四条的 key 与文案和它一模一样——只等触发控件出现，会等在
   * 一个**看不出差别**的中间态上（分类接口还没回来），于是「用户自己加的分类在不在
   * 选项里」这种断言会随机地红。所以这里要等到**只有真名单里才有**的那一项出现在浮层
   * 里为止；浮层里那批选项是打开那一刻取的，没赶上就关掉重开。
   */
  async function openList() {
    const trigger = await triggerLater()
    fireEvent.click(trigger)
    await screen.findByRole('listbox', { name: '分类' })

    let tried = 0
    while (screen.queryByRole('option', { name: ownCategory.label }) === null) {
      if (tried >= 20) {
        throw new Error(`分类名单一直没带上「${ownCategory.label}」，等不到真数据`)
      }
      tried += 1
      // 关掉再打开：浮层里那份名单是打开那一刻取的
      fireEvent.click(trigger)
      fireEvent.click(trigger)
      await new Promise((r) => setTimeout(r, 10))
    }
  }

  /** 用真实提交走一遍：只看触发控件上写着什么，看不出「提交的是什么」。 */
  function mockCreate() {
    const submitted: Record<string, unknown>[] = []
    server.use(
      http.get('/api/categories', () =>
        HttpResponse.json({ categories: [...builtinCategoryList(), ownCategory] }),
      ),
      http.post('/api/projects', async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>
        submitted.push(body)
        return HttpResponse.json({
          project: { id: 1, ...body, tags: [], latestCheck: null, lastAttempt: null },
        })
      }),
      http.get('/api/tags', () => HttpResponse.json({ tags: [] })),
      // 写完之后 `useInvalidate()` 会让清单重新取一次；这里给个空清单，
      // 让它取到确定的东西，而不是冒出一条没 mock 的请求。
      http.get('/api/projects', () => HttpResponse.json({ projects: [], total: 0 })),
    )
    return submitted
  }

  /** 表单的必填两格：名称与路径。填完才可能提交，不然 submit 在本地就被拦下了。 */
  function fillRequired() {
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'canvas-editor' } })
    fireEvent.change(screen.getByLabelText('本地路径'), {
      target: { value: 'D:/repos/canvas-editor' },
    })
  }

  it('「分类」这个 label 关联到触发控件，默认显示「未分类」', async () => {
    mockCreate()
    renderDialog()

    const el = await screen.findByRole('button', { name: '分类' })
    // label 的 htmlFor 与控件的 id 对得上：点 label 能聚焦到它
    const label = screen.getByText('分类')
    expect(label.getAttribute('for')).toBe(el.getAttribute('id'))
    expect(el.getAttribute('id')).toBeTruthy()
    expect(el.textContent).toContain(UNCATEGORIZED)
    expect(el.getAttribute('aria-haspopup')).toBe('listbox')
  })

  it('未分类时，浮层里空值那一格**只有一条**、写着「未分类」，没有空白项', async () => {
    mockCreate()
    renderDialog()
    await openList()
    // 「未分类」＝空值：控件上显示占位，而没有选中任何分类
    expect(trigger().textContent).toContain(UNCATEGORIZED)

    const labels = screen.getAllByRole('option').map((o) => o.textContent ?? '')
    /*
      上一版原生下拉在这里多画了一枚空名字的选项：兜底那一支没排除空值，于是
      「未分类」下面挂了一个**没有文字**的重复项。换成这个组件之后它不该复现。

      顺序就是 `options` 的顺序：「未分类」在头一个，然后是当前清单里那个名单外的值
      （新项目没有，所以直接接内置四个）。这里只钉「有几项、各自叫什么」，
      不用 `toEqual` 比整个数组：文案里可能有全角空格这类**看着一样、实则不同**的
      字符，那种差异会在失败信息里显示成一模一样的两行。
    */
    expect(labels).toHaveLength(1 + 1 + builtinCategoryList().length)
    expect(labels[0]).toBe(UNCATEGORIZED)
    expect(labels.filter((l) => l.trim() === '')).toEqual([])
    for (const c of builtinCategoryList()) {
      expect(labels).toContain(c.label)
    }
    expect(screen.getAllByRole('option', { name: UNCATEGORIZED })).toHaveLength(1)
  })

  it('选一个用户自己加的分类 → 提交的是它的 key，控件上显示的是它的 label', async () => {
    const submitted = mockCreate()
    renderDialog()
    await openList()

    fireEvent.click(screen.getByRole('option', { name: ownCategory.label }))
    // 选项上是给人看的 label，「AI 项目」不是它的 key
    expect(trigger().textContent).toContain(ownCategory.label)
    expect(trigger().textContent).not.toContain(ownCategory.key)

    fillRequired()
    fireEvent.click(screen.getByText('添加'))

    await waitFor(() => expect(submitted).toHaveLength(1))
    expect(submitted[0]!['category']).toBe('zebra')
  })

  it('选「未分类」→ 提交的是空串（不是「未分类」这三个字）', async () => {
    const submitted = mockCreate()
    renderDialog()
    await openList()

    fireEvent.click(screen.getByRole('option', { name: ownCategory.label }))
    fireEvent.click(trigger())
    fireEvent.click(await screen.findByRole('option', { name: UNCATEGORIZED }))
    expect(trigger().textContent).toContain(UNCATEGORIZED)

    fillRequired()
    fireEvent.click(screen.getByText('添加'))

    await waitFor(() => expect(submitted).toHaveLength(1))
    expect(submitted[0]!['category']).toBe('')
  })

  it('触发控件上那枚 ×：清回「未分类」，提交的同样是空串', async () => {
    /*
      这个动作是**新控件带来的**（原生 `<select>` 没有），所以它的结果也得钉住：
      「清空」必须等于「没有分类」，不能变成某个 stringify 过的空值。
    */
    const submitted = mockCreate()
    renderDialog()
    await openList()
    fireEvent.click(screen.getByRole('option', { name: ownCategory.label }))

    fireEvent.click(screen.getByLabelText('清空分类'))
    expect(trigger().textContent).toContain(UNCATEGORIZED)

    fillRequired()
    fireEvent.click(screen.getByText('添加'))

    await waitFor(() => expect(submitted).toHaveLength(1))
    expect(submitted[0]!['category']).toBe('')
  })

  it('键盘：上下键移动高亮 + Enter 选中，提交出去的就是高亮那一项的 key', async () => {
    /*
      要钉的是这条链——高亮能移动、Enter 选的是高亮那一项、而**它报给表单的是那一项的
      `key`**（界面上写的是 label，写进库的必须是 key）。

      所以期望值从**高亮那一项的文字**反查，而不是从下标推：浮层里那批选项的排序
      （内置四个与用户自己加的谁在前）不是这条用例要管的事，写死下标只会让它去测顺序。
    */
    const submitted = mockCreate()
    renderDialog()
    await openList()

    const list = screen.getByRole('listbox', { name: '分类' })
    fireEvent.keyDown(list, { key: 'ArrowDown' })
    const highlighted = screen
      .getAllByRole('option')
      .filter((o) => o.hasAttribute('data-highlighted'))
    expect(highlighted).toHaveLength(1)

    const label = highlighted[0]!.textContent ?? ''
    const key =
      label === UNCATEGORIZED
        ? ''
        : (label === ownCategory.label ? ownCategory.key : undefined) ??
          builtinCategoryList().find((c) => c.label === label)?.key
    expect(key).toBeDefined()

    fireEvent.keyDown(list, { key: 'Enter' })

    fillRequired()
    fireEvent.click(screen.getByText('添加'))

    await waitFor(() => expect(submitted).toHaveLength(1))
    expect(submitted[0]!['category']).toBe(key)
  })

  it('清单里是个名单里已经没有的 key：把它自己摆出来，照旧原样提交', async () => {
    /*
      分类被删掉之后，项目上留着一个名单里没有的 key。原来那一排 chip 一格里
      都不高亮——看不出这个项目其实带着一个陈旧的值。下拉里把它当成一格「现状」
      摆出来（标签原样返回 key），而且**提交的值一个字符都不改**。
      这条兜底是有意写的：删了它，项目的分类一旦是名单外的旧值，控件上就只剩占位
      ——看着像「这个项目没有分类」。
    */
    useUiStore.setState({ formOpen: true, editingId: 5 })
    const project = {
      id: 5,
      name: 'canvas-editor',
      path: 'D:/repos/canvas-editor',
      remoteUrl: null,
      category: 'ghost',
      record: '',
      addedAt: '2026-10-01T00:00:00Z',
      sortOrder: 1,
      tags: [],
      latestCheck: null,
      lastAttempt: null,
    }
    const submitted: Record<string, unknown>[] = []
    server.use(
      http.get('/api/categories', () => HttpResponse.json({ categories: builtinCategoryList() })),
      http.get('/api/projects/5', () => HttpResponse.json({ project })),
      http.patch('/api/projects/5', async ({ request }) => {
        submitted.push((await request.json()) as Record<string, unknown>)
        return HttpResponse.json({ project })
      }),
      http.get('/api/tags', () => HttpResponse.json({ tags: [] })),
    )

    renderDialog()

    // 控件上明写着那个 key（不是一片空白），而且不是占位文案
    await waitFor(() => expect(trigger().textContent).toContain('ghost'))
    fireEvent.click(trigger())
    // 名字原样显示那个 key：编一个「未知分类」只会让人以为是自己填错了
    expect(await screen.findByRole('option', { name: 'ghost' })).toBeTruthy()

    fireEvent.click(screen.getByText('保存改动'))

    await waitFor(() => expect(submitted).toHaveLength(1))
    expect(submitted[0]!['category']).toBe('ghost')
  })
})

/**
 * 「记录」的**编辑 / 预览**切换。
 *
 * 这里守两条：
 *
 * 1. 默认是编辑态，切到预览能看见渲染结果、切回来草稿还在；
 * 2. **提交出去的仍然是 textarea 里那串 Markdown 原文**——预览是只读的一层显示，
 *    存下去的不是它渲染出来的 HTML。这条走真实 `POST /api/projects` 看请求体，
 *    只看 DOM 是看不出来的。
 *
 * 渲染本身（URL 白名单、raw HTML、GFM）在 `RecordView.test.tsx` 与
 * `features/readme/ReadmeView.test.tsx` 里；那两处与这里共用同一个 `MarkdownBody`。
 */
describe('记录 · 编辑 / 预览', () => {
  const record = '**重点**：在 https://example.com/a 看到的'

  function mockCreate() {
    const submitted: Record<string, unknown>[] = []
    server.use(
      http.post('/api/projects', async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>
        submitted.push(body)
        return HttpResponse.json({
          project: { id: 1, ...body, tags: [], latestCheck: null, lastAttempt: null },
        })
      }),
      http.get('/api/tags', () => HttpResponse.json({ tags: [] })),
      http.get('/api/projects', () => HttpResponse.json({ projects: [], total: 0 })),
    )
    return submitted
  }

  /** 记录那个 textarea。它切到预览时只是 `hidden`，节点还在 */
  async function box() {
    return (await screen.findByLabelText('记录')) as HTMLTextAreaElement
  }

  function fillRequired() {
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'canvas-editor' } })
    fireEvent.change(screen.getByLabelText('本地路径'), {
      target: { value: 'D:/repos/canvas-editor' },
    })
  }

  it('默认是编辑态：看得见 textarea，看不见预览那层 markdown 容器', async () => {
    mockCreate()
    renderDialog()

    const area = await box()
    expect(area.tagName).toBe('TEXTAREA')
    expect(area.hasAttribute('hidden')).toBe(false)
    expect(document.querySelector('.readme')).toBeNull()
    expect(screen.getByRole('button', { name: /编辑/ }).getAttribute('aria-pressed')).toBe('true')
  })

  it('点「预览」：渲染 markdown（`**粗体**` → `<strong>`），并过 URL 白名单', async () => {
    mockCreate()
    renderDialog()

    const area = await box()
    fireEvent.change(area, { target: { value: '**重点**' } })
    fireEvent.click(screen.getByRole('button', { name: /预览/ }))

    const preview = document.querySelector('.readme')!
    expect(preview.querySelector('strong')?.textContent).toBe('重点')
    expect(screen.getByRole('button', { name: /预览/ }).getAttribute('aria-pressed')).toBe('true')
  })

  it('预览跟着**正在输入**的内容实时走（不用先失焦）', async () => {
    mockCreate()
    renderDialog()

    const area = await box()
    fireEvent.change(area, { target: { value: '第一版' } })
    fireEvent.click(screen.getByRole('button', { name: /预览/ }))
    expect(document.querySelector('.readme')?.textContent).toContain('第一版')

    // textarea 在预览态下是隐藏的，但仍然可以继续输入（真实使用里是切回来再写，
    // 这里直接改值就是在验证「预览读的是同一个受控值」）
    fireEvent.change(area, { target: { value: '第二版' } })
    expect(document.querySelector('.readme')?.textContent).toContain('第二版')
    expect(document.querySelector('.readme')?.textContent).not.toContain('第一版')
  })

  it('预览里的链接过白名单：`javascript:` 不是链接', async () => {
    mockCreate()
    renderDialog()

    const area = await box()
    fireEvent.change(area, { target: { value: '[点我](javascript:alert(1))' } })
    fireEvent.click(screen.getByRole('button', { name: /预览/ }))

    const preview = document.querySelector('.readme')!
    expect(preview.textContent).toContain('点我')
    expect(preview.querySelector('a')).toBeNull()
  })

  it('切回「编辑」：textarea 的值还在（切走不是卸载）', async () => {
    mockCreate()
    renderDialog()

    const area = await box()
    fireEvent.change(area, { target: { value: record } })
    fireEvent.click(screen.getByRole('button', { name: /预览/ }))
    fireEvent.click(screen.getByRole('button', { name: /编辑/ }))

    const back = await box()
    expect(back.value).toBe(record)
    expect(back.hasAttribute('hidden')).toBe(false)
    expect(document.querySelector('.readme')).toBeNull()
  })

  it('提交的是**原始 Markdown 文本**，不是渲染出来的 HTML', async () => {
    /*
      这条是整件事的关键：预览是只读的一层显示，它**不参与提交**。
      所以请求体里必须是用户敲进去的那串字符，一个字都不差。
    */
    const submitted = mockCreate()
    renderDialog()

    const area = await box()
    fireEvent.change(area, { target: { value: record } })
    // 先切到预览、再切回来，模拟「看了一眼渲染结果再保存」
    fireEvent.click(screen.getByRole('button', { name: /预览/ }))
    fireEvent.click(screen.getByRole('button', { name: /编辑/ }))

    fillRequired()
    fireEvent.click(screen.getByText('添加'))

    await waitFor(() => expect(submitted).toHaveLength(1))
    expect(submitted[0]!['record']).toBe(record)
    // 渲染产物一个字符都不该混进请求体
    expect(submitted[0]!['record']).not.toContain('<strong>')
    expect(String(submitted[0]!['record'])).toContain('**重点**')
  })

  it('两枚切换按钮的 `type` 是 `button`（不是 HTML 默认的 `submit`）', async () => {
    mockCreate()
    renderDialog()
    await box()

    expect(screen.getByRole('button', { name: /编辑/ }).getAttribute('type')).toBe('button')
    expect(screen.getByRole('button', { name: /预览/ }).getAttribute('type')).toBe('button')
  })

  it('点「预览」/「编辑」**不提交、也不关闭弹窗**', async () => {
    /*
      用户实测过的那次：按钮住在 `<form>` 里，而 HTML 里 `<button>` 默认是 `submit`，
      于是点一下「预览」等于提交表单——校验通过就保存并关掉弹窗。
      所以这里把表单填到**能通过校验**的样子：那样才走到真提交那条路，
      用例才有意义（不填的话本来就提交不了，绿得没有信息量）。
    */
    const submitted = mockCreate()
    renderDialog()

    const area = await box()
    fireEvent.change(area, { target: { value: record } })
    fillRequired()

    fireEvent.click(screen.getByRole('button', { name: /预览/ }))
    fireEvent.click(screen.getByRole('button', { name: /编辑/ }))
    // 给「万一真的提交了」留出它跑完的时间，否则这条断言可能是抢在提交之前过的
    await new Promise((r) => setTimeout(r, 20))

    expect(submitted).toHaveLength(0)
    expect(useUiStore.getState().formOpen).toBe(true)
    // 弹窗还在：那两格还能改
    expect(screen.getByLabelText('名称')).toBeTruthy()
  })

  it('打开弹窗时焦点落在**第一个字段（名称）**上', async () => {
    /*
      查实的结论，不是愿望：`Dialog` 打开时把焦点给「内容区里第一个可聚焦元素」，
      而表单里可聚焦的次序是 名称 → 本地路径 → 「我自己的」勾选框 → 分类（它现在
      是一枚 `<button>`，以前是原生 `<select>`）→ 编辑/预览 → 记录 → 新标签。
      所以焦点是**名称**；分类那一格换成按钮**没有**动到这一条。

      钉住它是为了两件事：以后有人把某个控件换成更早就能聚焦的东西时能看出来；
      以及「一进弹窗记录就是能编辑的样子」那种观感不要再被误当成焦点问题。
    */
    mockCreate()
    renderDialog()

    const name = await screen.findByLabelText('名称')
    expect(document.activeElement).toBe(name)
  })
})
