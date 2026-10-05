import { useEffect, useRef, useState } from 'react'
import { Check, Plus, X } from 'lucide-react'
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
  record: string
}

const blank: FormState = {
  name: '',
  path: '',
  category: '',
  remoteUrl: '',
  record: '',
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
  // 逐个字段订阅：整店订阅会让这个弹窗在「勾选行」「改筛选」时也跟着重渲染
  const formOpen = useUiStore((s) => s.formOpen)
  const editingId = useUiStore((s) => s.editingId)
  const closeForm = useUiStore((s) => s.closeForm)

  const { data: tags = [] } = useTags()
  const { data: editing } = useProject(formOpen ? editingId : null)
  const create = useCreateProject()
  const update = useUpdateProject()
  const setTags = useSetProjectTags()

  const [form, setForm] = useState<FormState>(blank)
  const [tagNames, setTagNames] = useState<string[]>([])
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [banner, setBanner] = useState<string | null>(null)

  /*
    表单只在**打开的那一刻**灌一次。
    依赖里**不能**放 `editing` 整个对象当触发条件：它是 query 的 data，每次重新取数
    都是新引用，于是用户敲了一半的表单会被服务端旧值整体覆盖
    （详情那条失效一旦修好，重取会变频繁，这个雷会立刻发作）。
    这里用 `loadedFor` 记住「本轮已经灌给谁了」：同一次打开期间后台刷新不碰输入，
    关掉再开（或换一个项目）才重新灌。
  */
  const loadedFor = useRef<string | null>(null)
  useEffect(() => {
    if (!formOpen) {
      loadedFor.current = null
      return
    }
    const target = editingId === null ? 'new' : `edit:${editingId}`
    if (loadedFor.current === target) return
    // 要编辑但详情还没读回来：先不灌，等 data 到了这次 effect 会再跑一遍
    if (editingId !== null && !editing) return

    loadedFor.current = target
    setErrors({})
    setBanner(null)
    if (editing) {
      setForm({
        name: editing.name,
        path: editing.path,
        category: editing.category,
        remoteUrl: editing.remoteUrl ?? '',
        record: editing.record,
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
      record: form.record,
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
      record: parsed.data.record,
    }

    if (editingId) {
      update.mutate(
        { id: editingId, patch: { ...payload, path: parsed.data.path } },
        {
          onSuccess: () => {
            const tagsChanged = tagNames.join() !== editing?.tags.map((t) => t.name).join()
            if (tagsChanged) {
              // 标签失败**不能**一声不响：项目本体已经存下去了，这里再默默失败
              // 就是「界面说保存成功、其实标签没存」。所以失败时不关弹窗，报出来。
              setTags.mutate(
                { id: editingId, tagNames },
                {
                  onSuccess: closeForm,
                  onError: (e) =>
                    setBanner(
                      e instanceof ApiError
                        ? `资料已保存，但标签没存上：${e.message}`
                        : '资料已保存，但标签没存上',
                    ),
                },
              )
              return
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
          if (tagNames.length > 0) {
            setTags.mutate(
              { id: project.id, tagNames },
              {
                onSuccess: closeForm,
                onError: (e) =>
                  setBanner(
                    e instanceof ApiError
                      ? `项目已添加，但标签没存上：${e.message}`
                      : '项目已添加，但标签没存上',
                  ),
              },
            )
            return
          }
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

  const busy = create.isPending || update.isPending || setTags.isPending

  return (
    <Dialog
      title={editingId ? '编辑资料' : '添加项目'}
      description={
        editingId
          ? '路径就是仓库在本机的位置；标签和摘要也只在这里改'
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

        {/* 记录就在这个弹窗里改 —— **这是它唯一的编辑器**。
            详情页那个「记录」是只读展示（链接可点），所以不存在
            「一半在外面、一半在里面」那种边界说不清的情况。 */}
        <Field
          label="记录"
          error={errors['record']}
          hint="怎么找到这个项目的、有什么想法。链接直接写在句子里。"
        >
          {(id) => <Textarea id={id} rows={8} value={form.record} onChange={set('record')} />}
        </Field>

        {/* 标签也只有一个编辑器，就是这个字段。 */}
        <Field label="标签" hint="标签只在这里改">
          {() => <TagPicker tags={tags} value={tagNames} onChange={setTagNames} />}
        </Field>

        <div className="mt-1 flex justify-end gap-2 border-t border-line-soft pt-3">
          <Button type="button" onClick={closeForm}>
            <X size={14} aria-hidden />
            取消
          </Button>
          <Button type="submit" variant="primary" disabled={busy}>
            {editingId ? <Check size={14} aria-hidden /> : <Plus size={14} aria-hidden />}
            {editingId ? '保存改动' : '添加'}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
