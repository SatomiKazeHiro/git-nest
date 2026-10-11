import { Link } from 'react-router'
import { PROJECT_TYPES } from '@git-nest/core'
import folderUrl from '@/assets/folder.svg'
import { ProjectTypeBadge } from '@/features/projects/ProjectTypeBadge'
import { typeIconUrl } from '@/features/projects/typeIcons'

/**
 * 图标预览页（`/preview`）。**开发用**，不是产品功能的一部分：它不读接口、
 * 不碰任何项目，只把 `assets/types/` 里现有的图标按角标的实际规格摆出来。
 *
 * 为什么要它：**12px 是这套图标最严苛的一关**。收来的图标在 200px 下都好看，
 * 缩到 12px 里还剩几个能认出来，只能一张张看。所以每一行给三档：
 * **16px（实际尺寸）· 32px · 48px**，外加**裸图**——白圆会兜住形状，
 * 要看图标本身是不是太细，得看没底的那一张。
 *
 * 还顺手当收集清单用：缺的会标出来（含第一批里还没收集的那几个）。
 */
export function PreviewPage() {
  const groups = [...new Set(PROJECT_TYPES.map((t) => t.group))]
  const withIcon = PROJECT_TYPES.filter((t) => typeIconUrl(t.type) !== null)
  const missingFirstBatch = PROJECT_TYPES.filter(
    (t) => t.firstBatch && typeIconUrl(t.type) === null,
  )
  /** 规格对照拿一个真实存在的图标来演示，没有就整段不显示 */
  const sample = withIcon[0]?.type ?? null
  /** 模拟一行：拿前几个有图标的类型铺一条，看在清单里的样子 */
  const mockRow = withIcon.slice(0, 6)

  return (
    <div className="mx-auto max-w-4xl px-5 py-6">
      <header className="mb-5 border-b border-line-soft pb-4">
        <div className="flex items-baseline gap-3">
          <h1 className="text-[17px] font-semibold text-ink">类型图标预览</h1>
          <Link to="/" className="text-[12.5px] text-accent hover:underline">
            ← 回清单
          </Link>
        </div>
        <p className="mt-1.5 text-[13px] text-ink-2">
          角标规格：<span className="font-mono text-[12px]">16×16 白圆 + 12×12 图标</span>
          ，压在默认文件夹图的右下角（向外出格 1px）。图标取自{' '}
          <span className="font-mono text-[12px]">assets/types/*.svg</span>
          ，文件名大小写与空格都能对上；没有对应文件就不画角标。
        </p>
        <p className="mt-1.5 text-[12.5px] text-ink-3">
          已找到 <span className="font-mono">{withIcon.length}</span> 张（目录里
          {PROJECT_TYPES.length} 个类型位）。
          {missingFirstBatch.length > 0 ? (
            <>
              {' '}
              第一批还缺：
              <span className="text-signal-ahead">
                {missingFirstBatch.map((t) => t.type).join('、')}
              </span>
            </>
          ) : (
            ' 第一批已经齐了。'
          )}
        </p>
      </header>

      {/* ── 规格对照：同一个图标在三档尺寸 + 裸图 ─────────────── */}
      {sample ? (
        <section className="mb-6">
          <h2 className="mb-2 text-[13px] font-semibold text-ink">规格对照</h2>
          <div className="flex flex-wrap items-end gap-6 rounded border border-line-soft bg-panel px-4 py-3">
            {[16, 32, 48].map((size) => (
              <div key={size} className="flex flex-col items-center gap-1.5">
                {/* 角标本身是绝对定位的，所以这里给它一个 48px 的假容器托住 */}
                <span className="relative flex items-center justify-center" style={{ width: 52, height: 52 }}>
                  <ProjectTypeBadge type={sample} size={size} />
                </span>
                <span className="font-mono text-[11.5px] text-ink-3">{size}px</span>
              </div>
            ))}
            <div className="flex flex-col items-center gap-1.5">
              <span className="flex items-center" style={{ height: 52 }}>
                <img src={typeIconUrl(sample) ?? ''} alt="" style={{ width: 32, height: 32 }} />
              </span>
              <span className="font-mono text-[11.5px] text-ink-3">裸图 32px</span>
            </div>
          </div>
        </section>
      ) : null}

      {/* ── 模拟一行：角标贴在文件夹图上的实际样子 ─────────────── */}
      {mockRow.length > 0 ? (
        <section className="mb-6">
          <h2 className="mb-2 text-[13px] font-semibold text-ink">贴在清单里的样子</h2>
          <div className="rounded border border-line-soft bg-panel px-4 py-1">
            {mockRow.map((t) => (
              <div
                key={t.type}
                className="flex items-center gap-2 border-b border-line-soft py-2 last:border-b-0"
              >
                <span className="relative shrink-0">
                  <img src={folderUrl} alt="" aria-hidden width={32} height={32} />
                  <ProjectTypeBadge type={t.type} />
                </span>
                <span className="text-[14px] font-semibold text-ink">{t.label} 项目</span>
                <span className="font-mono text-[12px] text-ink-3">{t.type}</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* ── 逐个类型，按分组 ──────────────────────────────────── */}
      {groups.map((name) => {
        const items = PROJECT_TYPES.filter((t) => t.group === name)
        return (
          <section key={name} className="mb-5">
            <h2 className="mb-2 text-[13px] font-semibold text-ink">
              {name}
              <span className="ml-2 font-mono text-[11.5px] font-normal text-ink-3">
                {items.filter((t) => typeIconUrl(t.type)).length}/{items.length}
              </span>
            </h2>
            <ul className="rounded border border-line-soft">
              {items.map((t) => {
                const url = typeIconUrl(t.type)
                return (
                  <li
                    key={t.type}
                    className="flex items-center gap-4 border-b border-line-soft px-3 py-1.5 last:border-b-0"
                  >
                    {/* 三档尺寸并排 */}
                    <span className="flex w-[150px] shrink-0 items-center gap-3">
                      {url ? (
                        [16, 32, 48].map((size) => (
                          <span
                            key={size}
                            className="relative flex items-center justify-center"
                            style={{ width: 48, height: 48 }}
                          >
                            <ProjectTypeBadge type={t.type} size={size} />
                          </span>
                        ))
                      ) : (
                        <span className="text-[12.5px] text-signal-ahead">缺这张图</span>
                      )}
                    </span>

                    {/* 裸图：白圆会兜住形状，图标本身细不细要看这一张 */}
                    <span className="flex w-[70px] shrink-0 items-center gap-2">
                      {url ? (
                        <>
                          <img src={url} alt="" style={{ width: 24, height: 24 }} />
                          <img src={url} alt="" style={{ width: 12, height: 12 }} />
                        </>
                      ) : null}
                    </span>

                    <span className="w-28 shrink-0 text-[13px] text-ink">{t.label}</span>
                    <span className="w-32 shrink-0 font-mono text-[11.5px] text-ink-3">
                      {t.type}
                    </span>
                    {t.firstBatch ? null : (
                      <span className="text-[11.5px] text-ink-3">（第二批）</span>
                    )}
                  </li>
                )
              })}
            </ul>
          </section>
        )
      })}
    </div>
  )
}
