import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { orderBy } from 'es-toolkit'
import { isRemoteCheckStatus, deriveStatus, VERDICT_LABEL, type RepoStatus, type UpdateRecommendation, type UpdateStatus } from '@git-nest/core'
import { Button, ErrorNote, Meta, Textarea } from '@/components/ui'
import { formatRelative } from '@/lib/format'
import { useUiStore } from '@/store/ui'
import { ProjectFormDialog } from '@/features/projects/ProjectFormDialog'
import { useProjectStatus } from '@/features/status/queries'
import { Delta, statusTitle, textFor, toneFor, freshnessOf } from '@/features/status/StatusCell'
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

      <ProjectFormDialog />
    </div>
  )
}

/**
 * 「推不推荐更新」在详情页的样子：判决 + 完整理由。
 *
 * 清单页只有一格宽度，所以那边只给短标签、理由放 title；这里地方够，把话说全——
 * **尤其是 `rewritten` / `unrelated` 这两种「别拉」**，用户需要知道为什么，
 * 否则只会觉得这软件在拦他。
 */
function Recommendation({ recommendation }: { recommendation: UpdateRecommendation | null }) {
  if (!recommendation) {
    return (
      <p className="mt-2 text-[12.5px] text-ink-3">
        还没检查过更新，所以给不出「推不推荐」——作者有没有改写历史，本地是看不出来的。
      </p>
    )
  }
  const bad = recommendation.verdict === 'rewritten' || recommendation.verdict === 'unrelated'
  return (
    <div
      className={`mt-2 border-l-2 pl-3 ${bad ? 'border-signal-bad' : 'border-line-soft'}`}
      data-testid="recommendation"
    >
      <p className={`text-[13px] font-medium ${bad ? 'text-signal-bad' : 'text-ink'}`}>
        推不推荐更新：{VERDICT_LABEL[recommendation.verdict]}
      </p>
      <p className="mt-0.5 max-w-prose text-[12.5px] text-ink-2">{recommendation.reason}</p>
    </div>
  )
}

/**
 * 脏标记在摘要里的短标签与提示。
 *
 * **分开说「你改过的」和「未跟踪的新文件」**——前者更新可能覆盖，后者多半是
 * 构建产物。一律说「有 N 处未提交改动」会让人以为工具在无理由地拦他。
 * （措辞与 core `pull.ts` 的 `describeWorktree` 同一个口径，但那边是给 pull
 * 结果用的整句，这边是摘要里的一小格，所以没有直接共用那个函数。）
 */
function dirtyLabel(s: RepoStatus): string {
  if (s.dirtyTracked > 0 && s.dirtyUntracked > 0) {
    return `${s.dirtyTracked} 个文件被改 · ${s.dirtyUntracked} 个未跟踪`
  }
  if (s.dirtyTracked > 0) return `${s.dirtyTracked} 个文件被改`
  return `${s.dirtyUntracked} 个未跟踪文件`
}

function dirtyHint(s: RepoStatus): string {
  const parts: string[] = []
  if (s.dirtyTracked > 0) {
    parts.push(`${s.dirtyTracked} 个已跟踪文件被改过——更新可能覆盖它们，建议先提交或 stash`)
  }
  if (s.dirtyUntracked > 0) {
    parts.push(`${s.dirtyUntracked} 个未跟踪文件（多半是构建产物、依赖目录这类，更新通常踩不到）`)
  }
  return parts.join('；')
}

/**
 * git 状态摘要。
 *
 * 原来是 6 行仪表盘（状态 / 当前分支 / 上游分支 / 领先落后 / 远程地址 / 最后提交），
 * 但那里面混了三种东西：**这个软件要回答的**（跟远程差多少）、**git 客户端的事**
 * （当前分支）、**别处已经有的**（远程地址在下面的 dl 里就写着）。
 *
 * 收敛成一行：结论 + 上游分支 + 上游最后一次提交时间。
 * 分支名不再显示——设计文档第 1 节写明不做 git 客户端，用户也从没问过自己在哪个分支。
 */
export function StatusPanel({
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

  // 摘要要回答的是「跟远程差多少、该不该拉」，所以**脏标记不当主角**：
  // `deriveStatus` 的优先级会把 dirty 顶到最前面（那对「最紧急的一件事」是对的），
  // 但在这里它只是「拉了会不会踩到你」的一个提醒，降级成旁边一句灰字。
  const verdict = deriveStatus({
    isRepo: status.isRepo,
    dirty: status.dirty,
    detached: status.detached,
    hasCommits: status.status !== 'no_commits',
    upstream: status.upstream !== null,
    ahead: status.ahead,
    behind: status.behind,
    upstreamGone: status.upstreamGone,
    hasRemote: status.remoteUrl !== null,
    skipDirty: true,
  })

  const detailTitle = statusTitle(
    { ...status, status: verdict },
    { checkedAt: hasRemoteCheck ? lastCheckAt : null },
  )

  return (
    <section>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h2 className="text-[15px] font-semibold text-ink">git 状态</h2>
        {hasRemoteCheck ? (
          <Meta
            label="远程检查"
            value={`${formatRelative(lastCheckAt!)}查的`}
            title="最近一次联网 fetch 远程的时间"
          />
        ) : (
          <Meta
            label="远程检查"
            value="没查过"
            placeholder
            title="还没点过「检查更新」，所以下面的远程数字没有联网核实过"
          />
        )}
        <Button className="ml-auto" disabled={isFetching} onClick={onRefresh}>
          {isFetching ? '读取中…' : '重新读取'}
        </Button>
      </div>

      <div
        data-testid="status-summary"
        className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-y border-line-soft py-3"
      >
        <span className={`text-[15px] font-medium ${toneFor(verdict, freshness)}`}>
          {textFor(verdict, freshness)}
        </span>
        {status.behind ? <Delta n={status.behind} dir="behind" /> : null}
        {status.ahead ? <Delta n={status.ahead} dir="ahead" /> : null}
        {status.upstream ? (
          <span className="font-mono text-[12px] text-ink-3">上游 {status.upstream}</span>
        ) : null}
        {status.lastCommit ? (
          <span className="font-mono text-[12px] text-ink-3">
            上游最后提交 {formatRelative(status.lastCommit.date)}
          </span>
        ) : null}
        {status.dirty ? (
          <span
            className="font-mono text-[12px] text-ink-3"
            title={dirtyHint(status)}
          >
            · {dirtyLabel(status)}
          </span>
        ) : null}
      </div>

      {/*
        「推不推荐更新」单独一行——它比上面那串事实更需要被看见，
        而且它的依据（上次检查）和上面那些本地 refs 不是一回事，混在一行会说不清。
      */}
      <Recommendation recommendation={status.recommendation} />

      {/*
        说明行只在**真的有额外信息**时才显示（比如「这是本地看到的，没联网确认」）。
        新鲜度刚查过时 statusTitle 返回的就是上面那行结论本身，再印一遍纯属噪音。
      */}
      {detailTitle === textFor(verdict, freshness) ? null : (
        <p className="mt-2 text-[12.5px] text-ink-2" title={detailTitle}>
          {detailTitle}
        </p>
      )}
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
