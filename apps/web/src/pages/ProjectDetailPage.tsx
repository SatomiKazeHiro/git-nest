import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { orderBy } from 'es-toolkit'
import { isRemoteCheckStatus, type RepoStatus, type UpdateStatus } from '@git-nest/core'
import { Button, ErrorNote, Textarea } from '@/components/ui'
import { formatRelative } from '@/lib/format'
import { useUiStore } from '@/store/ui'
import { ProjectFormDialog } from '@/features/projects/ProjectFormDialog'
import { GitGraph } from '@/features/gitgraph/GitGraph'
import { useProjectStatus } from '@/features/status/queries'
import { statusTitle, textFor, freshnessOf } from '@/features/status/StatusCell'
import { UpdatePanel } from '@/features/updates/UpdatePanel'
import {
  useAddNote,
  useProject,
  useRemoveNote,
  useSetProjectTags,
  useTags,
  useUpdateNote,
} from '@/features/projects/queries'
import { TagPicker } from '@/features/projects/TagPicker'

export function ProjectDetailPage() {
  const { id } = useParams()
  const projectId = Number(id)
  const openEdit = useUiStore((s) => s.openEdit)
  const [updating, setUpdating] = useState(false)
  const [editingTags, setEditingTags] = useState(false)
  const [tagNames, setTagNames] = useState<string[]>([])
  const { data: allTags = [] } = useTags()
  const setTags = useSetProjectTags()
  // 点一次「重新读取」就把 nonce 加一，绕过服务端短缓存重查一遍
  const [freshNonce, setFreshNonce] = useState(0)
  const validId = Number.isFinite(projectId) ? projectId : null
  const { data: project, isPending, error } = useProject(validId)
  // 状态提到页面这一层：missing 的提示要出现在页面最上面，不只是状态面板里
  const { data: status, isFetching } = useProjectStatus(validId, {
    fresh: freshNonce > 0,
    nonce: freshNonce,
  })

  if (error) {
    return (
      <div className="p-6">
        <ErrorNote message="读不到这个项目。它可能已经从清单里移除了。" />
        <Link to="/" className="mt-3 inline-block text-[13px] text-accent hover:underline">
          回到清单
        </Link>
      </div>
    )
  }
  if (isPending || !project) {
    return <p className="p-6 font-mono text-[13px] text-ink-3">正在读项目…</p>
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-7 px-6 py-6">
      {status?.status === 'missing' ? (
        <div className="border-l-2 border-signal-bad bg-panel px-4 py-3">
          <p className="text-[13.5px] font-medium text-signal-bad">这个目录不在了</p>
          <p className="mt-1 text-[13px] text-ink-2">
            清单里的记录还在（备注、标签都留着），只是磁盘上找不到
            <span className="font-mono text-[12px]"> {project.path}</span>。
            仓库如果是搬了家或改了名，点「编辑」把路径指到新位置就行；要是不用了就「移出清单」。
          </p>
        </div>
      ) : null}

      <div>
        <Link to="/" className="font-mono text-[12px] text-ink-3 hover:text-accent hover:underline">
          ← 清单
        </Link>
        <div className="mt-1.5 flex items-start gap-2">
          <h1 className="text-[22px] font-semibold leading-tight text-ink">{project.name}</h1>
          <Button onClick={() => openEdit(project.id)}>编辑</Button>
          <Button onClick={() => setUpdating((v) => !v)}>
            {updating ? '收起更新' : '检查更新'}
          </Button>
        </div>
        {project.summary ? (
          <p className="mt-2 max-w-prose text-[13.5px] text-ink-2">{project.summary}</p>
        ) : null}
      </div>

      <dl className="grid grid-cols-[7rem_1fr] gap-y-2 border-y border-line-soft py-4 text-[13px]">
        <dt className="text-ink-3">本地路径</dt>
        <dd className="min-w-0 truncate font-mono text-[12.5px] text-ink">{project.path}</dd>

        <dt className="text-ink-3">远程</dt>
        <dd className="min-w-0 truncate font-mono text-[12.5px] text-ink">
          {project.remoteUrl ? (
            <a href={project.remoteUrl} target="_blank" rel="noreferrer" className="hover:text-accent hover:underline">
              {project.remoteUrl}
            </a>
          ) : (
            <span className="text-ink-3">纯本地仓库</span>
          )}
        </dd>

        <dt className="text-ink-3">分类</dt>
        <dd className="font-mono text-[12.5px] text-ink">{project.category || '未分类'}</dd>

        <dt className="text-ink-3">标签</dt>
        <dd className="flex flex-wrap items-center gap-1">
          {project.tags.length === 0 ? (
            <span className="text-ink-3">—</span>
          ) : (
            project.tags.map((t) => (
              <span
                key={t.id}
                className="rounded-[2px] border border-line px-1 font-mono text-[11.5px] text-ink-2"
              >
                {t.name}
              </span>
            ))
          )}
          {/* 设计文档 7.2：tag 管理放在详情页，不必先点「编辑」弹窗 */}
          {editingTags ? (
            <dd className="col-span-2 mt-1.5 flex flex-wrap items-center gap-2">
              <TagPicker
                tags={allTags}
                value={tagNames}
                onChange={(next) => {
                  setTagNames(next)
                  setTags.mutate({ id: project.id, tagNames: next })
                }}
              />
              <Button onClick={() => setEditingTags(false)}>好了</Button>
            </dd>
          ) : (
            <button
              onClick={() => {
                setTagNames(project.tags.map((t) => t.name))
                setEditingTags(true)
              }}
              className="ml-1 text-[12px] text-ink-2 hover:text-accent hover:underline"
            >
              编辑
            </button>
          )}
        </dd>

        {project.sourceUrl ? (
          <>
            <dt className="text-ink-3">来源</dt>
            <dd className="min-w-0 truncate font-mono text-[12.5px]">
              <a
                href={project.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="text-accent hover:underline"
              >
                {project.sourceUrl}
              </a>
            </dd>
          </>
        ) : null}

        <dt className="text-ink-3">加入清单</dt>
        <dd className="font-mono text-[12.5px] text-ink-2">{formatRelative(project.addedAt)}</dd>
      </dl>

      {updating ? (
        <UpdatePanel ids={[project.id]} onClose={() => setUpdating(false)} />
      ) : null}
      <StatusPanel
        status={status}
        isFetching={isFetching}
        onRefresh={() => setFreshNonce((n) => n + 1)}
        lastCheckAt={project.latestCheck?.checkedAt ?? null}
        lastCheckStatus={project.latestCheck?.status ?? null}
      />

      <section>
        <h2 className="mb-2 text-[15px] font-semibold text-ink">备注</h2>
        <Notes projectId={project.id} notes={project.notes} />
      </section>

      <section>
        <h2 className="mb-2 text-[15px] font-semibold text-ink">提交图</h2>
        <div className="border border-line-soft bg-panel px-2 py-1">
          <GitGraph projectId={project.id} />
        </div>
      </section>

      <section className="border border-dashed border-line px-4 py-3">
        <h2 className="text-[13px] font-semibold text-ink">这一页只读</h2>
        <p className="mt-1 text-[13px] text-ink-2">
          提交、合并、rebase 不在这里做——它们会改写仓库，交给工具就等于越界。
          要操作就去终端，完了回来点「重新读取」。
        </p>
      </section>

      <ProjectFormDialog />
    </div>
  )
}

/** git 状态面板：分支、上下游、最后提交。「重新读取」强制绕开短缓存并绕开服务端缓存。 */
function StatusPanel({
  status,
  isFetching,
  onRefresh,
  lastCheckAt,
  lastCheckStatus,
}: {
  status: RepoStatus | undefined
  isFetching: boolean
  onRefresh: () => void
  lastCheckAt: string | null
  lastCheckStatus: UpdateStatus | null
}) {
  if (!status) {
    return <p className="font-mono text-[12px] text-ink-3">正在读 git 状态…</p>
  }
  // server 侧的 latestCheck 只在「真正问到远程」时才非空；这里再用共享判定守一道。
  // 拿不到合格状态就按「从没查过」处理——宁可说不知道，也不说没依据的肯定。
  const hasRemoteCheck = Boolean(lastCheckStatus && isRemoteCheckStatus(lastCheckStatus))
  const freshness = hasRemoteCheck ? freshnessOf({ checkedAt: lastCheckAt }) : 'never'

  const rows: [string, string][] = [
    ['状态', textFor(status.status, freshness)],
    ['当前分支', status.branch ?? (status.detached ? 'detached HEAD' : '—')],
    ['上游分支', status.upstream ?? '—'],
    [
      '领先 / 落后',
      status.upstream ? `${status.ahead ?? 0} / ${status.behind ?? 0}` : '—（没有上游可比）',
    ],
    ['远程地址', status.remoteUrl ?? '—'],
    [
      '最后提交',
      status.lastCommit ? `${status.lastCommit.hash} ${status.lastCommit.subject}` : '—',
    ],
  ]

  return (
    <section>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h2 className="text-[15px] font-semibold text-ink">git 状态</h2>
        <span className="font-mono text-[11.5px] text-ink-3">
          本地状态 · {formatRelative(status.checkedAt)}读取
        </span>
        <span className="font-mono text-[11.5px] text-ink-3">
          远程上次检查 · {lastCheckAt ? `${formatRelative(lastCheckAt)}查的` : '从没查过'}
        </span>
        <Button className="ml-auto" disabled={isFetching} onClick={onRefresh}>
          {isFetching ? '读取中…' : '重新读取'}
        </Button>
      </div>

      <p
        className="mb-2 text-[12.5px] text-ink-2"
        title={statusTitle(status, { checkedAt: hasRemoteCheck ? lastCheckAt : null })}
      >
        {statusTitle(status, { checkedAt: hasRemoteCheck ? lastCheckAt : null })}
      </p>
      <p className="mb-2 text-[12px] text-ink-3">
        「重新读取」只读本地，不会联网。想知道远程有没有新东西，点上面的「检查更新」。
      </p>

      <dl className="grid grid-cols-[7rem_1fr] gap-y-2 border-y border-line-soft py-3 text-[13px]">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-ink-3">{label}</dt>
            <dd className="min-w-0 truncate font-mono text-[12.5px] text-ink">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

function Notes({
  projectId,
  notes,
}: {
  projectId: number
  notes: { id: number; content: string; createdAt: string; updatedAt: string }[]
}) {
  const add = useAddNote()
  const [draft, setDraft] = useState('')

  const submit = () => {
    const content = draft.trim()
    if (!content) return
    add.mutate({ id: projectId, content }, { onSuccess: () => setDraft('') })
  }

  const sorted = orderBy(notes, [(n) => n.createdAt], ['desc'])

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        <Textarea
          rows={2}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="记一句：为什么留着它、卡在哪个 issue、下次要看哪部分"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit()
          }}
        />
        <div className="flex items-center gap-2">
          <Button variant="primary" onClick={submit} disabled={!draft.trim() || add.isPending}>
            加备注
          </Button>
          <span className="text-[12px] text-ink-3">Ctrl + Enter 也可以</span>
        </div>
      </div>

      {sorted.length === 0 ? (
        <p className="text-[13px] text-ink-3">还没有备注。</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {sorted.map((note) => (
            <NoteItem key={note.id} note={note} />
          ))}
        </ul>
      )}
    </div>
  )
}

