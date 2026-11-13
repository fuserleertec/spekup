export const paths: Record<string, string> = {
  heart: "M12 21s-8-5-8-11a5 5 0 019-3 5 5 0 019 3c0 6-8 11-10 11z",
  chat: "M4 5h16v11H8l-4 4z",
  share: "M4 12v7h16v-7M12 3v12M7 8l5-5 5 5",
  saved: "M6 3h12v18l-6-4-6 4z",
  check: "M5 13l4 4L19 7",
};

export function Icon({ n, c = "w-5 h-5", fill = false }: { n: string; c?: string; fill?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className={c} fill={fill ? "currentColor" : "none"} stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={paths[n]} />
    </svg>
  );
}

export function Mark({ c = "h-9 w-9" }: { c?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={c} aria-hidden>
      <rect width="64" height="64" rx="15" fill="#1F362E" />
      <path d="M29 45.5L21.5 53L20 45.5Z" fill="#E9EFE8" stroke="#E9EFE8" strokeWidth="3" strokeLinejoin="round" />
      <path d="M29 45.5H23A10 10 0 0 1 13 35.5V22A10 10 0 0 1 23 12H41A10 10 0 0 1 51 22V23" fill="none" stroke="#E9EFE8" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M29 45.5H41A10 10 0 0 0 51 35.5V34" fill="none" stroke="#B5A273" strokeWidth="6" strokeLinecap="butt" strokeLinejoin="round" />
      <path d="M44.8 34.5L51 27L57.2 34.5Z" fill="#B5A273" stroke="#B5A273" strokeWidth="3.5" strokeLinejoin="round" />
    </svg>
  );
}

export function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <Mark />
      <div className="min-w-0 leading-none">
        <span className="block font-serif text-[17px] font-semibold tracking-tight sm:text-[20px]">Spekup</span>
        <span className="mt-1 hidden text-[9px] font-semibold uppercase tracking-[.28em] text-gold sm:block">neighbors · civic life</span>
      </div>
    </div>
  );
}
