import { describe, expect, it } from 'vitest'
import { UPDATE_STATUSES, isRemoteCheckStatus } from '@git-nest/core'
import { statusText, statusTone, textFor, toneFor } from './text'

/**
 * 措辞表与**降级政策**的词表守卫。
 *
 * 这一条替代的是"再抄一份名单"：`text.ts` 曾经自带
 * `REMOTE_CLAIMS = new Set(['up_to_date','behind','ahead','diverged'])`，与 core 的
 * `REMOTE_CHECK_STATUSES`、server 的 `COUNTED` 是同一件事的三份拷贝。
 *
 * 为什么值得一条用例：这三处决定的都是「哪次检查算合格」，也就是界面的**新鲜度**。
 * 断网之后点一次检查，失败的检查若被当成合格结论，界面就会显示刚刚确认过的绿色
 * 「已是最新」——这正是这个软件最想消灭的那类假话。三份拷贝一样时看不出问题，
 * 要等改了一处才炸。
 *
 * 断言的是**等价关系**（降级与否 == core 的谓词），不是具体措辞：措辞会改，
 * 这条政策不该改。
 */
describe('状态措辞 · 覆盖与降级政策', () => {
  it('每个更新状态都有一句话与一个色档', () => {
    for (const status of UPDATE_STATUSES) {
      expect(statusText(status), `状态 ${status} 没有文案`).toBeTruthy()
      expect(statusTone(status), `状态 ${status} 没有色档`).toBeTruthy()
    }
  })

  it('「远程结论」的判定与 core 的 isRemoteCheckStatus 完全一致', () => {
    for (const status of UPDATE_STATUSES) {
      const shouldQualify = isRemoteCheckStatus(status)

      // 没新鲜度时：远程结论降档成灰、并加限定语；纯本地事实照常直说。
      const downgraded = toneFor(status, 'never') !== statusTone(status)
      const qualified = textFor(status, 'never') !== statusText(status)

      expect(downgraded, `${status} 的灰色降级与 core 的「问过远程」判定不一致`).toBe(shouldQualify)
      expect(qualified, `${status} 的限定语与 core 的「问过远程」判定不一致`).toBe(shouldQualify)
    }
  })
})
