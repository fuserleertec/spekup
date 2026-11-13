"use client";

import type { ReactNode } from "react";
import type { Playbook, User } from "@/lib/types";
import { listingLabel } from "@/lib/format";

export const orangeCta = "inline-flex min-h-11 items-center justify-center rounded-full border-2 border-[#9A3412] bg-[#C2410C] px-4 py-2.5 text-center text-sm font-semibold text-[#F7F5EF] hover:bg-[#9A3412] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest focus-visible:ring-offset-2";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`lift rounded-[30px] bg-white/80 shadow-[0_1px_2px_rgba(23,55,45,.06),0_8px_24px_-12px_rgba(23,55,45,.12)] ring-1 ring-forest/5 backdrop-blur ${className}`}>{children}</div>;
}

export function Heading({ children, sub }: { children: ReactNode; sub?: string }) {
  return (
    <div className="mb-5">
      <h1 className="font-serif text-3xl font-semibold tracking-tight">{children}</h1>
      {sub && <p className="mt-1 text-sm text-forest/70">{sub}</p>}
    </div>
  );
}

export function Avatar({ user, className }: { user: Pick<User, "displayName" | "avatarUrl">; className: string }) {
  if (user.avatarUrl) return <img src={user.avatarUrl} alt="" className={`${className} object-cover`} />;
  const initials = user.displayName.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() || "").join("") || "?";
  return <span className={`${className} grid place-items-center bg-sage font-semibold text-forest`}>{initials}</span>;
}

export function Chip({ on, children, onClick }: { on: boolean; children: ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={`whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm ${on ? "bg-forest text-ivory" : "bg-white text-forest/80 ring-1 ring-forest/10 hover:bg-sage"}`}>
      {children}
    </button>
  );
}

export function ChipRow({ children }: { children: ReactNode }) {
  return <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1">{children}</div>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <Card className="p-10 text-center text-sm leading-relaxed text-forest/70">{children}</Card>;
}

export function Skeleton() {
  return (
    <div className="space-y-4" aria-hidden>
      {[0, 1, 2].map((i) => <div key={i} className="h-40 rounded-[30px] bg-white/70 ring-1 ring-forest/5 motion-safe:animate-pulse" />)}
    </div>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return <Card className="p-5 text-sm text-forest">{children}</Card>;
}

export function RoleLine({ user }: { user: User }) {
  return <span className="inline-flex items-center rounded-full bg-sage px-2 py-0.5 text-[11px] font-semibold text-forest">{labelFor(user)}</span>;
}

function labelFor(user: User) {
  if (user.role === "civic_professional") return "Civic professional · not verified";
  if (user.role === "community_business") return "Community business · not verified";
  if (user.role === "organizer") return "Local organizer";
  return "Resident";
}

export function PlaybookCard({ playbook, compact = false }: { playbook: Playbook; compact?: boolean }) {
  return (
    <div className="overflow-hidden rounded-[26px] border border-gold/40 bg-gradient-to-br from-ivory to-sage/60">
      <div className="flex items-center justify-between gap-3 bg-forest px-4 py-2 text-ivory">
        <span className="text-[11px] font-semibold uppercase tracking-[.18em] text-gold">Action Playbook</span>
        <span className="text-[11px] opacity-80">Community-authored · not reviewed</span>
      </div>
      <div className="p-4">
        <h3 className="font-serif text-lg font-semibold leading-tight">{playbook.title}</h3>
        <p className="mt-0.5 text-sm text-forest/70"><b className="font-medium text-forest">Objective:</b> {playbook.objective}</p>
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <span className="rounded-full bg-white px-2.5 py-1 ring-1 ring-forest/10">Suggested span · {playbook.weeks} weeks</span>
          <span className="rounded-full bg-white px-2.5 py-1 ring-1 ring-forest/10">{playbook.saves} {playbook.saves === 1 ? "save" : "saves"}</span>
        </div>
        {!compact && <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-forest/80">{playbook.steps}</p>}
        {playbook.linkedListing && (
          <div className="mt-4">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-forest/70">Linked local good, guide, or service</p>
            <div className="flex items-center gap-3 rounded-full bg-white p-1.5 pr-2 ring-1 ring-forest/10">
              <span className="grid h-11 w-11 place-items-center rounded-full bg-sage text-[10px] font-semibold uppercase">{listingLabel(playbook.linkedListing.listingKind).slice(0, 2) || "CV"}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{playbook.linkedListing.title}</p>
                <p className="text-xs text-forest/70">{playbook.linkedListing.priceLabel}</p>
              </div>
              <a href={`/listing/${playbook.linkedListing.id}`} className="rounded-full bg-gold px-3 py-1.5 text-xs font-semibold text-forest hover:brightness-95">View</a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function choiceClass(on: boolean) {
  return `shrink-0 rounded-full px-4 py-2 text-left text-sm font-semibold lg:w-full lg:whitespace-normal ${on ? "bg-forest text-ivory" : "bg-white text-forest ring-1 ring-forest/10"}`;
}

export function ThreeColumn({ id, label, rail, children, side }: { id: string; label: string; rail: ReactNode; children: ReactNode; side: ReactNode }) {
  return (
    <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[180px_minmax(0,1fr)_300px] lg:gap-8" data-testid={`${id}-layout`}>
      <nav data-testid={`${id}-tabs`} aria-label={label} className="flex min-w-0 flex-col gap-3 lg:sticky lg:top-24">{rail}</nav>
      <div className="min-w-0 space-y-4">{children}</div>
      <aside className="hidden space-y-5 lg:sticky lg:top-24 lg:block" data-testid={`${id}-rail`}>{side}</aside>
    </div>
  );
}

export const fieldClass = "w-full rounded-full bg-white px-4 py-2.5 text-sm outline-none ring-1 ring-forest/10 focus:ring-gold";
export const areaClass = "w-full rounded-3xl bg-white px-4 py-3 text-sm outline-none ring-1 ring-forest/10 focus:ring-gold";
