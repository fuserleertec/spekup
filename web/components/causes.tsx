"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { useApp } from "./context";
import { Avatar, Card, Empty, Skeleton, areaClass, fieldClass } from "./ui";

const CATEGORIES = [
  ["neighborhood", "Neighborhood improvement"],
  ["mutual_aid", "Mutual aid"],
  ["education", "Education"],
  ["environment", "Environment"],
  ["local_services", "Local services"],
] as const;

export type Cause = {
  id: string;
  title: string;
  story: string;
  category: string;
  localityLabel: string;
  beneficiaryLabel: string;
  beneficiaryRelation: string;
  coverUrl: string | null;
  goalCents: number;
  currency: string;
  pledgedCents: number;
  pledgedProgressPercent: number;
  collectedCents: null;
  collectedStatus: string;
  progressLabel: string;
  pledgerCount: number;
  volunteerCount: number;
  inKindCount: number;
  status: string;
  createdAt?: string;
  organizer: { handle: string; displayName: string; verifiedCharity: false };
  group: { id: string; name: string | null } | null;
  viewerIsOrganizer: boolean;
  viewerFollowing: boolean;
  notices: string[];
  updates?: Array<{ id: string; body: string; createdAt: string }>;
  history?: Array<{ action: string; note: string; createdAt: string }>;
  publicCredits?: Array<{ displayName: string }>;
  proposals?: Array<{ id: string; statement: string; status: string; label: string | null; disclaimer: string | null; from: { displayName: string } }>;
  viewerPledge?: { amountCents: number; message: string; publicCredit: boolean; collected: false } | null;
  moderation?: { configured: boolean };
};

