import { useEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useLocation } from 'react-router'
import type { ScannedRepo } from '@git-nest/core'
import { ApiError, api } from '@/lib/api'
import { Button, ErrorNote, Field, Input } from '@/components/ui'
import { useSaveSettings, useSettings } from './queries'
import { useRemoveProject } from '@/features/projects/queries'

export interface ScannedRepoWithProject extends ScannedRepo {
  projectId: number | null
  projectName: string | null
  projectCategory: string | null
}

interface ScanResponse {
  dir: string
  found: ScannedRepoWithProject[]
}

export function useScan() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { dir: string; depth: number; remember: boolean }) =>
      api.post<ScanResponse>('/scan', input),
    onSuccess: (_data, input) => {
      // remember 会把目录写进设置，不刷新的话新加的常用目录不会出现在页面上
      if (input.remember) void qc.invalidateQueries({ queryKey: ['settings'] })
    },
  })
}

export function useImport() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { paths: string[]; category: string }) =>
      api.post<{ created: { id: number; name: string }[]; skipped: { path: string; reason: string }[] }>(
        '/projects/import',
        input,
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['projects'] })
      void qc.invalidateQueries({ queryKey: ['status'] })
      void qc.invalidateQueries({ queryKey: ['settings'] })
    },
  })
}

/**
 * 扫描目录 → 勾选 → 入库。
 *
 * 扫描是只读的：它不写库、不动仓库。入库也是一条条 insert，
 * 名字取目录名、远程地址从 git 读，其余元数据留给用户补。
 */
