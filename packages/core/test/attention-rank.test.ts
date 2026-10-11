import { describe, expect, it } from 'vitest'
import { ATTENTION_RANK, ATTENTION_VALUES } from '../src/types.ts'

/**
 * `ATTENTION_RANK`：**行动优先**的次序，清单「按状态」排序用的就是它。
 *
 * 为什么它得单独存在、还得有测试：这个次序原来只写在服务端那条 SQL 的
 * `CASE … WHEN 'ready' THEN 0 …` 里——读 core 的人看到 `ATTENTION_VALUES`
 * 完全不知道「哪个该排在前面」这件事存在，更不知道加一个新值要同时改 SQL。
 * 现在次序和取值住在同一个文件里，两条测试把它们的对应关系钉住：
 * 改了一处而漏了另一处，这里会红。
 */
describe('ATTENTION_RANK · 行动优先的次序', () => {
  it('一个不多、一个不少：加了新的 attention，就必须在这里给它一个位置', () => {
    expect([...ATTENTION_RANK].sort()).toEqual([...ATTENTION_VALUES].sort())
    expect(ATTENTION_RANK).toHaveLength(ATTENTION_VALUES.length)
  })

  it('能动手的在前，没事的垫底', () => {
    const rank = (v: (typeof ATTENTION_VALUES)[number]) => ATTENTION_RANK.indexOf(v)

    expect(rank('ready')).toBeLessThan(rank('blocked'))
    expect(rank('blocked')).toBeLessThan(rank('decide'))
    // 没查过（还没问过远程）比不上不下更该动手，但排在最没问题的前面
    expect(rank('decide')).toBeLessThan(rank('unchecked'))
    expect(rank('unchecked')).toBeLessThan(rank('synced'))
  })
})
