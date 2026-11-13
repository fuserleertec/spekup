"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, rememberNext } from "@/lib/api";
import { tx } from "@/lib/i18n";
import { TOPICS, kindLabel } from "@/lib/format";
import type { Kind, Post, Topic } from "@/lib/types";
import { useApp } from "./context";
import { CauseCard, type Cause } from "./causes";
import { ComposeModal } from "./compose";
import { Mark } from "./icons";
import { PostCard } from "./post-card";
import { ClipForm } from "./publish";
import { Avatar, Chip, ChipRow, Empty, ErrorNote, Skeleton, orangeCta } from "./ui";

type Mode = "for_you" | "following";

export function SocialView({ video = false, projectId = "", compose = false }: { video?: boolean; projectId?: string; compose?: boolean }) {
  const { me, toast, bump, rev, openComposer } = useApp();
  const [mode, setMode] = useState<Mode>("for_you");
  const [format, setFormat] = useState<Kind | "video" | "">(video ? "video" : "");
  const [topic, setTopic] = useState<Topic | "">("");
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [causes, setCauses] = useState<Cause[]>([]);
  const [causesOnly, setCausesOnly] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [caughtUp, setCaughtUp] = useState(false);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState("");
  const [openClip, setOpenClip] = useState(compose || Boolean(projectId));
  const [interests, setInterests] = useState<string[]>([]);
  const [watchOptIn, setWatchOptIn] = useState(false);
  const [personalization, setPersonalization] = useState(true);
  const [guide, setGuide] = useState("");
  const [undoId, setUndoId] = useState<string | null>(null);
  const [draftOpen, setDraftOpen] = useState(false);
  const [draftKind, setDraftKind] = useState<Kind>("share");
  const [draftKey, setDraftKey] = useState(0);

  useEffect(() => {
    if (draftOpen) document.body.dataset.socialComposer = "open";
    else delete document.body.dataset.socialComposer;
    return () => { delete document.body.dataset.socialComposer; };
  }, [draftOpen]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setDraftOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if ((compose || projectId || new URLSearchParams(window.location.search).get("post") === "1") && me) setOpenClip(true);
    if (new URLSearchParams(window.location.search).get("video") === "1") setFormat("video");
    const requested = new URLSearchParams(window.location.search).get("mode");
    if (requested === "following" || requested === "for_you") setMode(requested);
  }, [me, compose, projectId]);

  useEffect(() => {
    if (!me) return;
    api<{ topics: string[]; watchOptIn: boolean; personalization: boolean }>("/api/feed/settings").then((row) => {
      setInterests(row.topics);
      setWatchOptIn(row.watchOptIn);
      setPersonalization(row.personalization);
    }).catch(() => undefined);
  }, [me, rev]);

  useEffect(() => {
    const params = new URLSearchParams();
    if (causesOnly) params.set("lens", "causes");
    else if (mode === "following") params.set("lens", "creators");
    else {
      params.set("lens", "for_you");
      params.set("ranking", "baseline");
    }
    if (!causesOnly && format === "video") params.set("video", "1");
    else if (!causesOnly && format) params.set("kind", format);
    if (topic) params.set("topic", topic);
    if (offset) params.set("offset", String(offset));
    let cancel = false;
    api<{ posts: Post[]; causes?: Cause[]; notice: string | null; page?: { caughtUp: boolean } }>(`/api/feed?${params}`).then((data) => {
      if (cancel) return;
      setCauses(data.causes || []);
      setPosts((current) => offset && current ? [...current, ...data.posts.filter((post) => !current.some((item) => item.id === post.id))] : data.posts);
      setNotice(data.notice);
      setCaughtUp(Boolean(data.page?.caughtUp));
      setError("");
    }).catch((err) => { if (!cancel) setError(err instanceof Error ? err.message : "Couldn't load Social."); });
    return () => { cancel = true; };
  }, [mode, format, topic, offset, rev, causesOnly]);

  async function saveInterests(next: string[]) {
    const row = await api<{ topics: string[] }>("/api/feed/interests", { method: "PUT", json: { topics: next } });
    setInterests(row.topics);
    setOffset(0);
    bump();
  }

  return (
    <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[180px_minmax(0,1fr)_300px] lg:gap-8" data-testid="social-layout">
      <div className="min-w-0 space-y-4 lg:col-start-2 lg:row-start-1">
      <HomeGreeting me={me} />
      <div className="rounded-[28px] bg-white p-4 ring-1 ring-forest/10" data-testid="home-composer">
        <div className="flex items-center gap-3">
          {me ? <Avatar user={me} className="h-10 w-10 shrink-0 rounded-full text-sm" /> : <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#1F362E]" aria-hidden="true"><Mark c="h-7 w-7" /></span>}
          <button type="button" className="w-full rounded-full bg-ivory px-4 py-2.5 text-left text-sm text-forest/70 ring-1 ring-forest/10" onClick={() => me ? (setDraftKind("share"), setDraftOpen(true)) : (window.location.href = "/login")}>{tx("Share something with the community")}</button>
        </div>
        <p className="mt-2 text-xs text-forest/70">{tx("Photos up to 8 MB. Clips up to 40 MB and 30 seconds. JPEG, PNG, WebP, GIF, HEIC, MP4, WebM, and MOV.")}</p>
        <div className="mt-3 flex flex-wrap gap-2 text-sm">
          <button type="button" data-testid="compose-share" className="rounded-full px-3 py-1.5 ring-1 ring-forest/15" onClick={() => me ? (setDraftKind("share"), setDraftOpen(true)) : (window.location.href = "/login")}>{tx("Share")}</button>
          <button type="button" data-testid="compose-photo" className="rounded-full px-3 py-1.5 ring-1 ring-forest/15" onClick={() => me ? (setDraftKind("share"), setDraftOpen(true)) : (window.location.href = "/login")}>{tx("Photo")}</button>
          <button type="button" data-testid="compose-video" className="rounded-full px-3 py-1.5 ring-1 ring-forest/15" onClick={() => me ? (setDraftKind("share"), setDraftOpen(true)) : (window.location.href = "/login")}>{tx("Clip")}</button>
          <button type="button" data-testid="compose-ask" className="rounded-full px-3 py-1.5 ring-1 ring-forest/15" onClick={() => me ? (setDraftKind("ask"), setDraftOpen(true)) : (window.location.href = "/login")}>{tx("Ask")}</button>
          <button type="button" data-testid="compose-offer" className="rounded-full px-3 py-1.5 ring-1 ring-forest/15" onClick={() => me ? (setDraftKind("offer"), setDraftOpen(true)) : (window.location.href = "/login")}>{tx("Offer")}</button>
          <button type="button" data-testid="compose-poll" className="rounded-full px-3 py-1.5 ring-1 ring-forest/15" onClick={() => me ? (setDraftKind("poll"), setDraftOpen(true)) : (window.location.href = "/login")}>{tx("Poll")}</button>
        </div>
        <div hidden={!draftOpen} role="dialog" aria-label={tx("Create a post")} data-testid="social-composer-sheet" className="z-40 rounded-2xl bg-ivory p-3 shadow-2xl max-lg:fixed max-lg:inset-x-3 max-lg:bottom-[5.75rem] max-lg:top-[8.5rem] max-lg:overflow-y-auto lg:relative lg:z-20 lg:mt-4 lg:max-h-none lg:overflow-visible lg:pb-3 lg:shadow-none">
          <div className="mb-2 flex justify-end"><button type="button" aria-label={tx("Close")} className="rounded-full px-3 py-1 text-sm ring-1 ring-forest/15" onClick={() => setDraftOpen(false)}>{tx("Close")}</button></div>
          <ComposeModal key={draftKey} kind={draftKind} onClose={() => { setDraftOpen(false); setDraftKey((value) => value + 1); }} />
        </div>
      </div>
      <HomeAround me={me} onAsk={() => { if (!me) { window.location.href = "/login"; return; } setDraftKind("ask"); setDraftOpen(true); }} />
      </div>
      <nav data-testid="feed-tabs" role="tablist" aria-label="Social feed" className="flex gap-2 overflow-x-auto pb-1 lg:sticky lg:top-24 lg:col-start-1 lg:row-start-1 lg:row-span-2 lg:flex-col">
        <button type="button" role="tab" aria-selected={mode === "for_you" && !causesOnly} className={tabClass(mode === "for_you" && !causesOnly)} onClick={() => { setMode("for_you"); setCausesOnly(false); setOffset(0); setPosts(null); }}>{tx("For You")}</button>
        <button type="button" role="tab" aria-selected={mode === "following"} className={tabClass(mode === "following")} onClick={() => { setMode("following"); setCausesOnly(false); setOffset(0); setPosts(null); }}>{tx("Following")}</button>
        <Link href="/groups" className={tabClass(false)}>{tx("Groups")}</Link>
        <Link href="/marketplace" className={tabClass(false)}>{tx("Marketplace")}</Link>
        <Link href="/help" className={tabClass(false)}>{tx("Help")}</Link>
        <Link href="/polls" className={tabClass(false)}>{tx("Polls")}</Link>
        <Link href="/events" className={tabClass(false)}>{tx("Events")}</Link>
      </nav>
      <div className="min-w-0 space-y-4 lg:col-start-2">
      <div className="flex flex-wrap gap-2">
        {me ? <button type="button" className="min-h-11 rounded-full border-2 border-[#C2410C] bg-[#FFF4E8] px-4 text-sm font-semibold text-[#9A3412]" onClick={() => openComposer("share")}>{tx("Write a post")}</button> : null}
        {me ? <button type="button" className={orangeCta} onClick={() => setOpenClip(true)}>{tx("Post a clip")}</button> : <Link href="/login" className={orangeCta} onClick={() => rememberNext(projectId ? `/studio/${projectId}` : compose ? "/studio" : video ? "/clips?post=1" : "/social?post=1")}>{tx("Log in to post a clip")}</Link>}
      </div>
      {openClip && me && <ClipForm projectId={projectId} onCancel={() => setOpenClip(false)} onDone={(post) => { setOpenClip(false); bump(); toast(post.video?.status === "ready" ? "Clip is ready." : post.video?.status === "failed" ? "The clip could not be prepared." : "Clip posted. It is still preparing."); }} />}
      <ChipRow>
        <Chip on={topic === ""} onClick={() => { setTopic(""); setOffset(0); setPosts(null); }}>{tx("All topics")}</Chip>
        {TOPICS.map((item) => <Chip key={item.id} on={topic === item.id} onClick={() => { setTopic(item.id); setOffset(0); setPosts(null); }}>{tx(item.label)}</Chip>)}
      </ChipRow>
      <ChipRow>
        <Chip on={format === ""} onClick={() => { setFormat(""); setOffset(0); setPosts(null); }}>{tx("All")}</Chip>
        <Chip on={format === "video"} onClick={() => { setFormat("video"); setOffset(0); setPosts(null); }}>{tx("Video")}</Chip>
        {(["share", "ask", "offer", "poll"] as Kind[]).map((item) => <Chip key={item} on={format === item && !causesOnly} onClick={() => { setFormat(item); setCausesOnly(false); setOffset(0); setPosts(null); }}>{tx(item === "share" ? "Shares" : item === "ask" ? "Asks" : item === "offer" ? "Offers" : "Polls")}</Chip>)}
        <Chip on={causesOnly} onClick={() => { setCausesOnly(true); setFormat(""); setOffset(0); setPosts(null); }}>{tx("Causes")}</Chip>
      </ChipRow>
      {me && (me.counts?.posts ?? 0) === 0 && <p className="text-sm text-forest/70">{tx("Your first post can be a note, a photo, or a short clip. It stays attached to your account.")}</p>}
      {mode === "for_you" && (
        <div className="rounded-[28px] bg-white p-4 text-sm ring-1 ring-forest/10">
          <p className="font-semibold">{tx("Interests")}</p>
          <p className="mt-1 text-forest/70">{tx("These are broad topics you choose. Watching a clip does not assign you a belief or a health condition.")}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {TOPICS.map((item) => (
              <button type="button" key={item.id} aria-pressed={interests.includes(item.id)} className={`rounded-full px-3 py-1 ${interests.includes(item.id) ? "bg-forest text-ivory" : "bg-sage"}`} onClick={() => me ? saveInterests(interests.includes(item.id) ? interests.filter((topicId) => topicId !== item.id) : [...interests, item.id]).catch((err) => toast(err instanceof Error ? err.message : "Not saved.")) : (window.location.href = "/login")}>{tx(item.label)}</button>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className="text-sm underline" onClick={() => api("/api/feed/interests", { method: "DELETE" }).then(() => { setInterests([]); bump(); })}>Clear interests</button>
            <button type="button" className="text-sm underline" onClick={() => api("/api/feed/history/reset", { method: "POST", json: {} }).then(() => { toast("Recommendation history cleared. Interests were kept."); bump(); })}>Reset recommendation history</button>
            <button type="button" className="text-sm underline" onClick={() => api<{ personalization: boolean }>("/api/feed/settings", { method: "PATCH", json: { personalization: !personalization, watchOptIn } }).then((row) => { setPersonalization(row.personalization); bump(); })}>{personalization ? "Use newest first" : "Use For You ranking"}</button>
          </div>
          <label className="mt-3 flex items-start gap-2">
            <input aria-label="Watch opt in" type="checkbox" checked={watchOptIn} onChange={(e) => { const next = e.target.checked; setWatchOptIn(next); api("/api/feed/settings", { method: "PATCH", json: { personalization, watchOptIn: next } }).then(() => toast(next ? "Watch counting is on." : "Watch counting stopped and stored watch totals were deleted.")).catch(() => setWatchOptIn(!next)); }} />
            <span>Count clips I choose to play. This is off until checked. It stores a daily total for 30 days, not a millisecond log. Turning it off deletes those totals.</span>
          </label>
          <button type="button" className="mt-2 text-sm underline" onClick={() => api<{ forYou: string }>("/api/feed/guide").then((row) => setGuide(row.forYou))}>How For You is ranked</button>
          {guide && <p className="mt-2 text-forest/70">{guide}</p>}
        </div>
      )}
      {mode === "following" && <p className="text-sm text-forest/70">Newest first. Only creators you follow. Cause, report, and poll follows stay on their own pages.</p>}
      {error && <ErrorNote>{error}</ErrorNote>}
      {notice === "login_required" && <Empty>Log in to see creators you follow. <Link href="/login" className="underline" onClick={() => rememberNext("/social?mode=following")}>Log in</Link></Empty>}
      {notice === "choose_creators" && <Empty>You are not following any creators yet. Follow someone from their profile. This list will not invent follows.</Empty>}
      {posts === null && !error && !notice ? <Skeleton /> : null}
      {posts && !notice && posts.length === 0 && <Empty>{tx("Nothing matches. An empty list is not a verdict.")}</Empty>}
      {causes.length > 0 && !notice && causes.map((cause) => <CauseCard key={cause.id} cause={cause} />)}
      {posts && !notice && posts.map((post) => (
        <div key={post.id} className="space-y-2">
          <PostCard post={post} watchOptIn={watchOptIn && mode === "for_you"} />
          {post.rank && (
            <details className="rounded-2xl bg-white px-4 py-2 text-sm ring-1 ring-forest/10">
              <summary>Why this post?</summary>
              <p className="mt-2 text-xs text-forest/70">Formula {post.rank.version}. Score {post.rank.score}. Mode {post.rank.mode}.</p>
              <ul className="mt-2 space-y-1">{post.rank.reasons.map((reason) => <li key={reason.code}><b>{reason.code}</b> weight {reason.weight}, value {reason.value}. {reason.text}</li>)}</ul>
            </details>
          )}
          {me && (
            <div className="flex flex-wrap gap-2 text-sm">
              <button type="button" className="underline" onClick={() => api("/api/feed/hides", { json: { postId: post.id } }).then(() => { setUndoId(post.id); setPosts((current) => current?.filter((item) => item.id !== post.id) || []); toast("Hidden from Social."); })}>Not interested</button>
              <button type="button" className="underline" onClick={() => api("/api/feed/hides", { json: { postId: post.id, topicLess: true } }).then(() => bump())}>Less of this topic</button>
              {!post.viewer.isAuthor && <button type="button" className="underline" onClick={() => api("/api/feed/mutes", { json: { handle: post.author.handle } }).then(() => { bump(); toast("Muted in Social. Their profile is still there."); })}>Mute creator</button>}
            </div>
          )}
        </div>
      ))}
      {undoId && <button type="button" className="underline" onClick={() => api(`/api/feed/hides/${undoId}`, { method: "DELETE" }).then(() => { setUndoId(null); setOffset(0); setPosts(null); bump(); })}>Undo hide</button>}
      {posts && posts.length > 0 && !caughtUp && <button type="button" className="rounded-full px-4 py-2 text-sm ring-1 ring-forest/20" onClick={() => setOffset((value) => value + 20)}>Load more</button>}
      {caughtUp && posts && posts.length > 0 && <p className="text-sm text-forest/70">You are caught up on this page. Nothing plays on its own.</p>}
      </div>
      <SocialRail posts={posts || []} />
    </div>
  );
}

function greetingKey(hour: number) {
  if (hour < 5 || hour >= 21) return "Hello, {{name}}";
  if (hour < 12) return "Good morning, {{name}}";
  if (hour < 17) return "Good afternoon, {{name}}";
  return "Good evening, {{name}}";
}

function HomeGreeting({ me }: { me: { displayName: string } | null }) {
  const [hour, setHour] = useState<number | null>(null);
  useEffect(() => { setHour(new Date().getHours()); }, []);
  const hello = tx("Hello, {{name}}", { name: me?.displayName || "" });
  return (
    <div>
      <h1 data-testid="home-greeting" className="font-serif text-3xl font-semibold tracking-tight sm:text-4xl">
        {me ? (hour === null ? hello : tx(greetingKey(hour), { name: me.displayName })) : tx("Welcome. This place is for neighbors, not a stage.")}
      </h1>
      <p className="mt-2 max-w-xl text-sm text-forest/80">
        {me ? tx("Share what matters to you, or ask for a hand.") : tx("Sign in to post, or create an account.")}
      </p>
      {!me && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Link href="/login" className="rounded-full bg-forest px-4 py-2 text-sm font-semibold text-ivory focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest focus-visible:ring-offset-2">{tx("Log in")}</Link>
          <Link href="/signup" className="rounded-full px-4 py-2 text-sm font-semibold ring-1 ring-forest/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest focus-visible:ring-offset-2">{tx("Create an account")}</Link>
        </div>
      )}
    </div>
  );
}

function HomeAround({ me, onAsk }: { me: { id: string } | null; onAsk: () => void }) {
  const [asks, setAsks] = useState<Post[] | null>(null);
  const [polls, setPolls] = useState<Post[] | null>(null);
  const [groups, setGroups] = useState<Array<{ id: string; name: string }>>([]);
  const [events, setEvents] = useState<Array<{ id: string; title: string; startsAt?: string }>>([]);
  useEffect(() => {
    let cancel = false;
    api<{ posts: Post[] }>("/api/feed?kind=ask").then((row) => { if (!cancel) setAsks((row.posts || []).slice(0, 3)); }).catch(() => { if (!cancel) setAsks([]); });
    api<{ posts: Post[] }>("/api/feed?kind=poll&pollStatus=open").then((row) => { if (!cancel) setPolls((row.posts || []).slice(0, 3)); }).catch(() => { if (!cancel) setPolls([]); });
    api<{ events: Array<{ id: string; title: string; startsAt?: string }> }>("/api/events").then((row) => {
      if (!cancel) setEvents((row.events || []).filter((event) => !event.startsAt || new Date(event.startsAt).getTime() > Date.now() - 3600000).slice(0, 3));
    }).catch(() => { if (!cancel) setEvents([]); });
    const groupsUrl = me ? "/api/groups?mine=1" : "/api/groups";
    api<{ groups: Array<{ id: string; name: string }> }>(groupsUrl).then(async (row) => {
      const own = row.groups || [];
      if (me && own.length === 0) {
        const pub = await api<{ groups: Array<{ id: string; name: string }> }>("/api/groups");
        if (!cancel) setGroups((pub.groups || []).slice(0, 3));
        return;
      }
      if (!cancel) setGroups(own.slice(0, 3));
    }).catch(() => { if (!cancel) setGroups([]); });
    return () => { cancel = true; };
  }, [me]);
  return (
    <section aria-label={tx("Nearby")} className="grid gap-3 sm:grid-cols-3">
      <div className="rounded-3xl bg-white p-4 ring-1 ring-forest/10">
        <h2 className="font-serif text-lg font-semibold">{tx("People you can help")}</h2>
        {asks === null ? <Skeleton /> : asks.length === 0 ? (
          <p className="mt-2 text-sm text-forest/70">{tx("No one is asking right now.")} <button type="button" className="underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest" onClick={onAsk}>{tx("Ask for a hand")}</button></p>
        ) : asks.map((post) => (
          <Link key={post.id} href={`/post/${post.id}`} className="mt-2 block rounded-xl px-1 py-1 text-sm hover:bg-sage focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest">
            <span className="font-semibold">{post.title || post.body}</span>
            {post.author?.displayName ? <span className="mt-0.5 block text-xs text-forest/70">{post.author.displayName}</span> : null}
          </Link>
        ))}
      </div>
      <div className="rounded-3xl bg-white p-4 ring-1 ring-forest/10">
        <h2 className="font-serif text-lg font-semibold">{tx("Open polls")}</h2>
        {polls === null ? <Skeleton /> : polls.length === 0 ? (
          <p className="mt-2 text-sm text-forest/70">{tx("No open poll yet.")} <Link href="/polls" className="underline">{tx("Write a poll")}</Link></p>
        ) : polls.map((post) => (
          <Link key={post.id} href={`/post/${post.id}`} className="mt-2 block rounded-xl px-1 py-1 text-sm hover:bg-sage focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest">
            <span className="font-semibold">{post.title}</span>
            {post.author?.displayName ? <span className="mt-0.5 block text-xs text-forest/70">{post.author.displayName}</span> : null}
          </Link>
        ))}
      </div>
      <div className="rounded-3xl bg-white p-4 ring-1 ring-forest/10">
        <h2 className="font-serif text-lg font-semibold">{tx("Nearby")}</h2>
        {groups.length === 0 && events.length === 0 ? (
          <p className="mt-2 text-sm text-forest/70">{tx("Nothing scheduled nearby.")} <Link href="/groups" className="underline">{tx("See groups")}</Link></p>
        ) : (
          <>
            {events.map((event) => <Link key={event.id} href={`/event/${event.id}`} className="mt-2 block text-sm font-semibold hover:underline">{event.title}</Link>)}
            {groups.map((group) => <Link key={group.id} href={`/g/${group.id}`} className="mt-2 block text-sm hover:underline">{group.name}</Link>)}
          </>
        )}
      </div>
    </section>
  );
}

function tabClass(on: boolean) {
  return `shrink-0 rounded-full px-5 py-2.5 text-left text-sm font-semibold shadow-[0_6px_18px_-10px_rgba(23,55,45,0.35)] ${on ? "bg-sage text-forest" : "bg-white text-forest ring-1 ring-forest/10"}`;
}

function SocialRail({ posts }: { posts: Post[] }) {
  const [groups, setGroups] = useState<Array<{ id: string; name: string; memberCount?: number }>>([]);
  const [events, setEvents] = useState<Array<{ id: string; title: string; place?: string; startsAt?: string; rsvpCount?: number }>>([]);
  useEffect(() => {
    api<{ groups: Array<{ id: string; name: string; memberCount?: number }> }>("/api/groups").then((row) => setGroups(row.groups || [])).catch(() => setGroups([]));
    api<{ events: Array<{ id: string; title: string; place?: string; startsAt?: string; rsvpCount?: number }> }>("/api/events").then((row) => setEvents((row.events || []).filter((event) => !event.startsAt || new Date(event.startsAt).getTime() > Date.now() - 86400000).slice(0, 3))).catch(() => setEvents([]));
  }, []);
  const counts = new Map<string, number>();
  for (const post of posts) counts.set(post.topic, (counts.get(post.topic) || 0) + 1);
  const trending = [...counts.entries()].filter(([, count]) => count > 0).sort((a, b) => b[1] - a[1]);
  return (
    <aside className="hidden space-y-5 lg:sticky lg:top-24 lg:col-start-3 lg:row-start-1 lg:row-span-2 lg:block" data-testid="social-rail">
      <div className="grid grid-cols-2 gap-3">
        <Link href="/marketplace" className="rounded-3xl bg-[#C2410C] p-4 text-ivory"><p className="mt-6 font-serif text-lg font-semibold">{tx("Market")}</p><p className="text-xs text-ivory/80">{tx("Goods and files")}</p></Link>
        <Link href="/help" className="rounded-3xl bg-forest p-4 text-ivory"><p className="mt-6 font-serif text-lg font-semibold">{tx("Help")}</p><p className="text-xs text-ivory/80">{tx("Asks and causes")}</p></Link>
      </div>
      <div className="rounded-3xl bg-white p-5 ring-1 ring-forest/10">
        <div className="flex items-center justify-between"><h3 className="font-serif text-lg font-semibold">{tx("Upcoming gatherings")}</h3><Link href="/events" className="text-xs font-semibold text-[#9A3412]">{tx("See all")}</Link></div>
        {events.length === 0 ? <p className="mt-3 text-sm text-forest/70">{tx("No gatherings yet.")}</p> : events.map((event) => (
          <Link key={event.id} href={`/event/${event.id}`} className="mt-3 block text-sm"><b>{event.title}</b><span className="mt-0.5 block text-xs text-forest/70">{event.place || "Gathering"}{event.rsvpCount != null ? ` · ${event.rsvpCount} going` : ""}</span></Link>
        ))}
      </div>
      {trending.length > 0 && (
        <div className="rounded-3xl bg-white p-5 ring-1 ring-forest/10" data-testid="trending-topics">
          <h3 className="font-serif text-lg font-semibold">{tx("Topics in this page")}</h3>
          <div className="mt-3 flex flex-wrap gap-2">{trending.map(([topic, count]) => <span key={topic} className="rounded-full bg-sage px-3 py-1 text-sm font-semibold text-forest">{topic.replaceAll("_", " ")} <span className="text-xs text-forest/60">{count}</span></span>)}</div>
        </div>
      )}
      <div className="rounded-3xl bg-white p-5 ring-1 ring-forest/10" data-testid="groups-rail">
        <div className="flex items-center justify-between"><h3 className="font-serif text-lg font-semibold">{tx("Groups")}</h3><Link href="/groups" className="text-xs font-semibold text-[#9A3412]">{tx("See all")}</Link></div>
        {groups.length === 0 ? <p className="mt-3 text-sm text-forest/70">{tx("No groups yet.")}</p> : groups.slice(0, 6).map((group) => (
          <Link key={group.id} href={`/g/${group.id}`} className="mt-3 block text-sm font-semibold">{group.name}</Link>
        ))}
      </div>
    </aside>
  );
}
