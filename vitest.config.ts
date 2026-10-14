import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    /*
      第四个 project 是给仓库脚本（`scripts/`）自己的测试用的。
      为什么单独一个而不是塞进 apps/web：`scripts/check-encoding.test.ts` 测的是
      **仓库闸门**（`scripts/check-encoding.mjs`），它不属于任何一个应用包；
      放进 apps/web 会让「这个测试为什么在这」变成一个需要解释的问题。

      它的 include 只匹配 scripts 下的测试文件，所以对既有三个 project 的
      用例集合**零影响**（现在 scripts 下只有这一个测试文件）。

      注意（踩过）：注释里**不要**写带星号的 glob 字面量——里面的星号加斜杠会把
      块注释提前关掉，esbuild 于是把后面当成代码，报 "Expected identifier but found ."。
    */
    projects: ['packages/core', 'apps/server', 'apps/web', 'scripts'],
  },
})