function NoteItem({ note }: { note: { id: number; content: string; createdAt: string } }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(note.content)
  const update = useUpdateNote()
  const remove = useRemoveNote()

  return (
    <li className="border border-line-soft bg-panel px-3 py-2">
      {editing ? (
        <div className="flex flex-col gap-2">
          <Textarea rows={3} value={value} onChange={(e) => setValue(e.target.value)} />
          <div className="flex gap-2">
            <Button
              variant="primary"
              disabled={!value.trim() || update.isPending}
              onClick={() =>
                update.mutate(
                  { id: note.id, content: value.trim() },
                  { onSuccess: () => setEditing(false) },
                )
              }
            >
              保存
            </Button>
            <Button onClick={() => setEditing(false)}>取消</Button>
          </div>
        </div>
      ) : (
        <>
          <p className="whitespace-pre-wrap text-[13px] text-ink">{note.content}</p>
          <div className="mt-1.5 flex items-center gap-3">
            <span className="font-mono text-[11.5px] text-ink-3">{formatRelative(note.createdAt)}</span>
            <button
              onClick={() => setEditing(true)}
              className="text-[12px] text-ink-2 hover:text-ink"
            >
              改
            </button>
            <button
              onClick={() => remove.mutate(note.id)}
              className="text-[12px] text-ink-2 hover:text-signal-bad"
            >
              删
            </button>
          </div>
        </>
      )}
    </li>
  )
}
