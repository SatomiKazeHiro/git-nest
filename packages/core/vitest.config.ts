import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // 这些是**真实 git 集成测试**：每个用例都要 init/clone 真仓库，
    // Windows 上单条 git 命令几百毫秒。vitest 默认 5s 在并行跑全套时不够用
    // （git 进程互相争 IO，单例能从 2.3s 拖到 5s+），表现为随机超时。
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
})
