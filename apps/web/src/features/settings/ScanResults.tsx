import { useState } from 'react'
import { Link } from 'react-router'
import { Check, Download, Eraser, Trash2 } from 'lucide-react'
import { MAX_SCAN_RESULTS } from '@git-nest/core'
import { ApiError } from '@/lib/api'
import { Button } from '@/components/ui'
import { useImport, type ScanResponse, type ScannedRepoWithProject } from './scanQueries'

/**
 * 一次扫描的结果：表头 / 被截断的警告 / 空 / 行 / 导入那一条。
 *
 * **勾选与「已确认」这两个 state 归这里**，因为它们只对**这一次结果**有意义：
 * 外层每扫成功一次就换一个 `key`，这份 state 跟着结果一起重来。
 * 「导入过一批之后确认闸永久失效」那个坑的判据就在这个文件里（见 `doImport`），
 * 它只有一个落点，不会再有第二份判断。
 *
 * 移除交给 `onRemove` 回外层：移除成功后要**重扫一次**让置灰状态跟上，
 * 而「怎么扫、扫的是哪个目录」是外层的知识。
 */
export function ScanResults({
  result,
  confirmThreshold,
  onNotice,
  onRemove,
}: {
  result: ScanResponse
  /** 超过它就要求确认（设置页里那个阈值） */
  confirmThreshold: number
  /** 写回外面那条提示（导入结果 / 上限提示） */
  onNotice: (message: string) => void
  onRemove: (repo: ScannedRepoWithProject) => void
}) {
  const importRepos = useImport()
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [confirmingImport, setConfirmingImport] = useState(false)

  const toggle = (p: string) =>
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(p)) next.delete(p)
      else next.add(p)
      return next
    })

  const untracked = result.found.filter((r) => !r.alreadyTracked)
  const tracked = result.found.filter((r) => r.alreadyTracked)
  // 超过阈值要先确认范围（沿用 github-kb 的惯例）。
  // **判据是本地 state，不能用 `importRepos.isIdle`**：mutation 一旦跑过一次
  // 就再也不是 idle（success / error 都算），于是「导入过一批之后，确认闸永久失效」
  // ——再勾 30 个仓库会直接导入。参照 UpdatePanel 的 confirming 写法。
  const overThreshold = picked.size > confirmThreshold

  const doImport = () => {
    /*
      **服务端的硬上限**（core 的同一个常量）。构造上不可达——扫描列出的候选数
      （`MAX_SCAN_RESULTS`）就等于导入能接受的最大条数，所以勾不出更多。
      留这一句是为了「改扫描上限却忘了导入」时能当场看到原因，而不是吃一个
      422「参数有误」；顺手也让这个约束在代码里显式存在，而不是靠两边数字碰巧相等。
    */
    if (picked.size > MAX_SCAN_RESULTS) {
      onNotice(
        `一次最多添加 ${MAX_SCAN_RESULTS} 个（现在勾了 ${picked.size} 个）：分两批添加，或把扫描目录填得更具体一些。`,
      )
      return
    }
    if (overThreshold && !confirmingImport) {
      setConfirmingImport(true)
      return
    }
    setConfirmingImport(false)
    importRepos.mutate(
      { paths: [...picked], category: '' },
      {
        onSuccess: (res) => {
          const msg =
            res.created.length > 0
              ? `已添加 ${res.created.length} 个`
              : '没有新的可添加'
          onNotice(
            res.skipped.length > 0
              ? `${msg}；跳过 ${res.skipped.length} 个（${res.skipped[0]?.reason}…）`
              : msg,
          )
          setPicked(new Set())
        },
        onError: (e) => onNotice(e instanceof ApiError ? e.message : '添加失败'),
      },
    )
  }

  return (
    <div className="mt-4 border border-line">
      <header className="flex flex-wrap items-center gap-2 border-b border-line-soft px-3 py-2">
        <span className="min-w-0 truncate font-mono text-[12px] text-ink-2">{result.dir}</span>
        <span className="text-[12px] text-ink-3">
          找到 {result.candidates} 个仓库{untracked.length > 0 ? `，${untracked.length} 个还没添加` : ''}
        </span>
        {untracked.length > 0 ? (
          <button
            onClick={() =>
              setPicked(
                picked.size === untracked.length
                  ? new Set()
                  : new Set(untracked.map((r) => r.dir)),
              )
            }
            className="ml-auto text-[12.5px] text-accent hover:underline"
          >
            {picked.size === untracked.length ? '全不选' : '全选'}
          </button>
        ) : null}
      </header>

      {/*
        被上限截断时必须说出来：静默少列几个，用户会以为「这个目录下就这么多仓库」，
        而那是假话（扫描是把目录树变成工作量的动作，不封顶的话一个盘根 + depth 3
        就是上万次 git 进程）。
      */}
      {result.truncated ? (
        <p className="border-b border-line-soft bg-panel px-3 py-2 text-[12.5px] text-signal-ahead">
          这个目录下的仓库比一次能列出的多：上面只是前 {result.found.length} 个（共发现{' '}
          {result.candidates} 个）。把目录填得更具体一些，或者关掉往下的层数再扫一次。
        </p>
      ) : null}

      {result.found.length === 0 ? (
        <p className="px-3 py-4 text-[13px] text-ink-3">
          这个目录下面没找到 git 仓库。往里多扫几层试试。
        </p>
      ) : (
        <ul>
          {result.found.map((repo) => (
            <ScanRow
              key={repo.dir}
              repo={repo}
              picked={picked.has(repo.dir)}
              onToggle={() => toggle(repo.dir)}
              onRemove={() => onRemove(repo)}
            />
          ))}
        </ul>
      )}

      {tracked.length > 0 ? (
        <p className="border-t border-line-soft px-3 py-2 text-[12px] text-ink-3">
          灰色的是已在清单里的，点名字可以直接去看
        </p>
      ) : null}

      {picked.size > 0 ? (
        <footer className="flex flex-wrap items-center gap-2 border-t border-line-soft px-3 py-2">
          {confirmingImport && overThreshold ? (
            <>
              <span className="text-[12.5px] text-signal-ahead">
                要一次加入 {picked.size} 个（超过确认阈值 {confirmThreshold}），确认吗？
              </span>
              <Button variant="primary" onClick={doImport} disabled={importRepos.isPending}>
                <Check size={14} aria-hidden />
                确认加入这 {picked.size} 个
              </Button>
              <Button onClick={() => setConfirmingImport(false)}>再想想</Button>
            </>
          ) : (
            <>
              <Button
                variant="primary"
                onClick={doImport}
                disabled={importRepos.isPending}
              >
                <Download size={14} aria-hidden />
                添加选中的 {picked.size} 个
              </Button>
              <Button
                onClick={() => {
                  setPicked(new Set())
                  setConfirmingImport(false)
                }}
              >
                <Eraser size={14} aria-hidden />
                清空勾选
              </Button>
            </>
          )}
        </footer>
      ) : null}
    </div>
  )
}

