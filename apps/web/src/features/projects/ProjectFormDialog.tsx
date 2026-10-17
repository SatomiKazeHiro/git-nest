import { useEffect, useRef, useState } from 'react'
import { Check, Plus, X } from 'lucide-react'
import { createProjectSchema } from '@git-nest/core'
import { useCategories } from '@/features/categories/queries'
import { categoryIcon } from '@/features/categories/icons'
import { categoryLabelOf } from '@/features/categories/label'
import { ApiError } from '@/lib/api'
import { Button, ErrorNote, Field, Input } from '@/components/ui'
import { PathField } from '@/components/PathField'
import { Dialog } from '@/components/Dialog'
import { Select } from '@/components/Select'
import { RecordEditor } from './RecordEditor'
import { TagPicker } from './TagPicker'
import { useCreateProject, useProject, useSetProjectTags, useUpdateProject } from './queries'
// 标签是独立资源：选标签这个动作读的是 tags feature 的接口，不是项目自己的
import { useTags } from '@/features/tags/queries'
import { UNCATEGORIZED, useUiStore } from '@/store/ui'

interface FormState {
  name: string
  path: string
  isOwn: boolean
  category: string
  remoteUrl: string
  record: string
}

const blank: FormState = {
  name: '',
  path: '',
  isOwn: false,
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
  // 可选的分类：内置四个 + 用户自己加的（接口没回来时退回内置四个）
  const categories = useCategories()

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
        isOwn: editing.isOwn,
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
      isOwn: form.isOwn,
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
      isOwn: parsed.data.isOwn,
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
      /*
        底部按钮从 `<form>` 里搬到弹窗的固定带子上：长表单滚下去时
        「保存改动」还在原处。回车提交不受影响——`<form onSubmit>` 还包着那些字段。
      */
      footer={
        <div className="flex justify-end gap-2">
          <Button onClick={closeForm}>
            <X size={14} aria-hidden />
            取消
          </Button>
          <Button variant="primary" disabled={busy} onClick={submit}>
            {editingId ? <Check size={14} aria-hidden /> : <Plus size={14} aria-hidden />}
            {editingId ? '保存改动' : '添加'}
          </Button>
        </div>
      }
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
            /*
              手输 + 「选择目录…」。**后者只在桌面壳里画**（浏览器里没有系统目录
              选择框，判定与错误处理都在 `lib/platform.ts` 那一处）。
              不这么做的话，两个环境各写一遍 `if (__TAURI__)`，总有一天漏一处。
            */
            <PathField
              id={id}
              value={form.path}
              onChange={(v) => setForm((f) => ({ ...f, path: v }))}
              placeholder="D:/Git/canvas-editor"
              pickTitle="选一个仓库目录"
            />
          )}
        </Field>

        {/*
          这是整个「自己的项目」机制的唯一入口。放在分类**之前**是因为它更重要：
          分类只是分组标签，错了不影响任何行为；这个勾错了，批量检查会漏掉
          （或多跑）你真正在意的仓库。
        */}
        <Field
          label="这是我自己写的项目"
          hint="批量检查默认跳过它们（自己的项目自己清楚）。要在批量里带上，去设置里打开「自己的项目也参与检查」。"
        >
          {(id) => (
            <label className="flex cursor-pointer items-center gap-2">
              <input
                id={id}
                type="checkbox"
                checked={form.isOwn}
                onChange={(e) => setForm((f) => ({ ...f, isOwn: e.target.checked }))}
                className="list-check"
              />
              <span className="text-[13px] text-ink">是我的项目</span>
            </label>
          )}
        </Field>

        {/*
          ## 为什么是**下拉**，不是原来那一排 chip，也不是更早的文本框

          曾经这里是文本框 + datalist：那条路留着「随时可以打一个不在表里的值」，于是
          `backup` / `backups`、`试验` / `experiments` 这类近似重复防不住——分组时
          看着像多了一个组。**这一条现在仍然成立**，所以它不回到文本框。

          收成单选之后先做的是**开关**（点亮的 chip，再点一下取消）。那一版错在把
          「分类已经变成一份**用户可以自己加的名单**」当成了固定的枚举：分类多起来
          之后，chip 那一排既占宽度又占高度——每加一个分类，弹窗就多一格、多绕一行。
          而「从一份名单里选一个」这件事，下拉说得比一排 chip 更直接。

          用的是 `components/Select.tsx`（触发控件 + 浮层），不是原生 `<select>`：
          **分类是有图标的**（左栏和详情页都画），而原生 `<option>` 里画不了图标。
          代价在那边文件头写着——原生菜单白送的那些能力（输入法首字母跳转、手机上的
          系统滚轮）这里没有，换来的是图标、清空和统一的主题样式。

          **「未分类」＝「没有分类」这条语义没变**，它没有变成名单里的第 N 个分类：
          `Select` 的**空值就是空串**（库里存的就是空串，不是「未分类」这三个字），
          那一格由触发控件上的 `placeholder` 承担，而 × 是「回到未分类」那个动作。
          编辑一个未分类的项目时，控件上明写着「未分类」，不是靠「一个都没点亮」去猜。
        */}
        <Field
          label="分类"
          error={errors['category']}
          hint={`只用来分组与筛选。用右边的 × 或选「${UNCATEGORIZED}」回到没有分类（新项目默认就是它）。是不是你自己写的，在上面那个勾选框里选。`}
        >
          {(id) => (
            <Select
              id={id}
              aria-label="分类"
              className="w-56"
              /* 空串就是「未分类」，所以清空与选「未分类」是同一个结果 */
              value={form.category}
              onChange={(v) => setForm((f) => ({ ...f, category: v }))}
              clearable
              placeholder={UNCATEGORIZED}
              options={[
                /*
                  「未分类」是**一个显式选项**，不是「什么都不显示」：对分类来说
                  「没有分类」是一个合法状态，用户要能主动选回它。
                */
                { value: '', label: UNCATEGORIZED },
                /*
                  清单里存着一个现在名单里没有的 key（分类被删了）时，把它自己摆出来：
                  否则控件上显示的是占位（看着像「这个项目没有分类」，而其实它有一个
                  陈旧的值）。标签原样返回 key——编一个「未知分类」只会让人以为是自己
                  填错了。它是**只读的现状**，不是给别人选的项：用户一选别的，它就不在
                  这份名单里了。

                  判空那一半也是必须的：空值由上面那一项承担，这里再给空值画一项的话，
                  浮层里会出现两枚「未分类」，其中一枚还不是空的（上一版原生下拉里
                  就是这个症状：一个没有文字的重复项）。
                */
                ...(form.category && !categories.some((c) => c.key === form.category)
                  ? [{ value: form.category, label: categoryLabelOf(categories, form.category) }]
                  : []),
                ...categories.map((c) => {
                  const Icon = categoryIcon(c.icon)
                  return {
                    value: c.key,
                    label: c.label,
                    /* 认不出图标就什么都不画，不塞占位图（那会让人以为它本来就有图标） */
                    icon: Icon ? <Icon size={14} aria-hidden /> : undefined,
                  }
                }),
              ]}
            />
          )}
        </Field>

        {/* 记录就在这个弹窗里改 —— **这是它唯一的编辑器**（详情页那一侧只读），
            所以不存在「一半在外面、一半在里面」那种边界说不清的情况。

            「编辑 / 预览」的切换与预览本身住在 `RecordEditor` 里：那是这一格的
            **本地视图状态**，与这个表单的提交无关。提交出去的仍然是 textarea 里那串
            Markdown **原文**（不是预览渲染出来的 HTML），一个字没变。
            预览与详情页那条只读记录共用同一个渲染器（`features/readme/MarkdownBody`），
            所以「写的时候看到的」与「保存后看到的」是同一套解释。 */}
        <Field
          label="记录"
          error={errors['record']}
          hint="怎么找到这个项目的、有什么想法。链接直接写在句子里；按 Markdown 写，可以切到「预览」看一眼。"
        >
          {(id) => (
            <RecordEditor
              id={id}
              value={form.record}
              onChange={(v) => setForm((f) => ({ ...f, record: v }))}
            />
          )}
        </Field>

        {/* 标签也只有一个编辑器，就是这个字段。id 传下去，label 才真的关联到输入框。 */}
        <Field label="标签" hint="标签只在这里改">
          {(id) => <TagPicker id={id} tags={tags} value={tagNames} onChange={setTagNames} />}
        </Field>
      </form>
    </Dialog>
  )
}
