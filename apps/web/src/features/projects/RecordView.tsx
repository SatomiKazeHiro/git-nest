import type { ReactNode } from 'react'

/**
 * 「记录」：这个项目**唯一**由你写的地方 —— 但这一页只**看**，写是在
 * 「编辑资料」弹窗里（那是它唯一的编辑器，见 ProjectFormDialog）。
 *
 * 渲染在身份信息那个 `<dl>` 里，和 路径 / 分类 / 标签 同一级——它在库里就是
 * `projects` 表上的一列，不该比那几行高一级（曾经是「git 状态」旁边的 `<h2>` 分区，
 * 那是沿用旧「备注」列表的位置，属于没重新想过）。
 *
 * 之前这里直接放了一个带保存按钮的文本框，结果是「记录在外面、别的字段在弹窗里」，
 * 边界说不清（用户原话：「这和顶部的编辑资料不有歧义吗」）。现在这一页只读。
 *
 * 只读就**必须**让链接能点：记录里写的多是「在 B 站看到 → 顺着找到 GitHub」这类句子，
 * 链接不可点等于要手抄。
 *
 * 这里原来挂的是备注列表（N 条、各自时间戳、能逐条改删），那是个「流」，
 * 而人要的是「文档」；摘要与来源链接也一起撤了。
 */
export function RecordView({ record }: { record: string }) {
  if (!record) {
    return (
      <p className="border border-dashed border-line px-3 py-3 text-[12.5px] text-ink-3">
        还没写。在上面「编辑资料」里写一句「怎么找到它的、有什么想法」——这一栏留给你，
        别的字段都是从 git 读来的。
      </p>
    )
  }
  return (
    // 正文尺寸与颜色：这是**你自己写的话**，是这个项目里唯一不是从 git 读来的
    // 内容。原来它是 `text-ink-2` 的灰字、还缩在标签列右边一格宽里，读起来像脚注。
    // 宽度上不再用 max-w-prose 压着——这一栏本来就不宽，压了只剩两三行。
    <p className="whitespace-pre-wrap text-[13px] leading-6 text-ink [overflow-wrap:anywhere]">
      {withLinks(record)}
    </p>
  )
}

/**
 * 把正文里的 http(s) 链接变成可点的 `<a>`。
 *
 * 就一个正则，不引 Markdown 解析器：记录是纯文本，唯一需要特殊对待的就是 URL。
 * 用 `split` 而不是 `replace`——带捕获组时，**奇数位正好是匹配到的 URL 本身**，
 * 不用再判断哪一段是链接。（每次新建正则：`/g` 的正则有 `lastIndex` 状态，
 * 复用会漏匹配。）
 */
function withLinks(text: string): ReactNode[] {
  return text.split(/(https?:\/\/[^\s<>()]+)/g).map((part, i) =>
    i % 2 === 1 ? (
      <a
        key={i}
        href={part}
        target="_blank"
        rel="noreferrer"
        className="break-all text-accent hover:underline"
      >
        {part}
      </a>
    ) : (
      part
    ),
  )
}
