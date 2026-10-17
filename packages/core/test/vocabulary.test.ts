import { describe, expect, it } from 'vitest'
import {
  GIT_ERROR_KINDS,
  REMOTE_CHECK_STATUSES,
  UPDATE_STATUSES,
  isRemoteCheckStatus,
} from '../src/index.ts'

/**
 * 词表的**集合守卫**。
 *
 * 为什么这类用例比"断言某句话写得对不对"值钱：`UpdateStatus` / `GitErrorKind` 是跨层
 * 共享的词表，三层各按它分支（core 的判定、server 的"哪次检查算合格"、web 的措辞与降级）。
 * 只有类型的话，"新增一个状态之后哪几处该跟着改"没有任何运行期的东西可以断言，
 * 漏改一处只表现为界面少一句话——编译绿、测试绿、用户看到假话。
 *
 * 所以这里钉的是**集合关系**（谁是谁的子集、谓词与集合是否等价），不是措辞。
 * 措辞会改，集合关系不该改。
 *
 * 从 `../src/index.ts`（浏览器安全的那个 barrel）引，顺带钉住"这些数组确实从公共入口
 * 出得去"——它们以前只在类型层面存在，谁都拿不到。
 */
describe('状态词表', () => {
  it('没有重复取值（加值时手滑复制一行会在这里红）', () => {
    expect(new Set(UPDATE_STATUSES).size).toBe(UPDATE_STATUSES.length)
    expect(new Set(GIT_ERROR_KINDS).size).toBe(GIT_ERROR_KINDS.length)
  })

  it('「问过远程」那四种是状态词表的子集，且谓词与集合完全等价', () => {
    // 子集：REMOTE_CHECK_STATUSES 是 UPDATE_STATUSES 的一部分，不是另一套词表
    for (const status of REMOTE_CHECK_STATUSES) {
      expect(UPDATE_STATUSES, `REMOTE_CHECK_STATUSES 里的 ${status} 不在状态词表里`).toContain(
        status,
      )
    }

    /*
      等价：`isRemoteCheckStatus(s)` 必须**恰好**在集合里为真。
      这条挡的是"同一条规则两份实现"——web 曾经自己抄了一份 REMOTE_CLAIMS，
      server 也抄了一份 COUNTED，三份一样时看不出问题，改一处才炸。
    */
    for (const status of UPDATE_STATUSES) {
      const inSet = (REMOTE_CHECK_STATUSES as readonly string[]).includes(status)
      expect(isRemoteCheckStatus(status), `isRemoteCheckStatus(${status}) 与集合不一致`).toBe(
        inSet,
      )
    }
  })
})
