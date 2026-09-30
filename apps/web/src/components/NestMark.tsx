/** 侧栏顶部的标记：一小段提交图，作为整个应用的视觉签名 */
export function NestMark({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      className="shrink-0 text-accent"
    >
      <path
        d="M4 3v14"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <path
        d="M4 7h5.5a3 3 0 0 1 3 3v0"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <circle cx="4" cy="3" r="2" fill="currentColor" />
      <circle cx="4" cy="17" r="2" fill="currentColor" />
      <circle cx="14.5" cy="10" r="2" fill="currentColor" />
    </svg>
  )
}