function ScanRow({
  repo,
  picked,
  onToggle,
  onRemove,
}: {
  repo: ScannedRepoWithProject
  picked: boolean
  onToggle: () => void
  onRemove: () => void
}) {
  return (
    <li
      className={`flex items-center gap-2.5 border-b border-line-soft px-3 py-1.5 last:border-b-0 ${
        repo.alreadyTracked ? 'opacity-55' : ''
      }`}
    >
      {repo.alreadyTracked ? (
        <span className="w-3.5 shrink-0" title="已经在清单里了" />
      ) : (
        <input
          type="checkbox"
          checked={picked}
          onChange={onToggle}
          aria-label={`选择 ${repo.name}`}
          className="list-check shrink-0"
        />
      )}

      {repo.projectId ? (
        <Link
          to={`/projects/${repo.projectId}`}
          className="w-40 min-w-0 shrink-0 truncate font-mono text-[12.5px] text-ink-2 hover:text-accent hover:underline"
        >
          {repo.name}
        </Link>
      ) : (
        <span className="w-40 min-w-0 shrink-0 truncate font-mono text-[12.5px] text-ink">
          {repo.name}
        </span>
      )}

      <span className="hidden w-40 min-w-0 shrink-0 truncate font-mono text-[11.5px] text-ink-3 sm:block">
        {repo.remoteUrl ?? '—'}
      </span>

      <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-2">
        {repo.summary ?? <span className="text-ink-3">（没有摘要）</span>}
      </span>

      {repo.alreadyTracked ? (
        <span className="flex shrink-0 items-center gap-2">
          <span className="font-mono text-[11px] text-ink-3">
            已在清单{repo.projectCategory ? ` · ${repo.projectCategory}` : ''}
          </span>
          {repo.projectId ? (
            <button
              onClick={onRemove}
              className="inline-flex items-center gap-1 text-[11.5px] text-ink-2 underline decoration-dotted hover:text-signal-bad"
              title="只从清单里移除这一条，磁盘上的仓库不动"
            >
              <Trash2 size={11} aria-hidden />
              移出清单
            </button>
          ) : null}
        </span>
      ) : (
        <span className="shrink-0 font-mono text-[11px] text-ink-3">
          {repo.summarySource === 'readme' ? 'README' : repo.summarySource === 'commit' ? 'commit' : '—'}
        </span>
      )}
    </li>
  )
}
