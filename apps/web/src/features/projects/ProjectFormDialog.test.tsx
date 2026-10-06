import { describe, expect, it, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { server } from '@/test/mocks/server'
import { ProjectFormDialog } from './ProjectFormDialog'
import { useUiStore } from '@/store/ui'

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
  useUiStore.setState({ formOpen: true, editingId: null })
  server.use(http.get('/api/tags', () => HttpResponse.json({ tags: [] })))
})

function renderDialog() {
  return render(
    <QueryClientProvider client={makeClient()}>
      <ProjectFormDialog />
    </QueryClientProvider>,
  )
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
