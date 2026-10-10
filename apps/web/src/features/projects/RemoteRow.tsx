/**
 * 远程那一行：**能点开才占一行，否则整行不出**。
 *
 * - `https://…` 的 remote 是网页地址 → 一行链接，点了去仓库页面。
 * - `git@github.com:owner/repo.git` 这种 SSH 形式**不是 URL**：浏览器当相对路径，
 *   拼成 `http://localhost:5174/projects/git@github.com:…`，点一下跳进本应用里一个
 *   不存在的地址（用户报过的 bug）。它也不能点开任何网页 → **不占这一行**。
 *   （用户的要求：给不出真的就别占位，「信息少了总比垃圾信息好」。）
 * - 没有 remote → 也不占行：「git 状态」那边会写「这个仓库没有配置 origin」。
 *
 * 没做「从 SSH 推算出 `https://host/owner/repo`」：自建 host、非标准端口、嵌套路径
 * 都推不准，猜出来的链接比没有链接更坏。
 */
export function RemoteRow({ url }: { url: string | null }) {
  if (!url || !isWebUrl(url)) return null
  return (
    <div className="flex items-baseline gap-2">
      <span className="shrink-0 text-[11px] text-ink-3">远程</span>
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="min-w-0 font-mono text-[12px] text-accent hover:underline [overflow-wrap:anywhere]"
      >
        {url}
      </a>
    </div>
  )
}

/** http(s) 才算网页地址；其余（SSH / file / 本地路径）一律不给链接 */
function isWebUrl(url: string): boolean {
  return /^https?:\/\//i.test(url)
}
