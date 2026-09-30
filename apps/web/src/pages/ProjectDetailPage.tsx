import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { orderBy } from 'es-toolkit'
import { Button, ErrorNote, Textarea } from '@/components/ui'
import { formatRelative } from '@/lib/format'
import { useUiStore } from '@/store/ui'
import { ProjectFormDialog } from '@/features/projects/ProjectFormDialog'
import { GitGraph } from '@/features/gitgraph/GitGraph'
import { useProjectStatus } from '@/features/status/queries'
import { statusText, statusTitle } from '@/features/status/StatusCell'
import {
  useAddNote,
  useProject,
  useRemoveNote,
  useUpdateNote,
} from '@/features/projects/queries'

export function ProjectDetailPage() {
  const { id } = useParams()
  const projectId = Number(id)
  const openEdit = useUiStore((s) => s.openEdit)
  const { data: project, isPending, error } = useProject(Number.isFinite(projectId) ? projectId : null)

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
      <div>
        <Link to="/" className="font-mono text-[12px] text-ink-3 hover:text-accent hover:underline">
          ← 清单
        </Link>
        <div className="mt-1.5 flex items-start gap-3">
          <h1 className="text-[22px] font-semibold leading-tight text-ink">{project.name}</h1>
          <Button onClick={() => openEdit(project.id)}>编辑</Button>
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
        <dd className="flex flex-wrap gap-1">
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

      <StatusPanel projectId={project.id} />

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
        <h2 className="text-[13px] font-semibold text-ink">检查更新</h2>
        <p className="mt-1 text-[13px] text-ink-2">
          批量 fetch + 勾选后 ff-only 更新在 M3 接上。现在只能看状态。
        </p>
      </section>

      <ProjectFormDialog />
    </div>
  )
}

/** git 状态面板：分支、上下游、最后提交。刷新按钮强制绕开短缓存。 */
function StatusPanel({ projectId }: { projectId: number }) {
  const [fresh, setFresh] = useState(false)
  const { data: status, isFetching, refetch } = useProjectStatus(projectId, { fresh })

  if (!status) {
    return <p className="font-mono text-[12px] text-ink-3">正在读 git 状态…</p>
  }

  const rows: [string, string][] = [
    ['状态', statusText(status.status)],
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
      <div className="mb-2 flex items-center gap-2">
        <h2 className="text-[15px] font-semibold text-ink">git 状态</h2>
        <span className="font-mono text-[11.5px] text-ink-3">{formatRelative(status.checkedAt)}查的</span>
        <Button
          className="ml-auto"
          disabled={isFetching}
          onClick={() => {
            setFresh(true)
            void refetch().finally(() => setFresh(false))
          }}
        >
          {isFetching ? '刷新中…' : '重新读取'}
        </Button>
      </div>

      <p className="mb-2 text-[12.5px] text-ink-2" title={statusTitle(status)}>
        {statusTitle(status)}
        {status.upstream && (status.ahead || status.behind)
          ? '（基于上次 fetch 的结果，刷新不会联网）'
          : ''}
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
