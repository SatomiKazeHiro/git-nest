import { Dialog } from '@/components/Dialog'
import { useUiStore } from '@/store/ui'
import { ScanSection } from './ScanSection'

/**
 * 扫描目录：**它自己的弹窗**，不再是设置里的一段。
 *
 * 为什么搬出来：扫描是**动作**（扫一次 → 挑一批 → 入库），设置是**配置**。
 * 放在一起有两个具体后果：
 * 1. 想扫一次得先进设置——两步，而它是清单页上最常用的入口之一；
 * 2. 设置那一页的分组是按「这个设置能对你机器做什么」分的，而扫描不是设置项，
 *    它挤在那组里，那组的说明就得替它多解释一句。
 *
 * 它仍然和设置共用同一份接口：扫描要读写「常用目录」(`scanDirs`)，而那是扫描
 * 自己的配置（理由写在 `ScanSection` 的导入注释里）。
 */
export function ScanDialog() {
  const open = useUiStore((s) => s.scanOpen)
  const closeScan = useUiStore((s) => s.closeScan)

  if (!open) return null

  return (
    <Dialog
      title="扫描目录"
      description="扫本机某个目录下的 git 仓库，挑一批加进清单。扫描只读：不写库、不联网、不动任何仓库。"
      size="wide"
      onClose={closeScan}
    >
      <div className="dialog-rows">
        <ScanSection />
      </div>
    </Dialog>
  )
}
