import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  PlatformError,
  canPickDirectory,
  capabilities,
  desktopWindow,
  pickDirectory,
} from './platform'

/**
 * 平台模块的语义。这里钉的是**两种环境下的返回值含义**，尤其这一条：
 *
 * - `null` = 用户点了取消；
 * - 能力不可用 / 打开失败 = **抛 `PlatformError`**。
 *
 * 把「不可用」也做成 `null` 是最容易犯的那种错：界面会把一次故障显示成
 * 「用户取消了」，于是排查时什么都看不到（这是"不静默兜底"在这块的具体落点）。
 */

/** 装一个假的 `__TAURI__`；传 undefined = 拆掉，模拟浏览器。 */
function installTauri(value: unknown) {
  const g = globalThis as { __TAURI__?: unknown }
  if (value === undefined) delete g.__TAURI__
  else g.__TAURI__ = value
}

afterEach(() => installTauri(undefined))

describe('桌面壳能力检测', () => {
  it('浏览器里：两项能力都没有，窗口控件返回 null', () => {
    expect(desktopWindow()).toBeNull()
    expect(capabilities()).toEqual({ windowControls: false, nativeFolderPicker: false })
    expect(canPickDirectory()).toBe(false)
  })

  it('v2 形态（模块命名空间 + getCurrentWindow）也认', () => {
    const win = { minimize: vi.fn(), toggleMaximize: vi.fn(), close: vi.fn() }
    installTauri({ window: { getCurrentWindow: () => win } })
    expect(desktopWindow()).toBe(win)
    expect(capabilities().windowControls).toBe(true)
  })

  it('方法没挂齐就说没有（只判对象在不在会得到假的肯定）', () => {
    installTauri({ window: { getCurrentWindow: () => ({ minimize: () => Promise.resolve() }) } })
    expect(desktopWindow()).toBeNull()
    expect(capabilities().windowControls).toBe(false)
  })

  it('桌面壳缺 dialog 插件：窗口控件在、选目录不在（这正是漏配置的样子）', () => {
    installTauri({
      window: { close: () => Promise.resolve(), minimize: () => Promise.resolve(), toggleMaximize: () => Promise.resolve() },
    })
    expect(capabilities()).toEqual({ windowControls: true, nativeFolderPicker: false })
  })
})

describe('选目录', () => {
  it('只有核心 API（withGlobalTauri 的常见形态）：走 invoke 那条兜底路', async () => {
    const invoke = vi.fn().mockResolvedValue('D:/Git/git-nest')
    installTauri({ core: { invoke } })

    expect(canPickDirectory()).toBe(true)
    await expect(pickDirectory()).resolves.toBe('D:/Git/git-nest')
    // 插件命令的底层通道；options 原样带过去（参数名必须是 options）
    expect(invoke).toHaveBeenCalledWith('plugin:dialog|open', {
      options: { directory: true, multiple: false },
    })
  })

  it('两条路都在时，优先用插件自己的 JS API', async () => {
    const open = vi.fn().mockResolvedValue('D:/a')
    const invoke = vi.fn().mockResolvedValue('D:/b')
    installTauri({ dialog: { open }, core: { invoke } })

    await expect(pickDirectory()).resolves.toBe('D:/a')
    expect(invoke).not.toHaveBeenCalled()
  })

  it('不可用时抛 PlatformError，不是返回 null', async () => {
    await expect(pickDirectory()).rejects.toBeInstanceOf(PlatformError)
    // 浏览器与「壳里漏了插件」要说清是哪一种：排查方向完全不同
    await expect(pickDirectory()).rejects.toThrow(/浏览器/)
    installTauri({ window: {} })
    await expect(pickDirectory()).rejects.toThrow(/dialog 插件/)
  })

  it('选中目录就返回那个绝对路径，选项按「选目录、单选」传下去', async () => {
    const open = vi.fn().mockResolvedValue('D:\\Git\\canvas-editor')
    installTauri({ dialog: { open } })

    await expect(pickDirectory('选一个仓库目录')).resolves.toBe('D:\\Git\\canvas-editor')
    expect(open).toHaveBeenCalledWith({ directory: true, multiple: false, title: '选一个仓库目录' })
  })

  it('用户取消 → null（这是唯一一个 null 的含义）', async () => {
    installTauri({ dialog: { open: vi.fn().mockResolvedValue(null) } })
    await expect(pickDirectory()).resolves.toBeNull()
  })

  it('回了数组（多选）也取第一个，不当错误', async () => {
    installTauri({ dialog: { open: vi.fn().mockResolvedValue(['D:/a', 'D:/b']) } })
    await expect(pickDirectory()).resolves.toBe('D:/a')
  })

  it('底层抛错 → 包成 PlatformError，原始错误留在 message 与 cause 里', async () => {
    const boom = new Error('OS error 1223')
    installTauri({ dialog: { open: vi.fn().mockRejectedValue(boom) } })

    const err = await pickDirectory().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(PlatformError)
    expect((err as PlatformError).capability).toBe('native-folder-picker')
    expect((err as PlatformError).message).toContain('OS error 1223')
    expect((err as PlatformError).cause).toBe(boom)
  })
})
