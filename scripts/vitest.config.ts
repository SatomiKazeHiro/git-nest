import { defineConfig } from 'vitest/config'

/**
 * 仓库脚本（`scripts/`）自己的测试。
 *
 * 目前只有 `check-encoding.test.ts` —— 它是那个闸门的**正对照**：
 * 证明「该报的会报」，以及「登记过的例外只放行登记过的那三处」。
 *
 * 环境用 node（脚本跑在 node 里，不需要 jsdom，也不需要 web 的 setup）。
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['**/*.test.ts'],
  },
})
