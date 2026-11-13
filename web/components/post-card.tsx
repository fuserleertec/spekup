"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ApiError, api } from "@/lib/api";
import { tx } from "@/lib/i18n";
import { TranslateButton, useContentTranslation } from "./see-translation";
import { ago, centsToInput, kindLabel, listingLabel, topicLabel } from "@/lib/format";
import type { Comment, Inquiry, Post } from "@/lib/types";
import { useApp } from "./context";
import { Icon } from "./icons";
import { ProductForm } from "./publish";
import { DigitalPanel } from "./digital";
import { Avatar, Card, PlaybookCard, areaClass, fieldClass } from "./ui";

function cents(value: number | null) {
  if (value == null) return "—";
  return `$${Math.floor(value / 100)}.${String(value % 100).padStart(2, "0")}`;
}

function OfferQuote({ post }: { post: Post }) {
  const quote = post.quote;
  const { me, toast, bump } = useApp();
  const [error, setError] = useState("");
  if (!quote) return null;
  return (
    <div className="mt-3 rounded-3xl bg-ivory px-3 py-3 text-sm ring-1 ring-forest/10">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-goldink">{quote.scheduleLabel || "Proposed preview—not final pricing"}</p>
      {quote.applicable ? (
        <>
          <p className="mt-2">List price {cents(quote.listPriceCents)}</p>
          <p>Proposed platform fee {cents(quote.platformFeeCents)} ({quote.platformFeeBps} basis points)</p>
          <p>Seller would net {cents(quote.sellerNetCents)}</p>
          <p>Buyer total on this preview {cents(quote.buyerTotalCents)}</p>
        </>
      ) : (
        <p className="mt-2">No platform fee. Free services, free advice, and prices that are not fixed are not charged.</p>
      )}
      <p className="mt-2 text-xs text-forest/70">Processor fees are unknown until a provider is connected, so they are not included. This is not a charge, an order, or final pricing. <Link className="underline" href={`/u/${post.author.handle}`}>Seller profile</Link></p>
      {error && <p className="mt-2 text-rose-800">{error}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        {quote.applicable && me && !post.viewer.isAuthor && (
          <button type="button" onClick={async () => {
            setError("");
            try {
              await api(`/api/listings/${post.id}/interest`, { json: { scheduleVersion: quote.scheduleVersion, priceCents: quote.listPriceCents, platformFeeCents: quote.platformFeeCents, sellerNetCents: quote.sellerNetCents, buyerTotalCents: quote.buyerTotalCents } });
              toast("Interest saved. Nothing was charged.");
              bump();
            } catch (err) {
              setError(err instanceof Error ? err.message : "Couldn't save interest.");
            }
          }} className="rounded-full bg-forest px-4 py-2 text-sm font-semibold text-ivory">Save interest</button>
        )}
        {me && (
          <button type="button" onClick={async () => {
            try { await api("/api/checkout", { json: { listingId: post.id } }); }
            catch (err) { toast(err instanceof Error ? err.message : "Payments are not configured."); }
          }} className="rounded-full px-4 py-2 text-sm ring-1 ring-forest/20">Payments are not configured</button>
        )}
        {me && quote.applicable && (
          <button type="button" onClick={async () => {
            try { await api("/api/support-interests", { json: { postId: post.id, note: "Interest only.", wishedCents: 200 } }); toast("Support interest saved. No tip was transferred."); }
            catch (err) { toast(err instanceof Error ? err.message : "Couldn't save that."); }
          }} className="rounded-full px-4 py-2 text-sm ring-1 ring-forest/20">Save tip interest</button>
        )}
      </div>
    </div>
  );
}

function PollChoices({ post, labelFor }: { post: Post; labelFor?: (id: string, label: string) => string }) {
  const poll = post.poll;
  const { me, toast, bump } = useApp();
  const [choice, setChoice] = useState(poll?.viewerChoice || "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { setChoice(poll?.viewerChoice || ""); }, [poll?.viewerChoice]);
  if (!poll) return null;
  const open = poll.state === "open";
  const stateLabel = poll.state === "open" ? "Open" : poll.state === "closed" ? "Closed" : poll.state === "expired" ? "Closed by time" : "Canceled";
  const subject = poll.subjectType === "politician" ? "Politician" : poll.subjectType === "corporation" ? "Corporation" : "Community";
  const closeText = poll.closesAt
    ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short", timeZone: poll.timezone }).format(new Date(poll.closesAt))
    : "";
  async function vote() {
    if (!choice) return;
    setBusy(true);
    setError("");
    try {
      await api(`/api/polls/${post.id}/vote`, { json: { optionId: choice } });
      toast("Vote saved on your account. Totals refresh from the server.");
      bump();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save that vote.");
    } finally {
      setBusy(false);
    }
  }
  async function withdraw() {
    setBusy(true);
    setError("");
    try {
      await api(`/api/polls/${post.id}/vote`, { method: "DELETE" });
      toast("Vote withdrawn.");
      bump();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't withdraw that vote.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mt-3 rounded-3xl bg-ivory px-3 py-3 ring-1 ring-forest/10">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-goldink">Community opinion · {stateLabel} · not an election</p>
      <p className="mt-1 text-sm text-forest/80">{subject}{poll.subjectLabel ? ` · ${poll.subjectLabel}` : ""}</p>
      <p className="mt-1 text-xs text-forest/70">{poll.notice} Reports are a separate, sourced allegation.</p>
      {closeText && <p className="mt-1 text-xs text-forest/70">Closes {closeText} ({poll.timezone}).</p>}
      {open && me && (
        <fieldset className="mt-3 space-y-2">
          <legend className="text-sm font-semibold">Your choice</legend>
          {poll.options.map((option) => (
            <label key={option.id} className="flex items-center gap-2 text-sm">
              <input type="radio" name={`poll-${post.id}`} value={option.id} checked={choice === option.id} onChange={() => setChoice(option.id)} />
              {(labelFor || ((_, label) => label))(option.id, option.label)}
            </label>
          ))}
          <div className="flex flex-wrap gap-2 pt-1">
            <button type="button" disabled={busy || !choice} onClick={vote} className="rounded-full bg-forest px-4 py-2 text-sm font-semibold text-ivory disabled:opacity-40">{poll.viewerChoice ? "Change vote" : "Cast vote"}</button>
            {poll.viewerChoice && <button type="button" disabled={busy} onClick={withdraw} className="rounded-full px-4 py-2 text-sm ring-1 ring-forest/20">Withdraw vote</button>}
          </div>
        </fieldset>
      )}
      {open && !me && <p className="mt-3 text-sm"><Link href="/login" className="underline">Log in</Link> to vote. One account, one choice. An account is not identity verification.</p>}
      {!open && <p className="mt-3 text-sm text-forest/70">Voting is closed. The totals below are what was saved.</p>}
      {error && <p className="mt-2 text-sm text-rose-800">{error}</p>}
      <div className="mt-3 space-y-2" role="group" aria-label="Results">
        <p className="text-sm font-semibold">{poll.respondents} {poll.respondents === 1 ? "respondent" : "respondents"}</p>
        {poll.options.map((option) => (
          <div key={option.id}>
            <div className="flex justify-between gap-3 text-sm"><span>{(labelFor || ((_, label) => label))(option.id, option.label)}{poll.viewerChoice === option.id ? " · your choice" : ""}</span><span>{option.count} · {option.percent}%</span></div>
            <div className="mt-1 h-2 rounded-full bg-sage" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={option.percent} aria-label={`${option.label}: ${option.count} of ${poll.respondents} respondents`}>
              <div className="h-2 rounded-full bg-forest" style={{ width: `${Math.max(0, Math.min(100, option.percent))}%` }} />
            </div>
          </div>
        ))}
        <p className="text-xs text-forest/60">Percents use the respondent count as the denominator. Zero respondents is 0%, not a missing number. This is not official public opinion.</p>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {me && <button type="button" onClick={async () => { try { await api(`/api/polls/${post.id}/follow`, { method: poll.following ? "DELETE" : "POST" }); bump(); } catch (err) { toast(err instanceof Error ? err.message : "Couldn't update that follow."); } }} className="rounded-full px-4 py-2 text-sm ring-1 ring-forest/20">{poll.following ? "Unfollow" : "Follow"}</button>}
        {post.viewer.isAuthor && poll.state !== "canceled" && poll.state !== "closed" && <button type="button" onClick={async () => { try { await api(`/api/polls/${post.id}/close`, { method: "POST" }); toast("Poll closed. Results stay visible."); bump(); } catch (err) { toast(err instanceof Error ? err.message : "Couldn't close it."); } }} className="rounded-full px-4 py-2 text-sm ring-1 ring-forest/20">Close poll</button>}
        {post.viewer.isAuthor && poll.state !== "canceled" && <button type="button" onClick={async () => { try { await api(`/api/polls/${post.id}/cancel`, { method: "POST" }); toast("Poll canceled. It is not a result."); bump(); } catch (err) { toast(err instanceof Error ? err.message : "Couldn't cancel it."); } }} className="rounded-full px-4 py-2 text-sm ring-1 ring-forest/20">Cancel poll</button>}
      </div>
      {poll.history.length > 0 && <ul className="mt-3 space-y-1 text-xs text-forest/70">{poll.history.map((item, index) => <li key={`${item.action}-${index}`}><b>{item.action}</b> · {item.createdAt.slice(0, 16).replace("T", " ")} · {item.note}</li>)}</ul>}
    </div>
  );
}

function CommentLine({ comment, canReport, onReport }: { comment: Comment; canReport: boolean; onReport: () => void }) {
  const translated = useContentTranslation([{ kind: "comment", id: comment.id, text: comment.body }]);
  return (
    <p className="mb-2 rounded-2xl bg-sage px-3 py-2 text-sm">
      <b>{comment.author.displayName}</b> · {translated.textFor("comment", comment.id, comment.body)}
      {canReport && <button type="button" className="ml-2 underline" onClick={onReport}>{tx("Report")}</button>}
      {translated.enabled && <span className="ml-2"><TranslateButton on={translated.on} busy={translated.busy} onClick={translated.toggle} /></span>}
    </p>
  );
}

export function PostCard({ post, detail = false, watchOptIn = false }: { post: Post; detail?: boolean; watchOptIn?: boolean }) {
  const { me, toast, bump, openComposer } = useApp();
  const [open, setOpen] = useState(detail);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [draft, setDraft] = useState("");
  const [inquiries, setInquiries] = useState<Inquiry[] | null>(null);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [editingListing, setEditingListing] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [commentFlag, setCommentFlag] = useState<string | null>(null);
  const [contact, setContact] = useState<"" | "message" | "time">("");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const href = post.kind === "offer" ? `/listing/${post.id}` : `/post/${post.id}`;
  const parts = [
    { kind: "post_title", id: post.id, text: post.title || "" },
    { kind: "post_body", id: post.id, text: post.body || "" },
    ...((post.poll?.options || []).map((option) => ({ kind: "poll_option", id: option.id, text: option.label }))),
  ];
  const translated = useContentTranslation(parts);
  useEffect(() => {
    const node = videoRef.current;
    if (!watchOptIn || !me || !node || post.video?.status !== "ready") return;
    let last = 0;
    let seeking = false;
    let acc = 0;
    let started = true;
    const flush = () => {
      if (document.hidden || seeking || node.paused || acc < 1) {
        acc = 0;
        return;
      }
      const playedMs = Math.min(5000, Math.floor(acc * 1000));
      acc = 0;
      api("/api/feed/watch", { json: { eventId: crypto.randomUUID(), postId: post.id, playedMs, visible: true, userInitiated: true, hidden: false, paused: false, seeking: false, started } }).catch(() => undefined);
      started = false;
    };
    const onTime = () => {
      const delta = node.currentTime - last;
      last = node.currentTime;
      if (!node.paused && !seeking && !document.hidden && delta > 0 && delta < 1.5) acc += delta;
      if (acc >= 5) flush();
    };
    const onSeeking = () => { seeking = true; acc = 0; };
    const onSeeked = () => { seeking = false; last = node.currentTime; acc = 0; };
    const onPause = () => { acc = 0; };
    node.addEventListener("timeupdate", onTime);
    node.addEventListener("seeking", onSeeking);
    node.addEventListener("seeked", onSeeked);
    node.addEventListener("pause", onPause);
    return () => {
      node.removeEventListener("timeupdate", onTime);
      node.removeEventListener("seeking", onSeeking);
      node.removeEventListener("seeked", onSeeked);
      node.removeEventListener("pause", onPause);
    };
  }, [watchOptIn, me, post.id, post.video?.status]);
  useEffect(() => {
    if (!post.video || post.video.status === "ready" || post.video.status === "failed") return;
    const timer = window.setInterval(() => {
      api<{ video: { status: string } }>(`/api/videos/${post.video?.id}`).then((data) => {
        if (data.video.status === "ready" || data.video.status === "failed") bump();
      }).catch(() => undefined);
    }, 1500);
    return () => window.clearInterval(timer);
  }, [post.video?.id, post.video?.status, bump]);

  async function loadThread() {
    const data = await api<{ comments: Comment[] }>(`/api/posts/${post.id}`);
    setComments(data.comments);
    if (me && post.kind !== "share") {
      const bag = await api<{ inquiries: Inquiry[] }>(`/api/posts/${post.id}/inquiries`);
      setInquiries(bag.inquiries);
    }
  }

  async function toggleComments() {
    const next = !open;
    setOpen(next);
    if (next && !comments) {
      try {
        await loadThread();
      } catch (err) {
        toast(err instanceof Error ? err.message : "Couldn't load comments.");
      }
    }
  }

  async function act(path: string, method: string) {
    if (!me) {
      window.location.href = "/login";
      return;
    }
    try {
      await api(path, { method });
      bump();
    } catch (err) {
      toast(err instanceof Error ? err.message : "That didn't save.");
    }
  }

  async function sendComment(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.trim()) return;
    setBusy(true);
    try {
      await api(`/api/posts/${post.id}/comments`, { json: { body: draft } });
      setDraft("");
      await loadThread();
      bump();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Couldn't post that comment.");
    } finally {
      setBusy(false);
    }
  }

  async function sendInquiry(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api(`/api/posts/${post.id}/inquiries`, { json: { body: reply } });
      setReply("");
      await loadThread();
      toast(post.kind === "ask" ? "Response saved here. It was not emailed or texted." : "Inquiry saved here. It was not emailed or texted.");
      bump();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Couldn't save that.");
    } finally {
      setBusy(false);
    }
  }

  async function markAvailability(next: NonNullable<Post["availability"]>) {
    const payload: Record<string, unknown> = {
      title: post.title,
      body: post.body,
      topic: post.topic,
      priceMode: post.priceMode,
      listingKind: post.listingKind,
      availability: next,
      mediaId: post.images?.[0]?.id || (post.mediaUrl ? post.mediaUrl.split("/").pop() : null),
      groupId: post.group?.id || null,
      playbookId: post.playbook?.id || null,
    };
    if (post.priceMode === "fixed" && post.priceCents != null) payload.price = centsToInput(post.priceCents);
    if (post.listingKind === "local_good") {
      payload.condition = post.condition;
      payload.quantity = post.quantity;
      payload.handoff = post.handoff;
    }
    if (post.images?.length) payload.imageIds = post.images.map((image) => image.id);
    try {
      await api(`/api/posts/${post.id}`, { method: "PATCH", json: payload });
      toast(next === "available" ? "Listing is available again. Nothing was charged." : `Marked ${next}. Nothing was reserved or charged.`);
      bump();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't update that listing.");
    }
  }

  return (
    <Card className="reveal overflow-hidden rounded-3xl shadow-[0_2px_0_rgba(23,55,45,0.08)]">
      {lightbox && <button type="button" className="fixed inset-0 z-[70] grid place-items-center bg-forest/80 p-6" onClick={() => setLightbox(null)} aria-label="Close photo"><img src={lightbox} alt="" className="max-h-[80vh] max-w-full rounded-2xl object-contain" /></button>}
      <div className="flex items-center gap-3 p-4 pb-3">
        <Link href={`/u/${post.author.handle}`}><Avatar user={post.author} className="h-11 w-11 rounded-full" /></Link>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/u/${post.author.handle}`} className="font-semibold hover:underline">{post.author.displayName}</Link>
            <span className="rounded-full bg-sage px-2 py-0.5 text-[11px] font-semibold text-forest">{tx(post.author.role === "civic_professional" ? "Civic professional · not verified" : post.author.role === "community_business" ? "Community business · not verified" : post.author.role === "organizer" ? "Local organizer" : "Resident")}</span>
          </div>
          <p className="text-xs text-forest/70">
            {post.author.neighborhood ? `${post.author.neighborhood} · ` : ""}{ago(post.createdAt)}{post.edited ? " · edited" : ""} · <span className="text-goldink">#{topicLabel(post.topic).replace(/\s/g, "")}</span>
          </p>
        </div>
        <details className="relative">
          <summary aria-label="More options" className="cursor-pointer list-none rounded-full px-2 text-forest/70 hover:bg-sage [&::-webkit-details-marker]:hidden">•••</summary>
          <div className="absolute right-0 z-20 mt-1 w-40 rounded-2xl bg-white p-1 text-sm shadow-lg ring-1 ring-forest/10">
            <button className="block w-full rounded-xl px-3 py-2 text-left hover:bg-sage" onClick={() => act(`/api/posts/${post.id}/save`, post.viewer.saved ? "DELETE" : "POST")}>{post.viewer.saved ? "Unsave" : "Save"}</button>
            {post.viewer.isAuthor && post.kind === "offer" && <button className="block w-full rounded-xl px-3 py-2 text-left hover:bg-sage" onClick={() => setEditingListing(true)}>Edit listing</button>}
            {post.viewer.isAuthor && post.kind !== "offer" && !(post.poll && (post.poll.respondents > 0 || post.poll.state !== "open")) && <button className="block w-full rounded-xl px-3 py-2 text-left hover:bg-sage" onClick={() => openComposer(post.kind, post)}>Edit</button>}
            {post.viewer.isAuthor && <button className="block w-full rounded-xl px-3 py-2 text-left text-rose-800 hover:bg-sage" onClick={async () => { if (!confirm("Delete this post?")) return; await act(`/api/posts/${post.id}`, "DELETE"); toast("Post deleted."); }}>Delete</button>}
            {!post.viewer.isAuthor && <button className="block w-full rounded-xl px-3 py-2 text-left hover:bg-sage" onClick={() => setReportOpen(true)}>{tx("Report post")}</button>}
          </div>
        </details>
      </div>
      <div className="px-4">
        <div className="mb-1 flex flex-wrap gap-2 text-[11px] font-semibold uppercase tracking-wider text-goldink">
          <span>{kindLabel(post.kind)}</span>
          {post.listingKind && <span>{listingLabel(post.listingKind)}</span>}
        </div>
        {post.title ? <h2 className="font-serif text-xl font-semibold leading-snug"><Link href={href}>{translated.textFor("post_title", post.id, post.title)}</Link></h2> : null}
        {post.kind === "offer" && !detail ? <Link href={href} className="mt-2 inline-block rounded-full bg-gold px-3 py-1 text-sm font-semibold text-forest">{tx("View listing")}</Link> : null}
        {post.kind === "offer" && me && !post.viewer.isAuthor && post.availability !== "sold" && post.availability !== "unavailable" && post.availability !== "archived" && (
          <div className="mt-2 flex flex-wrap gap-2">
            {post.listingKind === "service" ? <button type="button" className="rounded-full bg-forest px-3 py-1 text-sm font-semibold text-ivory" onClick={() => setContact("time")}>{tx("Request a time")}</button> : null}
            <button type="button" className="rounded-full px-3 py-1 text-sm ring-1 ring-forest/20" onClick={() => setContact("message")}>{tx(post.listingKind === "service" ? "Message provider" : "Contact seller")}</button>
          </div>
        )}
        <p className="mt-1.5 whitespace-pre-wrap text-[15px] leading-relaxed text-forest/80">{translated.textFor("post_body", post.id, post.body)}</p>
        {translated.enabled && <TranslateButton on={translated.on} busy={translated.busy} onClick={translated.toggle} />}
        {post.poll && <PollChoices post={post} labelFor={(id, label) => translated.textFor("poll_option", id, label)} />}
        {post.priceLabel && <p className="mt-3 inline-flex rounded-full bg-sage px-3 py-1 text-sm font-semibold text-forest">{post.priceLabel}</p>}
        {post.kind === "offer" && (
          <p className="mt-2 text-sm text-forest/70">
            {post.availability && post.availability !== "available" ? `${post.availability[0].toUpperCase()}${post.availability.slice(1)}. ` : "Available. "}
            {post.condition ? `Condition: ${post.condition}. ` : ""}
            {post.quantity != null ? `Quantity ${post.quantity}. ` : ""}
            {post.handoff === "pickup" ? "Pickup preference." : post.handoff === "delivery" ? "Delivery is arranged in the inquiry. This app does not ship." : post.handoff === "either" ? "Pickup or a neighbor-arranged handoff." : "Payments are not available."}
          </p>
        )}
        {post.viewer.isAuthor && post.kind === "offer" && (
          <div className="mt-3 flex flex-wrap gap-2">
            {(["sold", "unavailable", "archived", "available"] as const).map((state) => (
              <button key={state} type="button" className="rounded-full bg-white px-3 py-1 text-sm ring-1 ring-forest/15" onClick={() => markAvailability(state)}>{state[0].toUpperCase() + state.slice(1)}</button>
            ))}
          </div>
        )}
        {editingListing && <div className="mt-3"><ProductForm existing={post} onDone={() => { setEditingListing(false); toast("Listing updated. Payments are still not available."); bump(); }} /></div>}
        {post.digital && <DigitalPanel postId={post.id} digital={post.digital} />}
        {post.kind === "offer" && post.quote && <OfferQuote post={post} />}
      </div>
      {post.group && <p className="px-4 pt-2 text-xs text-goldink"><Link href={`/g/${post.group.id}`} className="hover:underline">{post.group.name}</Link>{post.group.visibility === "private" ? " · private group" : " · group"}</p>}
      {(post.images?.length ? post.images : (post.mediaUrl ? [{ id: post.id, url: post.mediaUrl }] : [])).length > 0 && (
        <div className={`mx-4 mt-3 grid gap-2 ${ (post.images?.length || 0) > 1 ? "grid-cols-2" : ""}`}>
          {(post.images?.length ? post.images : [{ id: post.id, url: post.mediaUrl || "" }]).slice(0, 4).map((image, index) => (
            <button key={image.id} type="button" className="block overflow-hidden rounded-[24px]" onClick={() => setLightbox(image.url)} aria-label={post.title || "Open photo"}>
              <img src={image.url} alt={post.title || "Photo attached to this post"} className={`${(post.images?.length || 0) > 1 ? "aspect-square" : "aspect-[16/9]"} w-full object-cover`} />
              {index === 3 && (post.images?.length || 0) > 4 && <span className="sr-only">{(post.images?.length || 0) - 4} more photos</span>}
            </button>
          ))}
        </div>
      )}
        {post.coverHeadline ? <p className="px-4 pt-2 text-sm font-semibold">{post.coverHeadline}</p> : null}
        {(post.disclosureSponsor || post.disclosurePaid || post.disclosureAi || post.heldForReview) && (
          <div className="mx-4 mt-2 space-y-1 text-xs text-forest/80">
            {post.disclosureSponsor && <p>Sponsor disclosure. This does not mean Spekup paid anyone.</p>}
            {post.disclosurePaid && <p>Paid partnership. No payment is collected or sent by this app.</p>}
            {post.disclosureAi && <p>The creator marked this as AI-generated or AI-assisted.</p>}
            {post.heldForReview && <p>Held for a person to review. It is hidden from other people.</p>}
          </div>
        )}
        {post.video && (post.video.status === "ready" && post.video.fileUrl ? (
        <video ref={videoRef} aria-label={post.title || "Clip"} controls playsInline preload="none" poster={post.video.posterUrl || undefined} className="mx-4 mt-3 aspect-video w-[calc(100%-2rem)] rounded-[24px] bg-forest">
          <source src={post.video.fileUrl} type="video/mp4" />
          {post.captionUrl && <track kind="captions" src={post.captionUrl} srcLang="en" label="Captions" default />}
        </video>
      ) : (
        <div className="mx-4 mt-3 grid aspect-video place-items-center rounded-[24px] bg-forest px-6 text-center text-sm text-ivory" role="status">
          {post.video.status === "failed" ? (post.video.error || "This clip could not be prepared.") : "Preparing this clip. It stays private until it is ready, and it is not reviewed by a moderator."}
        </div>
      ))}
      {post.cards && post.cards.length > 0 && (
        <div className="mx-4 mt-3 space-y-2">
          {post.cards.map((card, index) => card.unavailable ? (
            <p key={index} className="rounded-2xl bg-sage px-3 py-2 text-sm">This card is no longer available.</p>
          ) : (
            <a key={card.targetId || index} href={card.kind === "cause" ? `/causes/${card.targetId}` : card.kind === "group" ? `/g/${card.targetId}` : card.kind === "event" ? `/event/${card.targetId}` : card.kind === "offer" ? `/listing/${card.targetId}` : card.kind === "ask" ? `/post/${card.targetId}` : "/playbooks"} className="block rounded-2xl bg-ivory px-3 py-2 text-sm ring-1 ring-forest/10">
              <b>{card.title}</b>
              <span className="mt-1 block text-xs text-forest/70">{card.note}</span>
            </a>
          ))}
        </div>
      )}
      {post.video && post.downloadAllowed === false && <p className="px-4 pt-2 text-xs text-forest/70">Downloads are hidden. This is a restriction, not copy protection. Screen recording is still possible.</p>}
      {post.video?.fileUrl && post.downloadAllowed !== false && <p className="px-4 pt-2 text-xs"><a href={`/api/videos/${post.video.id}/download`}>Download the prepared clip</a></p>}
      {post.playbook && <div className="px-4 pt-3"><PlaybookCard playbook={post.playbook} compact /></div>}
      <div className="mt-2 flex items-center gap-1 px-2 py-2 text-sm text-forest/70">
        <button aria-pressed={post.viewer.liked} onClick={() => act(`/api/posts/${post.id}/like`, post.viewer.liked ? "DELETE" : "POST")} className={`flex items-center gap-1.5 rounded-full px-3 py-2 hover:bg-sage ${post.viewer.liked ? "text-rose-700" : ""}`}><Icon n="heart" fill={post.viewer.liked} /><span className="sr-only">Like</span>{post.counts.likes}</button>
        <button aria-label="Comment" aria-expanded={open} onClick={toggleComments} className="flex items-center gap-1.5 rounded-full px-3 py-2 hover:bg-sage"><Icon n="chat" /><span>{post.counts.comments}</span></button>
        <button onClick={async () => { const url = `${location.origin}${href}`; const copied = post.poll ? "Link copied on this device. Nothing was posted elsewhere." : "Link copied."; try { await navigator.clipboard.writeText(url); toast(copied); } catch { toast(url); } }} className="flex items-center gap-1.5 rounded-full px-3 py-2 hover:bg-sage"><Icon n="share" />Share</button>
        <button onClick={() => act(`/api/posts/${post.id}/save`, post.viewer.saved ? "DELETE" : "POST")} className={`ml-auto flex items-center gap-1.5 rounded-full px-3 py-2 hover:bg-sage ${post.viewer.saved ? "text-goldink" : ""}`}><Icon n="saved" fill={post.viewer.saved} />{post.viewer.saved ? "Saved" : "Save"}</button>
      </div>
      {open && (
        <div className="border-t border-forest/10 px-4 py-3">
          {(comments || []).map((comment) => (
            <CommentLine key={comment.id} comment={comment} canReport={Boolean(me && !comment.viewerIsAuthor)} onReport={() => setCommentFlag(comment.id)} />
          ))}
          {me && post.commentsEnabled !== false ? (
            <form onSubmit={sendComment} className="flex gap-2">
              <input aria-label="Write a comment" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Write a comment…" className={fieldClass} />
              <button disabled={busy || !draft.trim()} className="rounded-full bg-forest px-4 text-sm font-semibold text-ivory disabled:opacity-40">Post</button>
            </form>
          ) : post.commentsEnabled === false ? <p className="text-sm text-forest/70">The creator turned comments off.</p> : <p className="text-sm text-forest/70"><Link href="/login" className="underline">Log in</Link> to comment.</p>}
          {post.kind !== "share" && (
            <div className="mt-4">
              <p className="text-sm font-semibold">{post.kind === "ask" ? "Respond to this ask" : "Inquire about this listing"}</p>
              <p className="mt-1 text-xs text-forest/70">Saved on Spekup only. Nothing is emailed or texted.</p>
              {(inquiries || []).map((item) => (
                <p key={item.id} className="mt-2 rounded-2xl bg-ivory px-3 py-2 text-sm ring-1 ring-forest/10"><b>{item.from?.displayName || "Neighbor"}</b> · {item.body}</p>
              ))}
              {me && !post.viewer.isAuthor && post.kind === "offer" && post.availability && post.availability !== "available" && <p className="mt-2 text-sm text-forest/70">Inquiries are closed while this listing is {post.availability}. Nothing was reserved or charged.</p>}
              {me && !post.viewer.isAuthor && post.availability !== "sold" && post.availability !== "unavailable" && post.availability !== "archived" && (
                <form onSubmit={sendInquiry} className="mt-2 space-y-2">
                  <textarea aria-label={post.kind === "ask" ? "Response" : "Inquiry"} value={reply} onChange={(e) => setReply(e.target.value)} rows={3} className={areaClass} placeholder={post.kind === "ask" ? "How you can help…" : "Question for the seller…"} />
                  <button disabled={busy || !reply.trim()} className="rounded-full bg-forest px-4 py-2 text-sm font-semibold text-ivory disabled:opacity-40">{post.kind === "ask" ? "Save response" : "Save inquiry"}</button>
                  {post.listingKind === "service" && <button type="button" disabled={busy || !reply.trim()} onClick={async () => { setBusy(true); try { await api(`/api/posts/${post.id}/inquiries`, { json: { body: reply, purpose: "booking_request" } }); setReply(""); toast("Booking request saved. You'll see replies here."); bump(); } catch (err) { toast(err instanceof Error ? err.message : "Couldn't save that."); } finally { setBusy(false); } }} className="rounded-full px-4 py-2 text-sm ring-1 ring-forest/20">Save time request</button>}
                </form>
              )}
              {!me && <p className="mt-2 text-sm text-forest/70"><Link href="/login" className="underline">Log in</Link> to respond.</p>}
            </div>
          )}
        </div>
      )}
      {reportOpen && <FlagDialog targetType="post" targetId={post.id} onClose={() => setReportOpen(false)} />}
      {commentFlag && <FlagDialog targetType="comment" targetId={commentFlag} onClose={() => setCommentFlag(null)} />}
      {contact && <ContactDialog postId={post.id} mode={contact} label={contact === "time" ? "Request a time" : post.listingKind === "service" ? "Message provider" : "Contact seller"} onClose={() => setContact("")} />}
    </Card>
  );
}

const FLAG_REASONS = [["spam", "Spam"], ["harassment", "Harassment"], ["scam", "Scam or fraud"], ["unsafe", "Unsafe"], ["misinformation", "Misinformation"], ["other", "Other"]] as const;

function FlagDialog({ targetType, targetId, onClose }: { targetType: "post" | "comment"; targetId: string; onClose: () => void }) {
  const { toast } = useApp();
  const [reason, setReason] = useState("spam");
  const [note, setNote] = useState("");
  const title = targetType === "comment" ? "Report comment" : "Report post";
  return (
    <form className="mx-4 mb-4 space-y-2 rounded-2xl bg-ivory p-3" role="dialog" aria-label={title} onSubmit={async (event) => {
      event.preventDefault();
      try {
        const row = await api<{ message: string }>("/api/flags", { json: { targetType, targetId, reason, note } });
        toast(row.message);
        onClose();
      } catch (err) { toast(err instanceof Error ? err.message : "Not saved."); }
    }}>
      <p className="text-sm font-semibold">{tx(title)}</p>
      <select aria-label={tx("Report reason")} className={fieldClass} value={reason} onChange={(e) => setReason(e.target.value)}>{FLAG_REASONS.map(([id, label]) => <option key={id} value={id}>{tx(label)}</option>)}</select>
      <textarea aria-label={tx("Report note")} value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder={tx("Optional note")} className={areaClass} />
      <div className="flex gap-2">
        <button className="rounded-full bg-forest px-4 py-2 text-sm font-semibold text-ivory">{tx("Save report")}</button>
        <button type="button" className="rounded-full px-4 py-2 text-sm ring-1 ring-forest/20" onClick={onClose}>{tx("Cancel")}</button>
      </div>
    </form>
  );
}

function ContactDialog({ postId, mode, label, onClose }: { postId: string; mode: "message" | "time"; label: string; onClose: () => void }) {
  const { toast } = useApp();
  const [body, setBody] = useState("");
  const [timeNote, setTimeNote] = useState("");
  return (
    <form className="mx-4 mb-4 space-y-2 rounded-2xl bg-ivory p-3" role="dialog" aria-label={label} onSubmit={async (event) => {
      event.preventDefault();
      try {
        const row = await api<{ threadId: string }>("/api/threads", { json: { postId, body, purpose: mode === "time" ? "booking_request" : "message", timeNote } });
        toast("You'll see replies here.");
        window.location.href = `/messages/${row.threadId}`;
      } catch (err) { toast(err instanceof Error ? err.message : "Not sent."); }
    }}>
      <p className="text-sm font-semibold">{label}</p>
      <p className="text-xs text-forest/70">You'll see replies here. Nothing is emailed.</p>
      {mode === "time" && <input aria-label="Proposed time" value={timeNote} onChange={(e) => setTimeNote(e.target.value)} placeholder="Optional time, such as Sunday afternoon" className={fieldClass} />}
      <textarea aria-label="Message" value={body} onChange={(e) => setBody(e.target.value)} rows={3} placeholder="Your message" className={areaClass} />
      <div className="flex gap-2">
        <button className="rounded-full bg-forest px-4 py-2 text-sm font-semibold text-ivory">Send</button>
        <button type="button" className="rounded-full px-4 py-2 text-sm ring-1 ring-forest/20" onClick={onClose}>Cancel</button>
      </div>
    </form>
  );
}
