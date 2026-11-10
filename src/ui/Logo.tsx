export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <path d="M32 3 38 19H26Z" fill="#2d6fa6" />
      <path d="M11 33 1 27l3 9-4 7 12-1Z" fill="#f59a3d" />
      <path d="m53 33 10-6-3 9 4 7-12-1Z" fill="#f59a3d" />
      <ellipse cx="32" cy="37" rx="22" ry="19" fill="#62bff0" />
      <ellipse cx="32" cy="48" rx="14" ry="7" fill="#e8f6fd" />
      <circle cx="23" cy="34" r="3.6" fill="#10283d" />
      <circle cx="41" cy="34" r="3.6" fill="#10283d" />
      <circle cx="24" cy="33" r="1.2" fill="#fff" />
      <circle cx="42" cy="33" r="1.2" fill="#fff" />
      <path d="M27 45q5 4 10 0" stroke="#10283d" strokeWidth="2" fill="none" strokeLinecap="round" />
    </svg>
  )
}

export function Wordmark() {
  return (
    <span className="flex items-center gap-2 text-lg font-bold tracking-tight">
      <Logo />
      <span>da<span className="text-brand">mudkip</span>spot</span>
    </span>
  )
}
