import { useState } from 'react'
import { Button, ErrorNote } from '@/components/ui'
import { ApiError } from '@/lib/api'
import { formatBytes } from '@/lib/format'
import { README_FULL_MAX_BYTES } from '@git-nest/core'
import { MarkdownBody } from './MarkdownBody'
import { useReadme } from './queries'

const reason = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback)

/**
 * README 的渲染。
 *
 * 两条不变量：
 * 1. **打开它不向外部发任何请求。** 渲染那一层（`urlTransform` 里那道 `readmeUrl`
 *    闸门、`skipHtml`、`components` 覆写）现在住在 `MarkdownBody` 里，与「记录」的
 *    预览、详情页那条只读记录**共用同一份**——这一页只负责取数与分级加载。
 *    兜底依旧是「不可点的普通文字 / alt 文字 / 灰底占位」，而不是留一个点了没反应
 *    或加载不出来的元素。
 * 2. **读不出来与没有是两回事**，界面上说的话不一样。
 *
 * **两条查询而不是一条**：首屏那条负责「有没有 / 读没读得出来」，
 * 完整那条只负责「加载完整」这一个动作的结果。用一条的话，「加载完整」一失败
 * 整页就变成错误页——用户刚读到一半，渐变和按钮全没了，连重试的地方都没有。
 * 现在失败时 `whole.data` 是 undefined，于是内容退回首屏那份，渐变与按钮原样留着。
 */
export function ReadmeView({ projectId }: { projectId: number }) {
  const [full, setFull] = useState(false)
  const initial = useReadme(projectId, false)
  const whole = useReadme(projectId, full)

  if (initial.isPending) {
    return <p className="py-6 font-mono text-[12.5px] text-ink-3">正在读 README…</p>
  }
  // 400 是服务端说了原因的（「目录不在了」/「不是仓库」），照着显示，不自己编
  if (initial.isError) {
    return <ErrorNote message={reason(initial.error, '读不到 README')} />
  }
  const first = initial.data
  if (!first || first.file === null) {
    return (
      <p className="text-[12.5px] text-ink-3">
        这个仓库没有 README——想留点什么，在「编辑资料」的「记录」里写一段。
      </p>
    )
  }

  // 完整那条还没回来、或失败了，就用首屏那份继续渲染
  const data = (full ? whole.data : null) ?? first
  const bytes = data.bytes
  const truncated = data.truncated
  // 超过完整上限还给按钮，点下去还是被截断——那是死控件。直接说清有多大。
  const tooBig = bytes > README_FULL_MAX_BYTES

  return (
    <div className="text-[12.5px] text-ink-3 h-full overflow-auto px-4 py-3">
      <p className="mb-2 font-mono">
        {data.file} · {formatBytes(bytes)}
      </p>

      <MarkdownBody>{data.content ?? ''}</MarkdownBody>

      {/*
        渐变只在**真被截断**时出现。40KB 的 README 连渐变都不该有——
        那一块存在的唯一理由是「后面还有东西，而这里给不了」。
      */}
      {truncated ? (
        <div className="readme-more">
          <div className="readme-more-inner">
            {tooBig ? (
              <p>这个 README 有 {formatBytes(bytes)}，太大了，没法在这里显示。</p>
            ) : (
              <Button
                disabled={whole.isFetching}
                // 已经切到完整那条了就变成重试，不用再改 state
                onClick={() => (full ? void whole.refetch() : setFull(true))}
              >
                {whole.isFetching ? '正在读…' : `加载完整文档（${formatBytes(bytes)}）`}
              </Button>
            )}
          </div>
        </div>
      ) : null}

      {/*
        「加载完整」失败要说出来。渐变与按钮**留着**（上面 data 回退到了首屏那份），
        下面挂一条原因——一声不响地把按钮变回可点，用户只会以为刚才那次已经加载完了。
      */}
      {full && whole.isError ? (
        <div className="mt-2">
          <ErrorNote message={`完整版没读出来：${reason(whole.error, '再点一次试试')}`} />
        </div>
      ) : null}
    </div>
  )
}