function money(cents: number) {
  return `$${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

function categoryLabel(id: string) {
  return CATEGORIES.find((item) => item[0] === id)?.[1] || id;
}

export function CauseCard({ cause }: { cause: Cause }) {
  const [openPhoto, setOpenPhoto] = useState(false);
  const width = Math.max(0, Math.min(100, cause.pledgedProgressPercent));
  return (
    <Card className="reveal overflow-hidden rounded-3xl shadow-[0_2px_0_rgba(23,55,45,0.08)]">
      {openPhoto && cause.coverUrl && <button type="button" className="fixed inset-0 z-[70] grid place-items-center bg-forest/80 p-6" onClick={() => setOpenPhoto(false)} aria-label="Close photo"><img src={cause.coverUrl} alt="" className="max-h-[80vh] max-w-full rounded-2xl object-contain" /></button>}
      <div className="flex items-center gap-3 p-4 pb-3">
        <Link href={`/u/${cause.organizer.handle}`}><Avatar user={{ displayName: cause.organizer.displayName, avatarUrl: null }} className="h-11 w-11 rounded-full" /></Link>
        <div className="min-w-0 flex-1">
          <Link href={`/u/${cause.organizer.handle}`} className="font-semibold hover:underline">{cause.organizer.displayName}</Link>
          <p className="text-xs text-forest/70">{cause.status} · not a verified charity{cause.localityLabel ? ` · ${cause.localityLabel}` : ""}</p>
        </div>
      </div>
      <div className="px-4">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-goldink">{categoryLabel(cause.category)} · {cause.status} · not a charity</p>
        <h2 className="mt-1 font-serif text-xl font-semibold"><Link href={`/causes/${cause.id}`}>{cause.title}</Link></h2>
        <p className="mt-1 text-sm text-forest/70">{cause.beneficiaryLabel} · {cause.beneficiaryRelation === "self" ? "organizer's own effort" : "authorized organizer"}</p>
        <p className="mt-2 whitespace-pre-wrap text-[15px] leading-relaxed text-forest/80">{cause.story}</p>
        <div className="mt-3">
          <div className="flex justify-between text-sm"><span>{cause.progressLabel}</span><span>{money(cause.pledgedCents)} pledged of {money(cause.goalCents)}</span></div>
          <div className="mt-1 h-2 rounded-full bg-sage" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={width} aria-label={`Pledged progress ${cause.pledgedProgressPercent} percent. Not collected.`}>
            <div className="h-2 rounded-full bg-forest" style={{ width: `${width}%` }} />
          </div>
          <p className="mt-1 text-xs text-forest/60">{cause.pledgerCount} {cause.pledgerCount === 1 ? "pledge" : "pledges"}. Collected funds: unavailable. {cause.organizer.verifiedCharity ? "" : "Organizer is not a verified charity."}</p>
        </div>
      </div>
      {cause.coverUrl && (
        <button type="button" className="mx-4 mb-4 mt-3 block overflow-hidden rounded-[24px]" onClick={() => setOpenPhoto(true)} aria-label={cause.title || "Open photo"}>
          <img src={cause.coverUrl} alt="" className="aspect-[16/9] w-full object-cover" />
        </button>
      )}
      {!cause.coverUrl && <div className="h-4" />}
    </Card>
  );
}

export function useCauses() {
  const { rev, q, setQ } = useApp();
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState("");
  const [locality, setLocality] = useState("");
  const [following, setFollowing] = useState(false);
  const [causes, setCauses] = useState<Cause[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const params = new URLSearchParams();
    if (category) params.set("category", category);
    if (status) params.set("status", status);
    if (locality.trim()) params.set("locality", locality.trim());
    if (following) params.set("following", "1");
    if (q.trim()) params.set("q", q.trim());
    let cancel = false;
    api<{ causes: Cause[]; notice: string | null }>(`/api/causes?${params}`).then((data) => {
      if (cancel) return;
      setCauses(data.causes);
      setNotice(data.notice);
      setError("");
    }).catch((err) => { if (!cancel) setError(err instanceof Error ? err.message : "Couldn't load causes."); });
    return () => { cancel = true; };
  }, [category, status, locality, following, q, rev]);
  return { category, setCategory, status, setStatus, locality, setLocality, following, setFollowing, causes, notice, error, q, setQ };
}

export function CauseFilters({ board }: { board: ReturnType<typeof useCauses> }) {
  const { category, setCategory, status, setStatus, locality, setLocality, following, setFollowing } = board;
  const choice = (on: boolean) => `shrink-0 rounded-full px-4 py-2 text-left text-sm lg:whitespace-normal ${on ? "bg-forest text-ivory" : "bg-white text-forest ring-1 ring-forest/10"}`;
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible">
        <button type="button" onClick={() => setFollowing((value) => !value)} className={choice(following)}>Following</button>
        <button type="button" onClick={() => setCategory("")} className={choice(category === "")}>All purposes</button>
        {CATEGORIES.map(([id, label]) => <button type="button" key={id} onClick={() => setCategory(id)} className={choice(category === id)}>{label}</button>)}
        <button type="button" onClick={() => setStatus("")} className={choice(status === "")}>Any status</button>
        {["active", "paused", "completed", "cancelled"].map((item) => <button type="button" key={item} onClick={() => setStatus(item)} className={choice(status === item)}>{item}</button>)}
      </div>
      <input aria-label="Filter by locality" value={locality} onChange={(e) => setLocality(e.target.value)} placeholder="Neighborhood, city, or region" className={fieldClass} />
    </div>
  );
}

export function CauseForm({ category }: { category: string }) {
  const { toast, bump } = useApp();
  const [title, setTitle] = useState("");
  const [story, setStory] = useState("");
  const [beneficiaryLabel, setBeneficiaryLabel] = useState("");
  const [relation, setRelation] = useState("self");
  const [goal, setGoal] = useState("100.00");
  const [place, setPlace] = useState("");
  return (
    <form className="space-y-3" onSubmit={async (e) => {
      e.preventDefault();
      const [whole, frac = ""] = goal.trim().split(".");
      if (!/^\d+$/.test(whole) || (frac && !/^\d{1,2}$/.test(frac))) { toast("Enter a dollar amount such as 100 or 100.00."); return; }
      const goalCents = Number(whole) * 100 + Number((frac + "00").slice(0, 2));
      try {
        const saved = await api<{ cause: Cause }>("/api/causes", { json: { title, story, category: category || "neighborhood", beneficiaryLabel, beneficiaryRelation: relation, goalCents, currency: "USD", localityLabel: place } });
        await api(`/api/causes/${saved.cause.id}/status`, { json: { status: "active" } });
        setTitle(""); setStory("");
        toast("Cause saved and marked active. Nothing was collected.");
        bump();
      } catch (err) { toast(err instanceof Error ? err.message : "Couldn't save the cause."); }
    }}>
      <h2 className="font-serif text-xl">Start a cause</h2>
      <input aria-label="Cause title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" className={fieldClass} />
      <textarea aria-label="Cause story" value={story} onChange={(e) => setStory(e.target.value)} rows={4} placeholder="What neighbors would be supporting. No bank details, no private addresses, no medical records." className={areaClass} />
      <input aria-label="Beneficiary" value={beneficiaryLabel} onChange={(e) => setBeneficiaryLabel(e.target.value)} placeholder="Who the effort is for, as a display name" className={fieldClass} />
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setRelation("self")} className={`rounded-full px-3 py-1 text-sm ${relation === "self" ? "bg-forest text-ivory" : "bg-white ring-1 ring-forest/10"}`}>My own effort</button>
        <button type="button" onClick={() => setRelation("authorized_organizer")} className={`rounded-full px-3 py-1 text-sm ${relation === "authorized_organizer" ? "bg-forest text-ivory" : "bg-white ring-1 ring-forest/10"}`}>I am authorized to organize this</button>
      </div>
      <input aria-label="Goal amount" value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="100.00" className={fieldClass} />
      <input aria-label="Cause locality" value={place} onChange={(e) => setPlace(e.target.value)} placeholder="Neighborhood or city, not a street address" className={fieldClass} />
      <p className="text-xs text-forest/70">Goal is stored in cents. Currency is USD only. No cover is required. You are not verified as a charity.</p>
      <button className="rounded-full bg-forest px-4 py-2 text-sm font-semibold text-ivory">Publish cause</button>
    </form>
  );
}

export function CauseDetail({ id }: { id: string }) {
  const { me, toast, bump, rev } = useApp();
  const [cause, setCause] = useState<Cause | null>(null);
  const [error, setError] = useState("");
  const [amount, setAmount] = useState("25.00");
  const [message, setMessage] = useState("");
  const [credit, setCredit] = useState(false);
  const [update, setUpdate] = useState("");
  const [offer, setOffer] = useState("");
  const [flag, setFlag] = useState("");
  useEffect(() => {
    api<{ cause: Cause }>(`/api/causes/${id}`).then((data) => { setCause(data.cause); setError(""); }).catch((err) => setError(err instanceof Error ? err.message : "Not found."));
  }, [id, rev]);
  if (error) return <Empty>{error}</Empty>;
  if (!cause) return <Skeleton />;
  const width = Math.max(0, Math.min(100, cause.pledgedProgressPercent));
  async function pledge() {
    const [whole, frac = ""] = amount.trim().split(".");
    if (!/^\d+$/.test(whole) || (frac && !/^\d{1,2}$/.test(frac))) { toast("Enter dollars and cents, such as 25 or 25.00."); return; }
    const amountCents = Number(whole) * 100 + Number((frac + "00").slice(0, 2));
    try {
      await api(`/api/causes/${id}/pledge`, { json: { amountCents, currency: "USD", message, publicCredit: credit } });
      toast("Pledge saved. It was not collected.");
      bump();
    } catch (err) { toast(err instanceof Error ? err.message : "Couldn't save the pledge."); }
  }
  return (
    <div className="space-y-4">
      <Link href="/causes" className="text-sm text-goldink">All causes</Link>
      <Card className="p-5">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-goldink">{categoryLabel(cause.category)} · {cause.status} · pledged, not collected</p>
        <h1 className="mt-1 font-serif text-3xl font-semibold">{cause.title}</h1>
        <p className="mt-2 text-sm text-forest/70">Organized by <Link className="underline" href={`/u/${cause.organizer.handle}`}>{cause.organizer.displayName}</Link>. Not a verified charity.{cause.group ? <> · <Link className="underline" href={`/g/${cause.group.id}`}>{cause.group.name}</Link></> : null}</p>
        <p className="mt-3 whitespace-pre-wrap text-[15px] leading-relaxed">{cause.story}</p>
        <p className="mt-3 text-sm">For {cause.beneficiaryLabel}. {cause.beneficiaryRelation === "self" ? "The organizer says this is their own effort." : "The organizer says they are authorized to organize this."}</p>
        {cause.localityLabel && <p className="text-sm text-forest/70">Approximate area: {cause.localityLabel}. Not a street address.</p>}
        {cause.coverUrl && <img src={cause.coverUrl} alt="" className="mt-3 aspect-[16/9] w-full rounded-[24px] object-cover" />}
        <div className="mt-4">
          <div className="flex justify-between text-sm"><span>Pledged progress</span><span>{money(cause.pledgedCents)} of {money(cause.goalCents)} USD</span></div>
          <div className="mt-1 h-2 rounded-full bg-sage" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={width} aria-label="Pledged progress, not funds raised">
            <div className="h-2 rounded-full bg-forest" style={{ width: `${width}%` }} />
          </div>
          <p className="mt-1 text-xs text-forest/60">Collected: unavailable (0 on the books). {cause.pledgerCount} current pledges. {cause.volunteerCount} volunteer offers. {cause.inKindCount} in-kind offers. Names and amounts stay private unless someone opts in to a name only.</p>
        </div>
        {cause.notices.map((notice) => <p key={notice} className="mt-2 text-xs text-forest/70">{notice}</p>)}
        <div className="mt-4 flex flex-wrap gap-2">
          {me && <button type="button" onClick={async () => { try { await api(`/api/causes/${id}/follow`, { method: cause.viewerFollowing ? "DELETE" : "POST" }); bump(); } catch (err) { toast(err instanceof Error ? err.message : "Couldn't update that follow."); } }} className="rounded-full px-4 py-2 text-sm ring-1 ring-forest/20">{cause.viewerFollowing ? "Unfollow" : "Follow"}</button>}
          <button type="button" onClick={async () => { const url = `${location.origin}/causes/${id}`; try { await navigator.clipboard.writeText(url); toast("Link copied on this device. Nothing was posted elsewhere."); } catch { toast(url); } }} className="rounded-full px-4 py-2 text-sm ring-1 ring-forest/20">Copy link</button>
          {cause.viewerIsOrganizer && cause.status === "active" && <button type="button" onClick={async () => { await api(`/api/causes/${id}/status`, { json: { status: "paused" } }); toast("Paused. New pledges are closed. Nothing was refunded because nothing was collected."); bump(); }} className="rounded-full px-4 py-2 text-sm ring-1 ring-forest/20">Pause</button>}
          {cause.viewerIsOrganizer && cause.status === "paused" && <button type="button" onClick={async () => { await api(`/api/causes/${id}/status`, { json: { status: "active" } }); bump(); }} className="rounded-full px-4 py-2 text-sm ring-1 ring-forest/20">Resume</button>}
          {cause.viewerIsOrganizer && (cause.status === "active" || cause.status === "paused") && <button type="button" onClick={async () => { await api(`/api/causes/${id}/status`, { json: { status: "cancelled" } }); toast("Cancelled and kept as an archive."); bump(); }} className="rounded-full px-4 py-2 text-sm ring-1 ring-forest/20">Cancel</button>}
        </div>
      </Card>
      {cause.status === "active" && me && !cause.viewerIsOrganizer && (
        <Card className="p-5">
          <h2 className="font-serif text-lg">Pledge an intention</h2>
          <p className="mt-1 text-xs text-forest/70">This does not pay, reserve, or donate money. You can change or withdraw it while the cause is active.</p>
          {cause.viewerPledge && <p className="mt-2 text-sm">Your current pledge: {money(cause.viewerPledge.amountCents)}. Not collected.</p>}
          <input aria-label="Pledge amount" value={amount} onChange={(e) => setAmount(e.target.value)} className={`${fieldClass} mt-2`} />
          <textarea aria-label="Pledge note" value={message} onChange={(e) => setMessage(e.target.value)} rows={2} placeholder="Note for yourself and the organizer. It is not public." className={`${areaClass} mt-2`} />
          <label className="mt-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={credit} onChange={(e) => setCredit(e.target.checked)} /> Show my display name. Not my amount.</label>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" onClick={pledge} className="rounded-full bg-forest px-4 py-2 text-sm font-semibold text-ivory">{cause.viewerPledge ? "Update pledge" : "Save pledge"}</button>
            {cause.viewerPledge && <button type="button" onClick={async () => { await api(`/api/causes/${id}/pledge`, { method: "DELETE" }); toast("Pledge withdrawn. Nothing was refunded."); bump(); }} className="rounded-full px-4 py-2 text-sm ring-1 ring-forest/20">Withdraw pledge</button>}
          </div>
        </Card>
      )}
      {cause.status === "active" && me && !cause.viewerIsOrganizer && (
        <Card className="p-5">
          <h2 className="font-serif text-lg">Offer time or goods</h2>
          <textarea aria-label="Support offer" value={offer} onChange={(e) => setOffer(e.target.value)} rows={2} placeholder="Volunteer time or an in-kind offer. Not a payment." className={areaClass} />
          <button type="button" className="mt-2 rounded-full px-4 py-2 text-sm ring-1 ring-forest/20" onClick={async () => { try { await api(`/api/causes/${id}/support`, { json: { kind: "volunteer", detail: offer } }); toast("Volunteer offer saved. Nothing was charged."); bump(); } catch (err) { toast(err instanceof Error ? err.message : "Couldn't save that."); } }}>Offer to volunteer</button>
          <h3 className="mt-4 font-serif text-lg">Sponsor offer</h3>
          <p className="text-xs text-forest/70">The organizer can accept this offer. Acceptance is not a paid sponsorship.</p>
          <button type="button" className="mt-2 rounded-full px-4 py-2 text-sm ring-1 ring-forest/20" onClick={async () => { try { await api(`/api/causes/${id}/proposals`, { json: { kind: "sponsor", statement: offer || "I can help in kind. This is not a payment." } }); toast("Offer sent. No funds were collected."); bump(); } catch (err) { toast(err instanceof Error ? err.message : "Couldn't send that."); } }}>Send sponsor offer</button>
        </Card>
      )}
      {(cause.proposals || []).map((proposal) => (
        <Card key={proposal.id} className="p-5 text-sm">
          <p>{proposal.from.displayName}: {proposal.statement}</p>
          {proposal.label && <p className="mt-1 font-semibold">{proposal.label}. {proposal.disclaimer}</p>}
          {cause.viewerIsOrganizer && proposal.status === "submitted" && <button type="button" className="mt-2 rounded-full bg-forest px-3 py-1 text-sm font-semibold text-ivory" onClick={async () => { await api(`/api/proposals/${proposal.id}/decision`, { json: { status: "agreed" } }); toast("Offer accepted. No funds were collected."); bump(); }}>Accept offer</button>}
        </Card>
      ))}
      {(cause.publicCredits || []).length > 0 && <Card className="p-5"><h2 className="font-serif text-lg">Names people chose to show</h2><ul className="mt-2 text-sm">{cause.publicCredits?.map((credit) => <li key={credit.displayName}>{credit.displayName}</li>)}</ul><p className="mt-1 text-xs text-forest/60">Amounts are not listed.</p></Card>}
      <Card className="p-5">
        <h2 className="font-serif text-lg">Updates</h2>
        {(cause.updates || []).length === 0 ? <p className="mt-2 text-sm text-forest/70">No updates yet.</p> : cause.updates?.map((item) => <p key={item.id} className="mt-2 text-sm">{item.body}</p>)}
        {cause.viewerIsOrganizer && cause.status !== "cancelled" && (
          <form className="mt-3 space-y-2" onSubmit={async (e) => { e.preventDefault(); try { await api(`/api/causes/${id}/updates`, { json: { body: update } }); setUpdate(""); toast("Update posted."); bump(); } catch (err) { toast(err instanceof Error ? err.message : "Couldn't post that."); } }}>
            <textarea aria-label="Cause update" value={update} onChange={(e) => setUpdate(e.target.value)} rows={3} className={areaClass} />
            <button className="rounded-full bg-forest px-4 py-2 text-sm font-semibold text-ivory">Post update</button>
          </form>
        )}
      </Card>
      {(cause.history || []).length > 0 && <Card className="p-5"><h2 className="font-serif text-lg">History</h2><ul className="mt-2 space-y-1 text-sm">{cause.history?.map((item, index) => <li key={index}><b>{item.action}</b> · {item.note}</li>)}</ul></Card>}
      {me && (
        <Card className="p-5">
          <h2 className="font-serif text-lg">Flag for review</h2>
          <p className="mt-1 text-xs text-forest/70">{cause.moderation?.configured ? "" : "No moderator is configured. A flag is saved and the cause is not auto-removed."} Prohibited uses include fraud, emergencies you invent, and fundraising tied to an accusation.</p>
          <textarea aria-label="Flag reason" value={flag} onChange={(e) => setFlag(e.target.value)} rows={2} className={`${areaClass} mt-2`} />
          <button type="button" className="mt-2 rounded-full px-4 py-2 text-sm ring-1 ring-forest/20" onClick={async () => { try { await api(`/api/causes/${id}/flags`, { json: { reason: flag } }); setFlag(""); toast("Flag saved. Nobody was contacted."); } catch (err) { toast(err instanceof Error ? err.message : "Couldn't save the flag."); } }}>Save flag</button>
        </Card>
      )}
    </div>
  );
}

export function ProfileCauses({ handle, self }: { handle: string; self: boolean }) {
  const [causes, setCauses] = useState<Cause[] | null>(null);
  useEffect(() => {
    const path = self ? "/api/causes?mine=1" : `/api/users/${handle}/causes`;
    api<{ causes: Cause[] }>(path).then((data) => setCauses(data.causes)).catch(() => setCauses([]));
  }, [handle, self]);
  if (causes === null) return <Skeleton />;
  if (causes.length === 0) return <Empty>{self ? "You have not started a cause." : "No public causes from this account."}</Empty>;
  return <div className="space-y-3">{causes.map((cause) => <CauseCard key={cause.id} cause={cause} />)}</div>;
}
