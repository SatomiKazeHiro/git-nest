import { useState } from 'react'
import { FolderSearch, Loader, Trash2, X } from 'lucide-react'
import { ApiError } from '@/lib/api'
import { Button, ErrorNote, Input } from '@/components/ui'
import { Dialog } from '@/components/Dialog'
import { SettingRow } from './SettingRow'
import { useSaveSettings, useSettings } from './queries'
import { useRemoveProject } from '@/features/projects/queries'
import { ScanResults } from './ScanResults'
import { useScan, type ScanResponse, type ScannedRepoWithProject } from './scanQueries'

/**
 * 扫描目录 → 勾选 → 入库。
 *
 * 扫描是只读的：它不写库、不动仓库。入库也是一条条 insert，
 * 名字取目录名、远程地址从 git 读，其余元数据留给用户补。
 *
 * 这一层只管**怎么扫**：目录、层数、常用目录、以及移除之后要重扫一遍。
 * 「扫出来之后怎么选、怎么导」在 `ScanResults`——那份 state 只对某一次结果有意义。
 */
export function ScanSection() {
  const { data: settings } = useSettings()
  const saveSettings = useSaveSettings()
  const scan = useScan()
  const [dir, setDir] = useState('')
  const [depth, setDepth] = useState(1)
  const [result, setResult] = useState<ScanResponse | null>(null)
  const [banner, setBanner] = useState<string | null>(null)
  const [removing, setRemoving] = useState<ScannedRepoWithProject | null>(null)
  /*
    每扫成功一次就 +1，用它当 `ScanResults` 的 key：**换一次结果就是换一个组件实例**，
    勾选与「已确认」跟着一起清掉。放在这里而不是让结果组件自己比较 props，
    是因为「两次扫描之间没有关系」这件事只有发起扫描的人知道。
  */
  const [scanSeq, setScanSeq] = useState(0)
  const removeProject = useRemoveProject()

  const forgetDir = (target: string) => {
    const next = (settings?.scanDirs ?? []).filter((d) => d !== target)
    saveSettings.mutate(
      { scanDirs: next },
      { onError: (e) => setBanner(e instanceof ApiError ? e.message : '取消失败') },
    )
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
          // 新扫出来、还没在清单里的默认不勾：导入这种事宁少勿多（状态在 ScanResults 里，
          // 这里换 key 就等于把它清空）
          setScanSeq((n) => n + 1)
        },
        onError: (e) => {
          setResult(null)
          setBanner(e instanceof ApiError ? e.message : '扫描失败')
        },
      },
    )
  }

  return (
    <>
      <SettingRow
        name="目录"
        desc="填一个已存在的本机目录"
        note="扫描只读，不写清单也不动磁盘"
      >
        <div className="flex items-center gap-2">
          <Input
            value={dir}
            onChange={(e) => setDir(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && runScan(dir, true)}
            placeholder="D:/Git"
            aria-label="要扫描的目录"
            className="!w-44"
          />
          {/*
            `shrink-0` 不能省。上一版把它和输入框放进同一个 flex 行却没防压缩，
            控件列一窄按钮就被挤到 70px 宽，「扫描」两个字竖着排成两行——
            一个标准化的尺寸配上被压扁的控件，比原来更扎眼。
          */}
          <Button
            className="shrink-0"
            onClick={() => runScan(dir, true)}
            disabled={!dir.trim() || scan.isPending}
          >
            {scan.isPending ? (
              <Loader size={14} aria-hidden className="animate-spin" />
            ) : (
              <FolderSearch size={14} aria-hidden />
            )}
            {scan.isPending ? '扫描中…' : '扫描'}
          </Button>
        </div>
      </SettingRow>

      <SettingRow name="往下扫几层" desc="只扫子目录" note="1 = 只看直接子目录，层数越多越慢">
        <Input
          type="number"
          min={1}
          max={3}
          value={depth}
          onChange={(e) => setDepth(Math.min(Math.max(Number(e.target.value) || 1, 1), 3))}
          aria-label="往下扫几层"
          className="!w-24"
        />
      </SettingRow>

      {/* 常用目录也是一行：左边说这是什么，右边是那一串可点的目录 */}
      {settings && settings.scanDirs.length > 0 ? (
        <SettingRow name="常用目录" desc="点一下直接扫这个目录">
          <ul className="flex flex-wrap justify-center gap-1.5">
            {settings.scanDirs.map((d) => (
              <li key={d} className="flex items-center rounded-[3px] border border-line bg-panel">
                <button
                  onClick={() => {
                    setDir(d)
                    runScan(d, true)
                  }}
                  className="cursor-pointer px-1.5 py-0.5 font-mono text-[11.5px] text-ink-2 hover:text-ink"
                >
                  {d}
                </button>
                <button
                  onClick={() => forgetDir(d)}
                  aria-label={`不再记住 ${d}`}
                  title="不再记住这个目录"
                  className="inline-flex cursor-pointer items-center border-l border-line px-1 py-0.5 text-ink-3 hover:bg-panel hover:text-signal-bad"
                >
                  <X size={11} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </SettingRow>
      ) : null}

      {banner ? (
        <div className="mt-3">
          <ErrorNote message={banner} />
        </div>
      ) : null}

      {result ? (
        <ScanResults
          key={scanSeq}
          result={result}
          confirmThreshold={settings?.confirmThreshold ?? 20}
          onNotice={setBanner}
          onRemove={setRemoving}
        />
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
    </>
  )
}

/** 扫描区里也能「移除管理」——只删记录，不动磁盘。 */
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
  // 用统一的 Dialog：自制的那版没有 Escape、没有初始焦点、也不圈焦点
  //（键盘用户 Tab 一下就跑到底下的清单里去了）
  return (
    <Dialog
      title={`把 ${repo.name} 移出清单？`}
      onClose={onClose}
      cancel={{ text: '留下' }}
      confirm={{
        text: '移出清单',
        icon: <Trash2 size={14} aria-hidden />,
        variant: 'danger',
        loading: busy,
        onClick: onConfirm,
      }}
    >
      <p className="text-[13px] text-ink-2">
        只删掉清单里这一条。磁盘上的{' '}
        <span className="font-mono text-[12px]">{repo.dir}</span> 和它的 git 历史都不动，
        你写的那段记录与标签关联会一起清掉。
      </p>
    </Dialog>
  )
}
