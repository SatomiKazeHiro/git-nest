import { Dialog } from '@/components/Dialog'
import { useUiStore } from '@/store/ui'
import { CommandsSection } from './CommandsSection'
import { GitSection } from './GitSection'
import { ScanSection } from './ScanSection'
import { SettingGroup } from './SettingRow'
import { TagSection } from './TagSection'

/**
 * 设置。**只有这一个界面**——原来它是一整页（`/settings`），现在是一个弹窗：
 * 在清单页改个数字不该离开你正在看的东西。旧路由已经删掉。
 *
 * 分区**不按代码模块分，按「这个设置能对你机器做什么」分**。原来的四段
 * （扫描 / 批量更新 / 自动 fetch / 标签）是照着组件文件切的，扫一眼看不出
 * 它们之间是什么关系——而真正要紧的关系只有两条：
 *
 * 1. 往清单里加东西：只写本地那个 SQLite 文件，不联网、不碰仓库
 * 2. 联网检查与更新：会 fetch 远程引用；动工作区只在你勾选之后，且只 ff-only
 *
 * 这个分类不是排版需要，它就是那两条约定（绝不自动更新、自动做的事必须留痕）
 * 在界面上的落点。所以第二组给它一道左侧竖线——颜色在这里表示
 * 「这组配错了会动你的文件」。
 */
export function SettingsDialog() {
  const open = useUiStore((s) => s.settingsOpen)
  const closeSettings = useUiStore((s) => s.closeSettings)

  if (!open) return null

  return (
    <Dialog
      title="设置"
      description="存在本机数据库里，不进任何会被提交的文件。改动立刻生效，不用重启服务。"
      size="wide"
      onClose={closeSettings}
    >
      <div className="settings-body">
        <SettingGroup
          title="往清单里加东西"
          note="只写本机的清单，不联网、不读仓库内容。扫出来的东西还要你挑一遍才会进清单。"
        >
          <ScanSection />
          <TagSection />
        </SettingGroup>

        {/*
          这一组是**唯一会让全部仓库联网、且在你勾选之后会动工作区**的。
          那条边界写在这一组的说明里，因为它横跨下面每一行——单拎到某一行
          下面反而会被读成「只对这一项成立」。
        */}
        <SettingGroup
          title="联网检查与更新"
          note="这一组会让全部仓库联网。只 fetch 远程引用，绝不碰工作区——更新永远由你勾选后触发，并且只做 fast-forward。"
        >
          <GitSection />
          <CommandsSection />
        </SettingGroup>
      </div>
    </Dialog>
  )
}
