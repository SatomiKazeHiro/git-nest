import { useEffect, useState } from 'react'
import { createProjectSchema, categorySuggestions } from '@git-nest/core'
import { ApiError } from '@/lib/api'
import { Button, Dialog, ErrorNote, Field, Input, Textarea } from '@/components/ui'
import { TagPicker } from './TagPicker'
import {
  useCreateProject,
  useProject,
  useSetProjectTags,
  useTags,
  useUpdateProject,
} from './queries'
import { useUiStore } from '@/store/ui'

interface FormState {
  name: string
  path: string
  category: string
  remoteUrl: string
  sourceUrl: string
  summary: string
}

const blank: FormState = {
  name: '',
  path: '',
  category: '',
  remoteUrl: '',
  sourceUrl: '',
  summary: '',
}

function issuesToMap(issues: { path: (string | number | symbol)[]; message: string }[]) {
  const map: Record<string, string> = {}
  for (const i of issues) {
    const key = i.path.map(String).join('.') || '(root)'
    if (!(key in map)) map[key] = i.message
  }
  return map
}

export function ProjectFormDialog() {
  const { formOpen, editingId, closeForm } = useUiStore()

  const { data: tags = [] } = useTags()
  const { data: editing } = useProject(formOpen ? editingId : null)
  const create = useCreateProject()
  const update = useUpdateProject()
  const setTags = useSetProjectTags()

  const [form, setForm] = useState<FormState>(blank)
  const [tagNames, setTagNames] = useState<string[]>([])
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [banner, setBanner] = useState<string | null>(null)

  useEffect(() => {
    if (!formOpen) return
    setErrors({})
    setBanner(null)
    if (editingId && editing) {
      setForm({
        name: editing.name,
        path: editing.path,
        category: editing.category,
        remoteUrl: editing.remoteUrl ?? '',
        sourceUrl: editing.sourceUrl ?? '',
        summary: editing.summary ?? '',
      })
      setTagNames(editing.tags.map((t) => t.name))
    } else {
      setForm(blank)
      setTagNames([])
    }
  }, [formOpen, editingId, editing])

  if (!formOpen) return null

  const set = (key: keyof FormState) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }))

  const submit = () => {
    const parsed = createProjectSchema.safeParse({
      name: form.name,
      path: form.path,
      category: form.category,
      remoteUrl: form.remoteUrl,
      sourceUrl: form.sourceUrl,
      summary: form.summary,
    })
    if (!parsed.success) {
      setErrors(issuesToMap(parsed.error.issues))
      return
    }
    setErrors({})

    const payload = {
      name: parsed.data.name,
      category: parsed.data.category,
      remoteUrl: parsed.data.remoteUrl,
      sourceUrl: parsed.data.sourceUrl,
      summary: parsed.data.summary,
    }

    if (editingId) {
      update.mutate(
        { id: editingId, patch: { ...payload, path: parsed.data.path } },
        {
          onSuccess: () => {
            if (tagNames.join() !== editing?.tags.map((t) => t.name).join()) {
              setTags.mutate({ id: editingId, tagNames })
            }
            closeForm()
          },
          onError: (e) => setBanner(e instanceof ApiError ? e.message : '保存失败'),
        },
      )
      return
    }

    create.mutate(
      { ...payload, path: parsed.data.path },
      {
        onSuccess: ({ project }) => {
          if (tagNames.length > 0) setTags.mutate({ id: project.id, tagNames })
          closeForm()
        },
        onError: (e) => {
          if (e instanceof ApiError && e.issues.length === 0) {
            setErrors({ path: e.message })
          } else if (e instanceof ApiError) {
            setBanner(e.message)
          }
        },
      },
    )
  }

  const busy = create.isPending || update.isPending

  return (
    <Dialog
      title={editingId ? '编辑项目' : '添加项目'}
      description={
        editingId
          ? '路径就是仓库在本机的位置；仓库搬走了就改这里'
          : '把已经在本机的仓库加进清单'
      }
      onClose={closeForm}
    >
      <form
        className="flex flex-col gap-3.5"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        {banner ? <ErrorNote message={banner} /> : null}

        <Field label="名称" error={errors['name']}>
          {(id) => (
            <Input
              id={id}
              value={form.name}
              onChange={set('name')}
              placeholder="canvas-editor"
              autoComplete="off"
            />
          )}
        </Field>

        <Field
          label="本地路径"
          error={errors['path']}
          hint={
            editingId
              ? '仓库被移动或改名了就改这里，指到新位置'
              : '目录必须已存在。正斜杠即可，例如 D:/Git/canvas-editor'
          }
        >
          {(id) => (
            <Input
              id={id}
              value={form.path}
              onChange={set('path')}
              placeholder="D:/Git/canvas-editor"
            />
          )}
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="分类" error={errors['category']} hint="自由填写">
            {(id) => (
              <>
                <Input id={id} value={form.category} onChange={set('category')} list="categories" />
                <datalist id="categories">
                  {categorySuggestions.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </>
            )}
          </Field>
          <Field label="来源链接" error={errors['sourceUrl']} hint="B 站视频、博客都行">
            {(id) => <Input id={id} value={form.sourceUrl} onChange={set('sourceUrl')} />}
          </Field>
        </div>

        <Field label="摘要" error={errors['summary']} hint="一句话说清它是干什么的">
          {(id) => <Textarea id={id} rows={3} value={form.summary} onChange={set('summary')} />}
        </Field>

        <Field label="标签">
          {() => <TagPicker tags={tags} value={tagNames} onChange={setTagNames} />}
        </Field>

        <div className="mt-1 flex justify-end gap-2 border-t border-line-soft pt-3">
          <Button type="button" onClick={closeForm}>
            取消
          </Button>
          <Button type="submit" variant="primary" disabled={busy}>
            {editingId ? '保存改动' : '加入清单'}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
