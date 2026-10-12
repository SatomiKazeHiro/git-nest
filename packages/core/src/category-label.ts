/**
 * 分类显示名的规则：**归一化、比较键、保留字、以及撞名时该怎么说**。
 *
 * 它们住在一个模块里，而不是散在三处（core 一个常量、`repos/categories.ts` 一段
 * 查询、路由里两段措辞）。理由和 `VERDICT_LABEL` / `VERDICT_REASON` 住在这里完全
 * 一样：**规则和它的说法是一件事**——改了规则却忘了改措辞，用户看到的就是一句
 * 与事实不符的话。
 *
 * 分工因此变成三层，每层只做一件事：
 * - **core（这里）**：纯函数 + 保留字 + 判定结果的类型 + 措辞；
 * - **server（`repos/categories.ts`）**：`categoryLabelProblem()` 问一次库，回答
 *   「能不能用、跟谁冲突」，**不带措辞**；
 * - **route**：`if (problem) throw conflict(labelProblemMessage(problem))`，一行判断。
 */

/**
 * 不能用作分类显示名的词。
 *
 * 现在只有一个：「未分类」。它是「没有分类」那个哨兵的显示名（web 端
 * `store/ui.ts` 的 `UNCATEGORIZED`）——让它同时成为一个真实分类的名字，左栏就会
 * 出现两行同名、做的事却完全不同（一行筛「没有分类」，一行筛那一类）。
 * web 那边有一条测试钉着这两个词相等，免得将来各改各的漂开。
 *
 * **内置四个的名称不在这里**：它们在 `categories` 表里，会被「与已存在的 label
 * 重名」那一条自然挡住——多一处列举，就多一处将来会忘。
 */
export const RESERVED_CATEGORY_LABELS = ['未分类'] as const

/**
 * 存进库之前用它：**去掉两头空白 + 把内部连续空白压成一个空格**。
 *
 * 用户敲「AI  项目」（中间两个空格）和「AI 项目」时，想说的是同一个分类；不归一的话
 * 库里会出现两条长得几乎一样、却永远分在两处的记录（筛选、分组、排序全按字面值走）。
 * `\s` 在 JS 里连全角空格（U+3000）一起管，所以中文输入法打出来的空格同样被压掉。
 *
 * **只压空白，别的都不做**：不改大小写、不碰中文——存进去的是用户敲的那个意思，
 * 大小写是「比较时才忽略」的事（见 `categoryLabelKey`）。
 */
export function normalizeCategoryLabel(label: string): string {
  return label.trim().replace(/\s+/g, ' ')
}

/**
 * 拿它比较：归一化之后再 `toLowerCase()`。
 *
 * 中文不受大小写影响（对汉字是恒等变换），所以同一条规则对中英文都成立：
 * 「AI 项目」与「ai 项目」是同一个名字，「工具」与「工具」也是。
 */
export function categoryLabelKey(label: string): string {
  return normalizeCategoryLabel(label).toLowerCase()
}

/**
 * 显示名不合法的两种情形。
 *
 * `label` 一律是**冲突的那一方**：保留字就是那个保留字本身，重名就是占了名字的
 * 那条分类的显示名——消息里要点它的名，否则用户在一屏几十个分类里找不到是谁。
 */
export type CategoryLabelProblem =
  | { kind: 'reserved'; label: string }
  | { kind: 'duplicate'; label: string }

/**
 * 撞名时该怎么说。**措辞跟着规则住在这里**（同 `VERDICT_REASON` 的惯例）：
 * 只说「名字重复」等于没说。
 */
export function labelProblemMessage(problem: CategoryLabelProblem): string {
  return problem.kind === 'reserved'
    ? `「${problem.label}」是保留名（它表示「没有分类」），换一个名字`
    : `已经有一个叫「${problem.label}」的分类了`
}