export function ScanSection() {
  const { data: settings } = useSettings()
  const saveSettings = useSaveSettings()
  const scan = useScan()
  const importRepos = useImport()
  const [dir, setDir] = useState('')
  const [depth, setDepth] = useState(1)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [result, setResult] = useState<ScanResponse | null>(null)
  const [banner, setBanner] = useState<string | null>(null)
  const [removing, setRemoving] = useState<ScannedRepoWithProject | null>(null)
  const removeProject = useRemoveProject()

  // 从清单页点「扫描目录」跳过来时（/settings#scan），直接把焦点放到输入框
  const { hash } = useLocation()
  const dirRef = useRef<HTMLInputElement>(null)
  const sectionRef = useRef<HTMLElement>(null)
  useEffect(() => {
    if (hash !== '#scan') return
    sectionRef.current?.scrollIntoView({ block: 'start' })
    dirRef.current?.focus()
  }, [hash])

  const forgetDir = (target: string) => {
    const next = (settings?.scanDirs ?? []).filter((d) => d !== target)
    saveSettings.mutate({ scanDirs: next })
  }

  const runScan = (target: string, remember = false) => {
    const value = target.trim()
    if (!value) return
    scan.mutate(
      { dir: value, depth, remember },
      {
        onSuccess: (res) => {
          setResult(res)
          setBanner(null)
          // 新扫出来、还没在清单里的默认不勾：导入这种事宁少勿多
          setPicked(new Set())
        },
        onError: (e) => {
          setResult(null)
          setBanner(e instanceof ApiError ? e.message : '扫描失败')
        },
      },
    )
  }

  const toggle = (p: string) =>
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(p)) next.delete(p)
      else next.add(p)
      return next
    })

  const untracked = result?.found.filter((r) => !r.alreadyTracked) ?? []
  const tracked = result?.found.filter((r) => r.alreadyTracked) ?? []
  // 超过阈值要先确认范围（沿用 github-kb 的惯例）
  const needsConfirm =
    picked.size > (settings?.confirmThreshold ?? 20) && importRepos.isIdle

  const doImport = () => {
    importRepos.mutate(
      { paths: [...picked], category: '' },
      {
        onSuccess: (res) => {
          const msg =
            res.created.length > 0
              ? `已加入清单 ${res.created.length} 个`
              : '没有新的加入清单'
          setBanner(
            res.skipped.length > 0
              ? `${msg}；跳过 ${res.skipped.length} 个（${res.skipped[0]?.reason}…）`
              : msg,
          )
          setPicked(new Set())
        },
        onError: (e) => setBanner(e instanceof ApiError ? e.message : '入库失败'),
      },
    )
  }

  return (
    <section ref={sectionRef} id="scan">
      <h2 className="text-[15px] font-semibold text-ink">扫描目录</h2>
      <p className="mt-0.5 text-[13px] text-ink-2">
        扫描只读：它只看有哪些仓库，不写清单也不动磁盘。挑中的才会入库。
      </p>

      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
        <Field label="目录" hint="只扫直接子目录；也可以填到上层再往下扫">
          {(id) => (
            <Input
              id={id}
              ref={dirRef}
              value={dir}
              onChange={(e) => setDir(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && runScan(dir, true)}
              placeholder="D:/Git"
              className="sm:w-80"
            />
          )}
        </Field>
        <Field label="往下扫几层" hint="1 = 只看子目录">
          {(id) => (
            <Input
              id={id}
              type="number"
              min={1}
              max={3}
              value={depth}
              onChange={(e) => setDepth(Math.min(Math.max(Number(e.target.value) || 1, 1), 3))}
              className="!w-24"
            />
          )}
        </Field>
        <Button
          onClick={() => runScan(dir, true)}
          disabled={!dir.trim() || scan.isPending}
        >
          {scan.isPending ? '扫描中…' : '扫描'}
        </Button>
      </div>

      {settings && settings.scanDirs.length > 0 ? (
        <div className="mt-3">
          <p className="text-[12px] text-ink-3">常用目录</p>
          <ul className="mt-1 flex flex-wrap gap-1.5">
            {settings.scanDirs.map((d) => (
              <li key={d} className="flex items-center rounded-[3px] border border-line bg-panel">
                <button
                  onClick={() => {
                    setDir(d)
                    runScan(d, true)
                  }}
                  className="px-1.5 py-0.5 font-mono text-[11.5px] text-ink-2 hover:text-ink"
                >
                  {d}
                </button>
                <button
                  onClick={() => forgetDir(d)}
                  aria-label={`不再记住 ${d}`}
                  title="不再记住这个目录"
                  className="border-l border-line px-1 py-0.5 font-mono text-[11.5px] text-ink-3 hover:bg-panel hover:text-signal-bad"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {banner ? (
        <div className="mt-3">
          <ErrorNote message={banner} />
        </div>
      ) : null}

      {result ? (
        <div className="mt-4 border border-line">
          <header className="flex flex-wrap items-center gap-2 border-b border-line-soft px-3 py-2">
            <span className="min-w-0 truncate font-mono text-[12px] text-ink-2">{result.dir}</span>
            <span className="text-[12px] text-ink-3">
              找到 {result.found.length} 个仓库{untracked.length > 0 ? `，${untracked.length} 个还没入库` : ''}
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
                  onRemove={() => setRemoving(repo)}
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
              {needsConfirm ? (
                <>
                  <span className="text-[12.5px] text-signal-ahead">
                    要一次加入 {picked.size} 个，确认吗？
                  </span>
                  <Button variant="primary" onClick={doImport} disabled={importRepos.isPending}>
                    确认加入这 {picked.size} 个
                  </Button>
                  <Button onClick={() => setPicked(new Set())}>再想想</Button>
                </>
              ) : (
                <>
                  <Button
                    variant="primary"
                    onClick={doImport}
                    disabled={importRepos.isPending}
                  >
                    把选中的 {picked.size} 个加入清单
                  </Button>
                  <Button onClick={() => setPicked(new Set())}>清空勾选</Button>
                </>
              )}
            </footer>
          ) : null}
        </div>
      ) : null}
      {removing?.projectId ? (
        <RemoveDialog
          repo={removing}
          busy={removeProject.isPending}
          onClose={() => setRemoving(null)}
          onConfirm={() => {
            removeProject.mutate(removing.projectId!, {
              onSuccess: () => {
                setBanner(`已把 ${removing.name} 移出清单（磁盘上的仓库没动）`)
                setRemoving(null)
                // 重新扫一遍，让置灰状态跟上
                runScan(result?.dir ?? dir)
              },
              onError: (e) =>
                setBanner(e instanceof ApiError ? e.message : '移除失败'),
            })
          }}
        />
      ) : null}
    </section>
  )
}

/** 设计文档 7.3：扫描区里也能「移除管理」——只删记录，不动磁盘。 */
function RemoveDialog({
  repo,
  busy,
  onClose,
  onConfirm,
}: {
  repo: ScannedRepoWithProject
  busy: boolean
  onClose: () => void
  onConfirm: () => void
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/25 p-6"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-md rounded-[4px] border border-line bg-panel px-5 py-4 shadow-[0_8px_32px_rgba(19,24,29,0.14)]"
      >
        <h2 className="text-[15px] font-semibold text-ink">把 {repo.name} 移出清单？</h2>
        <p className="mt-1.5 text-[13px] text-ink-2">
          只删掉这一条记录。磁盘上的{' '}
          <span className="font-mono text-[12px]">{repo.dir}</span> 和它的 git 历史都不动，
          备注与标签关联会一起清掉。
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button onClick={onClose}>留下</Button>
          <Button variant="danger" disabled={busy} onClick={onConfirm}>
            移出清单
          </Button>
        </div>
      </div>
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
          className="size-3.5 shrink-0 accent-[#14506e]"
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
              className="text-[11.5px] text-ink-2 underline decoration-dotted hover:text-signal-bad"
              title="只从清单里移除这一条记录，磁盘上的仓库不动"
            >
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
