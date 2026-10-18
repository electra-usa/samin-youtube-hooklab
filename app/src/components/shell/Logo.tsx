import { APP_NAME } from "@/lib/brand";

// Original mark for the rebuild: a fishing hook inside a rounded blue tile.
export function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" role="img" aria-label={APP_NAME}>
      <rect width="32" height="32" rx="9" fill="#4F9DD1" />
      <path
        d="M19.5 7.5v10.25a4.75 4.75 0 0 1-9.5 0V15"
        fill="none"
        stroke="#fff"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <path d="M10 15l-2.5 2.6" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
      <circle cx="19.5" cy="6.6" r="1.9" fill="#B7FDA0" />
    </svg>
  );
}

export function Logo({ collapsed = false }: { collapsed?: boolean }) {
  return (
    <span className="flex items-center gap-2">
      <LogoMark />
      {!collapsed && <span className="text-[17px] font-bold tracking-tight text-dark dark:text-white">{APP_NAME}</span>}
    </span>
  );
}
