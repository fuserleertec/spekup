"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ApiError, api, rememberNext, takeNext } from "@/lib/api";
import { tx } from "@/lib/i18n";
import { LISTING_KINDS, PRICE_MODES, ROLES, TOPICS, kindLabel, roleLabel } from "@/lib/format";
import type { Inquiry, Kind, ListingKind, Playbook, Post, PriceMode, Topic, User } from "@/lib/types";
import { useApp } from "./context";
import { ComposeModal } from "./compose";
import { PostCard } from "./post-card";
import { CauseCard, CauseFilters, CauseForm, ProfileCauses, useCauses, type Cause } from "./causes";
import { ProfileReports } from "./reports";
import { ProductForm } from "./publish";
import { Avatar, Card, Chip, ChipRow, Empty, ErrorNote, Heading, PlaybookCard, Skeleton, ThreeColumn, areaClass, choiceClass, fieldClass, orangeCta } from "./ui";

function useQueryState<T>(initial: T) {
  return useState(initial);
}

export function FeedView({ lens }: { lens: "for_you" | "following" | "groups" | "professionals" }) {
  const { q, setQ, me, openComposer, toast } = useApp();
  const [topic, setTopic] = useQueryState<Topic | "">("");
  const [kind, setKind] = useQueryState<Kind | "">("");
  const [causesOnly, setCausesOnly] = useState(false);
  const [priceMode, setPriceMode] = useQueryState<PriceMode | "">("");
  const [lensState, setLens] = useState(lens);
  useEffect(() => { setLens(lens); }, [lens]);
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [causes, setCauses] = useState<Cause[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState("");
  const { rev } = useApp();
  const lensParam = lensState;

  useEffect(() => {
    const params = new URLSearchParams();
    if (causesOnly) {
      params.set("lens", "causes");
      if (lensParam === "following") params.set("following", "1");
    } else {
      params.set("lens", lensParam);
      if (topic) params.set("topic", topic);
      if (kind) params.set("kind", kind);
      if (priceMode) params.set("priceMode", priceMode);
    }
    if (q.trim()) params.set("q", q.trim());
    let cancel = false;
    api<{ posts: Post[]; causes?: Cause[]; notice: string | null }>(`/api/feed?${params}`).then((data) => {
      if (cancel) return;
      setPosts(data.posts);
      setCauses(data.causes || []);
      setNotice(data.notice);
      setError("");
    }).catch((err) => { if (!cancel) setError(err instanceof Error ? err.message : "Couldn't load the feed."); }).finally(() => undefined);
    return () => { cancel = true; };
  }, [lensParam, topic, kind, priceMode, causesOnly, q, rev]);

  return (
    <div className="space-y-5">
      <div className="reveal relative overflow-hidden rounded-[32px] bg-gradient-to-br from-forest via-[#1f4a3c] to-[#2c5a47] p-7 text-ivory">
        <div className="relative">
          <p className="text-xs font-semibold uppercase tracking-[.2em] text-gold">Neighbors, in their own words</p>
          <h1 className="mt-1 font-serif text-3xl font-semibold sm:text-4xl">{tx("Discover. Share. Help. Thrive.")}</h1>
          <p className="mt-2 max-w-md text-sm text-ivory/80">A community space for residents, organizers, civic professionals, and neighborhood businesses. Not a government agency.</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Link href={me ? `/u/${me.handle}` : "/signup"} className="lift reveal col-span-2 rounded-[28px] bg-forest p-5 text-left text-ivory">
          <p className="text-xs uppercase tracking-widest text-gold">{me ? "Your activity" : "Join in"}</p>
          <p className="mt-1 font-serif text-xl">{me ? `${me.counts?.posts ?? 0} posts · ${me.counts?.asks ?? 0} asks` : "Create an account to post"}</p>
          <p className="mt-2 text-xs text-ivory/70">{me ? `${me.counts?.listings ?? 0} listings. Counts are yours, not a streak.` : "Posts, asks, and offers stay attached to you."}</p>
        </Link>
        <Link href="/polls" className="lift reveal rounded-[28px] bg-white p-4 text-left ring-1 ring-forest/10">
          <p className="text-[10px] uppercase tracking-widest text-goldink">Polls</p>
          <p className="mt-1 font-serif text-lg leading-tight">Community opinions</p>
        </Link>
        <Link href="/reports" className="lift reveal rounded-[28px] bg-gradient-to-br from-sage to-white p-4 text-left ring-1 ring-forest/10">
          <p className="text-[10px] uppercase tracking-widest text-goldink">Reports</p>
          <p className="mt-1 font-serif text-lg leading-tight">Sourced allegations</p>
        </Link>
        <Link href="/marketplace" className="lift reveal rounded-[28px] bg-white p-4 text-left ring-1 ring-forest/10">
          <p className="text-[10px] uppercase tracking-widest text-goldink">Marketplace</p>
          <p className="mt-1 font-serif text-lg leading-tight">Goods, guides, services</p>
        </Link>
      </div>
      <Card className="p-4">
        <div className="flex items-center gap-3">
          <Avatar user={me || { displayName: "?", avatarUrl: null }} className="h-10 w-10 rounded-full text-sm" />
          <button onClick={() => me ? openComposer("share") : (window.location.href = "/login")} className="flex-1 rounded-full bg-ivory px-4 py-2.5 text-left text-sm text-forest/70 ring-1 ring-forest/10">Share something with your neighbors…</button>
        </div>
        <div className="mt-3 flex flex-wrap gap-1 text-xs text-forest/70">
          <button data-testid="compose-share" onClick={() => me ? openComposer("share") : (window.location.href = "/login")} className="rounded-full px-3 py-1.5 hover:bg-sage">Share</button>
          <button data-testid="compose-ask" onClick={() => me ? openComposer("ask") : (window.location.href = "/login")} className="rounded-full px-3 py-1.5 hover:bg-sage">Ask</button>
          <button data-testid="compose-offer" onClick={() => me ? openComposer("offer") : (window.location.href = "/login")} className="rounded-full px-3 py-1.5 hover:bg-sage">Offer</button>
          <button data-testid="compose-photo" onClick={() => me ? openComposer("share") : (window.location.href = "/login")} className="rounded-full px-3 py-1.5 hover:bg-sage">Photo</button>
          <button data-testid="compose-video" onClick={() => me ? openComposer("share") : (window.location.href = "/login")} className="rounded-full px-3 py-1.5 hover:bg-sage">Clip</button>
          <button data-testid="compose-poll" onClick={() => me ? openComposer("poll") : (window.location.href = "/login")} className="rounded-full px-3 py-1.5 hover:bg-sage">Poll</button>
        </div>
      </Card>
      <div className="flex gap-1 rounded-full bg-white p-1 text-[11px] ring-1 ring-forest/10 sm:text-sm">
        {([["for_you", "For You"], ["following", "Following"], ["groups", "Groups"], ["professionals", "Professionals"]] as const).map(([id, label]) => (
          <button key={id} onClick={() => setLens(id)} className={`flex-1 rounded-full py-2 text-center font-medium ${lensState === id ? "bg-forest text-ivory" : "text-forest/70 hover:bg-sage"}`}>{label}</button>
        ))}
      </div>
      <ChipRow>
        <Chip on={kind === "" && !causesOnly} onClick={() => { setKind(""); setCausesOnly(false); }}>All</Chip>
        {(["share", "ask", "offer", "poll"] as Kind[]).map((item) => <Chip key={item} on={kind === item && !causesOnly} onClick={() => { setKind(item); setCausesOnly(false); }}>{kindLabel(item)}s</Chip>)}
        <Chip on={causesOnly} onClick={() => { setKind(""); setCausesOnly(true); }}>Causes</Chip>
      </ChipRow>
      <ChipRow>
        <Chip on={topic === ""} onClick={() => setTopic("")}>All topics</Chip>
        {TOPICS.map((item) => <Chip key={item.id} on={topic === item.id} onClick={() => setTopic(item.id)}>{item.label}</Chip>)}
      </ChipRow>
      <ChipRow>
        <Chip on={priceMode === ""} onClick={() => setPriceMode("")}>Any exchange</Chip>
        {PRICE_MODES.map((item) => <Chip key={item.id} on={priceMode === item.id} onClick={() => setPriceMode(item.id)}>{item.label}</Chip>)}
      </ChipRow>
      {q && <p className="text-sm text-forest/70">Results for “{q}” · <button className="underline" onClick={() => setQ("")}>clear</button></p>}
      {error && <ErrorNote>{error}</ErrorNote>}
      {notice === "groups_not_enabled" && <Empty>Groups are not enabled in this preview. This lens stays empty until neighborhood groups exist. No sample clubs are shown.</Empty>}
      {notice === "login_required" && <Empty>Log in to see people you follow. <Link href="/login" className="underline">Log in</Link></Empty>}
      {posts === null && !error ? <Skeleton /> : null}
      {posts && !notice && posts.length === 0 && causes.length === 0 && <Empty>{causesOnly ? "No visible causes in this filter. An empty list is not a fundraising result." : "No posts here yet. Share something happening nearby, ask for a hand, or offer one."}</Empty>}
      {posts && !notice && [...posts.map((post) => ({ type: "post" as const, at: post.createdAt, key: `post-${post.id}`, post, cause: null as Cause | null })), ...causes.map((cause) => ({ type: "cause" as const, at: cause.createdAt || "", key: `cause-${cause.id}`, post: null as Post | null, cause }))].sort((a, b) => b.at.localeCompare(a.at)).map((item) => item.type === "post" && item.post ? <PostCard key={item.key} post={item.post} /> : item.cause ? <CauseCard key={item.key} cause={item.cause} /> : null)}
    </div>
  );
}

export function PollsView() {
  const { q, setQ, me, rev } = useApp();
  const [subject, setSubject] = useState("");
  const [status, setStatus] = useState("");
  const [following, setFollowing] = useState(false);
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [draftOpen, setDraftOpen] = useState(false);
  const [draftKey, setDraftKey] = useState(0);
  useEffect(() => {
    if (me && new URLSearchParams(window.location.search).get("compose") === "1") setDraftOpen(true);
  }, [me]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setDraftOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    const params = new URLSearchParams({ lens: "polls" });
    if (subject) params.set("subjectType", subject);
    if (status) params.set("pollStatus", status);
    if (following) params.set("following", "1");
    if (q.trim()) params.set("q", q.trim());
    let cancel = false;
    api<{ posts: Post[]; notice: string | null }>(`/api/feed?${params}`).then((data) => {
      if (cancel) return;
      setPosts(data.posts);
      setNotice(data.notice);
      setError("");
    }).catch((err) => { if (!cancel) setError(err instanceof Error ? err.message : "Couldn't load polls."); });
    return () => { cancel = true; };
  }, [subject, status, following, q, rev]);
  function openPoll() {
    if (!me) { rememberNext("/polls?compose=1"); window.location.href = "/login"; return; }
    setDraftOpen(true);
  }
  return (
    <ThreeColumn
      id="polls"
      label="Poll filters"
      rail={
        <div className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible">
          <button type="button" onClick={() => setFollowing((value) => !value)} className={choiceClass(following)}>Following</button>
          <button type="button" onClick={() => setSubject("")} className={choiceClass(subject === "")}>All subjects</button>
          <button type="button" onClick={() => setSubject("politician")} className={choiceClass(subject === "politician")}>Politician</button>
          <button type="button" onClick={() => setSubject("corporation")} className={choiceClass(subject === "corporation")}>Corporation</button>
          <button type="button" onClick={() => setSubject("community")} className={choiceClass(subject === "community")}>Community</button>
          <button type="button" onClick={() => setStatus("")} className={choiceClass(status === "")}>Any status</button>
          <button type="button" onClick={() => setStatus("open")} className={choiceClass(status === "open")}>Open</button>
          <button type="button" onClick={() => setStatus("closed")} className={choiceClass(status === "closed")}>Closed</button>
          <button type="button" onClick={() => setStatus("expired")} className={choiceClass(status === "expired")}>Closed by time</button>
          <button type="button" onClick={() => setStatus("canceled")} className={choiceClass(status === "canceled")}>Canceled</button>
        </div>
      }
      side={<PollRail posts={posts || []} />}
    >
      <Heading sub={tx("Opinions and priorities from people with accounts. Not an election, not a representative sample, and not a finding about anyone. Sourced allegations stay in Reports.")}>{tx("Polls")}</Heading>
      <div className="rounded-[28px] bg-white p-4 ring-1 ring-forest/10" data-testid="polls-composer">
        <button type="button" className="w-full rounded-full bg-ivory px-4 py-2.5 text-left text-sm text-forest/70 ring-1 ring-forest/10" onClick={openPoll}>Ask the neighborhood</button>
        <div className="mt-3 flex flex-wrap gap-2">
          {me && <button type="button" onClick={openPoll} className={orangeCta}>Write a poll</button>}
          {!me && <Link href="/login" className={orangeCta} onClick={() => rememberNext("/polls?compose=1")}>Log in to write a poll</Link>}
        </div>
        <div hidden={!draftOpen} role="dialog" aria-label="Create a post" className="relative z-20 mt-4 rounded-2xl bg-ivory p-3 pb-28 lg:pb-3">
          <div className="mb-2 flex justify-end"><button type="button" aria-label="Close" className="rounded-full px-3 py-1 text-sm ring-1 ring-forest/15" onClick={() => setDraftOpen(false)}>Close</button></div>
          <ComposeModal key={draftKey} kind="poll" onClose={() => { setDraftOpen(false); setDraftKey((value) => value + 1); }} />
        </div>
      </div>
      <Card className="p-4 text-sm text-forest/80">One account can hold one current choice. That is not identity verification. Ballots stay private. Totals are respondents, and they update when you refresh. Nothing here is emailed or posted elsewhere.</Card>
      {q && <p className="text-sm text-forest/70">Results for “{q}” · <button className="underline" onClick={() => setQ("")}>clear</button></p>}
      {error && <ErrorNote>{error}</ErrorNote>}
      {notice === "login_required" && <Empty>Log in to see polls you follow. <Link href="/login" className="underline">Log in</Link></Empty>}
      {posts === null && !error ? <Skeleton /> : null}
      {posts && !notice && posts.length === 0 && <Empty>No polls match. An empty list means nobody has posted one, not that a question is settled.</Empty>}
      {posts && !notice && posts.map((post) => <PostCard key={post.id} post={post} />)}
    </ThreeColumn>
  );
}

function PollRail({ posts }: { posts: Post[] }) {
  const open = posts.filter((post) => post.poll?.state === "open");
  const soon = open.filter((post) => post.poll?.closesAt && new Date(post.poll.closesAt).getTime() > Date.now()).sort((a, b) => new Date(a.poll?.closesAt || 0).getTime() - new Date(b.poll?.closesAt || 0).getTime());
  return (
    <>
      <div className="rounded-3xl bg-white p-5 ring-1 ring-forest/10">
        <h3 className="font-serif text-lg font-semibold">Active polls</h3>
        {open.length === 0 ? <p className="mt-3 text-sm text-forest/70">No open polls.</p> : open.slice(0, 3).map((post) => (
          <div key={post.id} className="mt-3">
            <p className="text-sm font-semibold">{post.title}</p>
            <p className="text-xs text-forest/70">{post.poll?.respondents ?? 0} {post.poll?.respondents === 1 ? "respondent" : "respondents"}</p>
          </div>
        ))}
      </div>
      <div className="rounded-3xl bg-white p-5 ring-1 ring-forest/10">
        <h3 className="font-serif text-lg font-semibold">Closing soon</h3>
        {soon.length === 0 ? <p className="mt-3 text-sm text-forest/70">No open poll has a close time.</p> : soon.slice(0, 3).map((post) => (
          <div key={post.id} className="mt-3">
            <p className="text-sm font-semibold">{post.title}</p>
            <p className="text-xs text-forest/70">Closes {new Date(post.poll?.closesAt || "").toLocaleString()}</p>
          </div>
        ))}
      </div>
    </>
  );
}

export function MarketView({ startDigital = false }: { startDigital?: boolean }) {
  const { q, setQ, me, bump, toast } = useApp();
  const [posting, setPosting] = useState(startDigital);
  useEffect(() => {
    if (me && (startDigital || new URLSearchParams(window.location.search).get("post") === "1")) setPosting(true);
  }, [me, startDigital]);
  const [topic, setTopic] = useState<Topic | "">("");
  const [kind, setKind] = useState<ListingKind | "">("");
  const [priceMode, setPriceMode] = useState<PriceMode | "">("");
  const [listings, setListings] = useState<Post[] | null>(null);
  const [error, setError] = useState("");
  const { rev } = useApp();
  useEffect(() => {
    const params = new URLSearchParams();
    if (topic) params.set("topic", topic);
    if (kind) params.set("listingKind", kind);
    if (priceMode) params.set("priceMode", priceMode);
    if (q.trim()) params.set("q", q.trim());
    let cancel = false;
    api<{ listings: Post[] }>(`/api/listings?${params}`).then((data) => { if (!cancel) { setListings(data.listings); setError(""); } }).catch((err) => { if (!cancel) setError(err.message); });
    return () => { cancel = true; };
  }, [topic, kind, priceMode, q, rev]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setPosting(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  function openListing() {
    if (!me) { rememberNext(startDigital ? "/shop/new" : "/marketplace?post=1"); window.location.href = "/login"; return; }
    setPosting(true);
  }
  return (
    <ThreeColumn
      id="market"
      label="Marketplace filters"
      rail={
        <div className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible">
          <button type="button" onClick={() => setKind("")} className={choiceClass(kind === "")}>All</button>
          {LISTING_KINDS.map((item) => <button type="button" key={item.id} onClick={() => setKind(item.id)} className={choiceClass(kind === item.id)}>{item.label}</button>)}
          <button type="button" onClick={() => setTopic("")} className={choiceClass(topic === "")}>All topics</button>
          {TOPICS.map((item) => <button type="button" key={item.id} onClick={() => setTopic(item.id)} className={choiceClass(topic === item.id)}>{item.label}</button>)}
          <button type="button" onClick={() => setPriceMode("")} className={choiceClass(priceMode === "")}>Any exchange</button>
          {PRICE_MODES.map((item) => <button type="button" key={item.id} onClick={() => setPriceMode(item.id)} className={choiceClass(priceMode === item.id)}>{item.label}</button>)}
        </div>
      }
      side={<MarketRail listings={listings || []} />}
    >
      <Heading sub={tx("Local goods, digital guides, and services from neighbors. Prices are what sellers wrote. Payments are not available.")}>{tx("Marketplace")}</Heading>
      <div className="rounded-[28px] bg-white p-4 ring-1 ring-forest/10" data-testid="market-composer">
        <button type="button" className="w-full rounded-full bg-ivory px-4 py-2.5 text-left text-sm text-forest/70 ring-1 ring-forest/10" onClick={openListing}>List a good, a file, or a service</button>
        <div className="mt-3 flex flex-wrap gap-2">
          {me ? <button type="button" className={orangeCta} onClick={openListing}>{tx("Post a product")}</button> : <Link href="/login" className={orangeCta} onClick={() => rememberNext(startDigital ? "/shop/new" : "/marketplace?post=1")}>{tx("Log in to post a product")}</Link>}
        </div>
        <div hidden={!posting || !me} role="dialog" aria-label="Post a product" className="relative z-20 mt-4 rounded-2xl bg-ivory p-3 pb-28 lg:pb-3">
          <div className="mb-2 flex justify-end"><button type="button" aria-label="Close" className="rounded-full px-3 py-1 text-sm ring-1 ring-forest/15" onClick={() => setPosting(false)}>Close</button></div>
          <ProductForm initialKind={startDigital ? "digital" : "physical"} onDone={(post) => { setPosting(false); bump(); toast(`Listing saved. Payments are not available. ${post.availability === "available" ? "Neighbors can inquire." : "It is hidden from the marketplace while archived."}`); }} />
        </div>
      </div>
      {q && <p className="text-sm text-forest/70">Results for “{q}” · <button className="underline" onClick={() => setQ("")}>clear</button></p>}
      {error && <ErrorNote>{error}</ErrorNote>}
      {listings === null && !error ? <Skeleton /> : null}
      {listings && listings.length === 0 && <Empty>No listings yet. An offer of a local good, digital guide, or service will show up here.</Empty>}
      {listings?.map((item) => <PostCard key={item.id} post={item} />)}
    </ThreeColumn>
  );
}

function MarketRail({ listings }: { listings: Post[] }) {
  return (
    <>
      <div className="rounded-3xl bg-white p-5 ring-1 ring-forest/10">
        <h3 className="font-serif text-lg font-semibold">Recent listings</h3>
        {listings.length === 0 ? <p className="mt-3 text-sm text-forest/70">No listings yet.</p> : listings.slice(0, 4).map((item) => (
          <div key={item.id} className="mt-3">
            <p className="text-sm font-semibold">{item.title}</p>
            <p className="text-xs text-forest/70">{item.author.displayName}{item.priceLabel ? ` · ${item.priceLabel}` : ""}</p>
            <Link href={`/listing/${item.id}`} aria-label="Open this listing" className="text-xs font-semibold text-[#9A3412]">Open</Link>
          </div>
        ))}
      </div>
      <div className="rounded-3xl bg-forest p-5 text-sm text-ivory">
        <h3 className="font-serif text-lg font-semibold">Seller tips</h3>
        <p className="mt-2 text-ivory/85">A fixed price shows a 5% quote before anyone saves interest. That quote is not a charge. Payments are off. A paid file stays locked. A free file can be claimed.</p>
      </div>
    </>
  );
}

export function PostDetail({ id }: { id: string }) {
  const [post, setPost] = useState<Post | null>(null);
  const [error, setError] = useState("");
  const { rev } = useApp();
  useEffect(() => {
    let cancel = false;
    api<{ post: Post }>(`/api/posts/${id}`).then((data) => { if (!cancel) setPost(data.post); }).catch((err) => { if (!cancel) setError(err instanceof Error ? err.message : "Not found."); });
    return () => { cancel = true; };
  }, [id, rev]);
  if (error) return <Empty>{error}</Empty>;
  if (!post) return <Skeleton />;
  return (
    <div className="space-y-4">
      <Link href={post.kind === "offer" ? "/marketplace" : post.kind === "poll" ? "/polls" : "/"} className="text-sm text-goldink hover:underline">{post.kind === "offer" ? "Back to marketplace" : post.kind === "poll" ? "Back to polls" : "Back to the feed"}</Link>
      <PostCard post={post} detail />
    </div>
  );
}

export function HelpView({ tab = "asks" }: { tab?: "asks" | "causes" }) {
  const { q, setQ, me } = useApp();
  const router = useRouter();
  const board = useCauses();
  const [shown, setShown] = useState(tab);
  const [helpKind, setHelpKind] = useState<"" | "ask" | "offer">("");
  const [draftOpen, setDraftOpen] = useState(false);
  const [draftKind, setDraftKind] = useState<Kind>("ask");
  const [draftKey, setDraftKey] = useState(0);
  const [causeOpen, setCauseOpen] = useState(false);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setDraftOpen(false);
      setCauseOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    const query = new URLSearchParams(window.location.search).get("tab");
    setShown(tab === "causes" || query === "causes" ? "causes" : "asks");
  }, [tab]);
  const [asks, setAsks] = useState<Post[] | null>(null);
  const [people, setPeople] = useState<(User & { viewerFollowing?: boolean })[] | null>(null);
  const { rev, bump, toast } = useApp();
  useEffect(() => {
    if (shown !== "asks") return;
    const params = new URLSearchParams({ lens: "help" });
    if (helpKind) params.set("kind", helpKind);
    if (q.trim()) params.set("q", q.trim());
    api<{ posts: Post[] }>(`/api/feed?${params}`).then((data) => setAsks(data.posts)).catch(() => setAsks([]));
    const peopleParams = q.trim() ? `?q=${encodeURIComponent(q.trim())}` : "";
    api<{ people: (User & { viewerFollowing?: boolean })[] }>(`/api/professionals${peopleParams}`).then((data) => setPeople(data.people)).catch(() => setPeople([]));
  }, [q, rev, shown, helpKind]);
  function showAsks() { setShown("asks"); router.push("/help"); }
  function showCauses() { setShown("causes"); router.push("/help?tab=causes"); }
  function openAsk(kind: Kind) {
    if (!me) { rememberNext("/help"); window.location.href = "/login"; return; }
    setDraftKind(kind);
    setDraftOpen(true);
    setCauseOpen(false);
    showAsks();
  }
  function openCause() {
    if (!me) { rememberNext("/help?tab=causes"); window.location.href = "/login"; return; }
    setCauseOpen(true);
    setDraftOpen(false);
    showCauses();
  }
  return (
    <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[180px_minmax(0,1fr)_300px] lg:gap-8" data-testid="help-layout">
      <nav data-testid="help-tabs" aria-label="Help sections" className="flex min-w-0 flex-col gap-3 lg:sticky lg:top-24">
        <div role="tablist" aria-label="Help" className="flex gap-2 overflow-x-auto pb-1 lg:flex-col">
          <button role="tab" id="help-tab-asks" aria-selected={shown === "asks"} aria-controls="help-panel" onClick={showAsks} className={helpTab(shown === "asks")}>Ask & Offer</button>
          <button role="tab" id="help-tab-causes" aria-selected={shown === "causes"} aria-controls="help-panel" onClick={showCauses} className={helpTab(shown === "causes")}>Community Causes</button>
        </div>
        {shown === "asks" ? (
          <div className="flex gap-2 overflow-x-auto lg:flex-col">
            <button type="button" onClick={() => setHelpKind("")} className={filterTab(helpKind === "")}>Asks and offers</button>
            <button type="button" onClick={() => setHelpKind("ask")} className={filterTab(helpKind === "ask")}>Asks</button>
            <button type="button" onClick={() => setHelpKind("offer")} className={filterTab(helpKind === "offer")}>Offers</button>
          </div>
        ) : <CauseFilters board={board} />}
      </nav>
      <div className="min-w-0 space-y-4" role="tabpanel" id="help-panel" aria-labelledby={shown === "causes" ? "help-tab-causes" : "help-tab-asks"}>
        <Heading sub={tx("Ask for a hand, offer one, or follow a community cause. A cause pledge is not money collected. Self-described roles are not verification.")}>{tx("Help")}</Heading>
        <div className="rounded-[28px] bg-white p-4 ring-1 ring-forest/10" data-testid="help-composer">
          <button type="button" className="w-full rounded-full bg-ivory px-4 py-2.5 text-left text-sm text-forest/70 ring-1 ring-forest/10" onClick={() => openAsk("ask")}>Ask for help or offer some</button>
          <div className="mt-3 flex flex-wrap gap-2 text-sm">
            <button type="button" className="rounded-full px-3 py-1.5 ring-1 ring-forest/15" onClick={() => openAsk("ask")}>Ask</button>
            <button type="button" className="rounded-full px-3 py-1.5 ring-1 ring-forest/15" onClick={() => openAsk("offer")}>Offer</button>
            <button type="button" className="rounded-full px-3 py-1.5 ring-1 ring-forest/15" onClick={openCause}>Start a cause</button>
          </div>
          <div hidden={!draftOpen} role="dialog" aria-label="Create a post" className="relative z-20 mt-4 rounded-2xl bg-ivory p-3 pb-28 lg:pb-3">
            <div className="mb-2 flex justify-end"><button type="button" aria-label="Close" className="rounded-full px-3 py-1 text-sm ring-1 ring-forest/15" onClick={() => setDraftOpen(false)}>Close</button></div>
            <ComposeModal key={draftKey} kind={draftKind} onClose={() => { setDraftOpen(false); setDraftKey((value) => value + 1); }} />
          </div>
          <div hidden={!causeOpen} role="dialog" aria-label="Start a cause" className="relative z-20 mt-4 rounded-2xl bg-ivory p-3 pb-28 lg:pb-3">
            <div className="mb-2 flex justify-end"><button type="button" aria-label="Close" className="rounded-full px-3 py-1 text-sm ring-1 ring-forest/15" onClick={() => setCauseOpen(false)}>Close</button></div>
            <CauseForm category={board.category} />
          </div>
        </div>
        {shown === "causes" ? (
          <div className="space-y-4">
            <Card className="p-4 text-sm text-forest/80">No moderator is assigned, so a new cause stays a draft until the organizer marks it active. Nothing here is vetted, tax-deductible, or held in escrow. Free help, reports, and polls stay free. The listing fee does not apply.</Card>
            {board.q && <p className="text-sm text-forest/70">Results for “{board.q}” · <button className="underline" onClick={() => setQ("")}>clear</button></p>}
            {board.error && <ErrorNote>{board.error}</ErrorNote>}
            {board.notice === "login_required" && <Empty>Log in to see causes you follow.</Empty>}
            {board.causes === null && !board.error ? <Skeleton /> : null}
            {board.causes && !board.notice && board.causes.length === 0 && <Empty>No causes match. An empty list means nobody has published one. It is not a fundraising result.</Empty>}
            {board.causes && !board.notice && board.causes.map((cause) => <CauseCard key={cause.id} cause={cause} />)}
          </div>
        ) : (
          <>
            <h2 className="font-serif text-xl font-semibold">{helpKind === "offer" ? "Offers" : helpKind === "ask" ? "Open asks" : "Asks and offers"}</h2>
            <div className="space-y-4">{asks === null ? <Skeleton /> : asks.length ? asks.map((post) => <PostCard key={post.id} post={post} />) : <Empty>No asks or offers yet.</Empty>}</div>
            <h2 className="font-serif text-xl font-semibold">Civic neighbors</h2>
            {people === null ? <Skeleton /> : people.length === 0 ? <Empty>No one has described themselves as a civic professional or community business yet.</Empty> : (
              <div className="grid gap-4 sm:grid-cols-2">
                {people.map((person) => (
                  <Card key={person.id} className="p-5">
                    <div className="flex gap-4">
                      <Avatar user={person} className="h-20 w-20 rounded-2xl text-xl" />
                      <div className="min-w-0">
                        <p className="font-serif text-lg font-semibold leading-tight">{person.displayName}</p>
                        <p className="text-sm text-forest/70">{roleLabel(person.role)}</p>
                        <p className="mt-1 text-xs text-forest/70">Self-described · not verified</p>
                      </div>
                    </div>
                    <p className="mt-3 text-sm text-forest/80">{person.neighborhood || "Neighborhood not listed"}{person.bio ? ` · ${person.bio}` : ""}</p>
                    <div className="mt-4 flex gap-2">
                      <Link href={`/u/${person.handle}`} className="rounded-full bg-forest px-4 py-2 text-sm font-semibold text-ivory">View profile</Link>
                      {me && me.id !== person.id && <button onClick={async () => { try { await api(`/api/users/${person.handle}/follow`, { method: person.viewerFollowing ? "DELETE" : "POST" }); bump(); } catch (err) { toast(err instanceof Error ? err.message : "Couldn't update follow."); } }} className="rounded-full px-4 py-2 text-sm ring-1 ring-forest/20">{person.viewerFollowing ? "Following" : "Follow"}</button>}
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </>
        )}
      </div>
      <HelpRail neighborhood={me?.neighborhood} />
    </div>
  );
}

function helpTab(on: boolean) {
  return `min-h-11 shrink-0 rounded-full border-2 px-4 py-2.5 text-left text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest focus-visible:ring-offset-2 lg:w-full ${on ? "border-[#9A3412] bg-[#C2410C] text-[#F7F5EF] hover:bg-[#9A3412]" : "border-[#C2410C] bg-[#FFF4E8] text-[#9A3412] hover:bg-[#FFE0C2]"}`;
}

function filterTab(on: boolean) {
  return `shrink-0 rounded-full px-4 py-2 text-left text-sm font-semibold ${on ? "bg-forest text-ivory" : "bg-white text-forest ring-1 ring-forest/10"}`;
}

function HelpRail({ neighborhood }: { neighborhood?: string }) {
  const { rev } = useApp();
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [causes, setCauses] = useState<Cause[] | null>(null);
  useEffect(() => {
    api<{ posts: Post[] }>("/api/feed?lens=help").then((data) => setPosts(data.posts)).catch(() => setPosts([]));
    api<{ causes: Cause[] }>("/api/causes?status=active").then((data) => setCauses(data.causes)).catch(() => setCauses([]));
  }, [rev]);
  const asks = (posts || []).filter((post) => post.kind === "ask");
  const nearby = neighborhood ? asks.filter((post) => (post.author.neighborhood || "").toLowerCase() === neighborhood.toLowerCase()) : asks;
  const offers = (posts || []).filter((post) => post.kind === "offer").slice(0, 3);
  return (
    <aside className="hidden space-y-5 lg:sticky lg:top-24 lg:block" data-testid="help-rail">
      <div className="rounded-3xl bg-white p-5 ring-1 ring-forest/10">
        <h3 className="font-serif text-lg font-semibold">{neighborhood ? `Open asks in ${neighborhood}` : "Open asks"}</h3>
        {posts === null ? <p className="mt-3 text-sm text-forest/70">Loading asks.</p> : nearby.length === 0 ? <p className="mt-3 text-sm text-forest/70">{neighborhood ? `No open asks in ${neighborhood}.` : "No open asks yet."}</p> : nearby.slice(0, 3).map((post) => (
          <div key={post.id} className="mt-3">
            <p className="text-sm font-semibold">{post.title || "Ask"}</p>
            <p className="text-xs text-forest/70">{post.author.displayName}{post.author.neighborhood ? ` · ${post.author.neighborhood}` : ""}</p>
            <Link href={`/post/${post.id}`} aria-label="Open this ask" className="text-xs font-semibold text-[#9A3412]">Open</Link>
          </div>
        ))}
        {!neighborhood && posts && asks.length > 0 && <p className="mt-3 text-xs text-forest/70">Your neighborhood is not set, so these are the latest asks.</p>}
      </div>
      <div className="rounded-3xl bg-white p-5 ring-1 ring-forest/10">
        <h3 className="font-serif text-lg font-semibold">Recent offers</h3>
        {posts === null ? <p className="mt-3 text-sm text-forest/70">Loading offers.</p> : offers.length === 0 ? <p className="mt-3 text-sm text-forest/70">No offers yet.</p> : offers.map((post) => (
          <div key={post.id} className="mt-3">
            <p className="text-sm font-semibold">{post.title || "Offer"}</p>
            <p className="text-xs text-forest/70">{post.author.displayName}{post.priceLabel ? ` · ${post.priceLabel}` : ""}</p>
            <Link href={`/post/${post.id}`} aria-label="Open this offer" className="text-xs font-semibold text-[#9A3412]">Open</Link>
          </div>
        ))}
      </div>
      <div className="rounded-3xl bg-white p-5 ring-1 ring-forest/10">
        <h3 className="font-serif text-lg font-semibold">Active causes</h3>
        {causes === null ? <p className="mt-3 text-sm text-forest/70">Loading causes.</p> : causes.length === 0 ? <p className="mt-3 text-sm text-forest/70">No active causes.</p> : causes.slice(0, 3).map((cause) => (
          <div key={cause.id} className="mt-3">
            <p className="text-sm font-semibold">{cause.title}</p>
            <p className="text-xs text-forest/70">{dollars(cause.pledgedCents)} pledged of {dollars(cause.goalCents)}. Not collected.</p>
            <Link href={`/causes/${cause.id}`} aria-label="Open this cause" className="text-xs font-semibold text-[#9A3412]">Open</Link>
          </div>
        ))}
      </div>
      <div className="rounded-3xl bg-forest p-5 text-sm text-ivory">
        <h3 className="font-serif text-lg font-semibold">How Help works</h3>
        <p className="mt-2 text-ivory/85">An ask or an offer is a post. A cause pledge is an intention. Nothing is collected, and there is no cause fee. The 5% listing figure does not apply here. Payments are off, and no moderator is assigned.</p>
      </div>
    </aside>
  );
}

function dollars(cents: number) {
  return `$${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

export function PlaybooksView() {
  const { me, toast, bump, rev, q } = useApp();
  const [playbooks, setPlaybooks] = useState<Playbook[] | null>(null);
  const [listings, setListings] = useState<Post[]>([]);
  const [title, setTitle] = useState("");
  const [objective, setObjective] = useState("");
  const [steps, setSteps] = useState("");
  const [weeks, setWeeks] = useState(2);
  const [linkedPostId, setLinkedPostId] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const params = q.trim() ? `?q=${encodeURIComponent(q.trim())}` : "";
    api<{ playbooks: Playbook[] }>(`/api/playbooks${params}`).then((data) => setPlaybooks(data.playbooks)).catch(() => setPlaybooks([]));
    if (me) api<{ listings: Post[] }>(`/api/users/${me.handle}/listings`).then((data) => setListings(data.listings)).catch(() => undefined);
  }, [q, rev, me]);
  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api("/api/playbooks", { json: { title, objective, steps, weeks: Number(weeks), linkedPostId: linkedPostId || null } });
      setTitle(""); setObjective(""); setSteps(""); setLinkedPostId("");
      toast("Playbook published. It is not marked reviewed.");
      bump();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't save the playbook.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <Heading sub="Older action playbooks stay here so nothing already written is deleted. New civic allegations belong in Reports, with sources and moderation.">Archived playbooks</Heading>
      {playbooks === null ? <Skeleton /> : playbooks.length === 0 ? <Empty>No action playbooks yet.</Empty> : (
        <div className="grid gap-4 sm:grid-cols-2">
          {playbooks.map((playbook) => (
            <Card key={playbook.id} className="p-2"><PlaybookCard playbook={playbook} />
              {me && <button onClick={async () => { await api(`/api/playbooks/${playbook.id}/save`, { method: playbook.viewerSaved ? "DELETE" : "POST" }); bump(); }} className={`m-3 rounded-full px-4 py-2 text-sm font-semibold ${playbook.viewerSaved ? "bg-sage" : "bg-forest text-ivory"}`}>{playbook.viewerSaved ? "Saved" : "Save playbook"}</button>}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

export function ProfileView({ handle }: { handle: string }) {
  const { me, bump, toast, rev, refreshMe } = useApp();
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [counts, setCounts] = useState({ posts: 0, listings: 0, asks: 0 });
  const [self, setSelf] = useState(false);
  const [following, setFollowing] = useState(false);
  const [posts, setPosts] = useState<Post[]>([]);
  const [tab, setTab] = useState<"posts" | "listings" | "help" | "reports" | "polls" | "causes">("posts");
  const [help, setHelp] = useState<{ sent: Inquiry[]; received: Inquiry[] } | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [neighborhood, setNeighborhood] = useState("");
  const [role, setRole] = useState(user?.role || "resident");
  const [nextHandle, setNextHandle] = useState(handle);
  useEffect(() => {
    let cancel = false;
    api<{ user: User; counts: typeof counts; viewer: { isSelf: boolean; following: boolean } }>(`/api/users/${handle}`).then((data) => {
      if (cancel) return;
      setUser(data.user);
      setCounts(data.counts);
      setSelf(data.viewer.isSelf);
      setFollowing(data.viewer.following);
      setDisplayName(data.user.displayName);
      setBio(data.user.bio);
      setNeighborhood(data.user.neighborhood);
      setRole(data.user.role);
      setNextHandle(data.user.handle);
      setError("");
    }).catch((err) => { if (!cancel) setError(err instanceof Error ? err.message : "Person not found."); });
    api<{ posts: Post[] }>(`/api/users/${handle}/posts`).then((data) => { if (!cancel) setPosts(data.posts); }).catch(() => undefined);
    return () => { cancel = true; };
  }, [handle, rev]);
  useEffect(() => {
    if (self) api<{ sent: Inquiry[]; received: Inquiry[] }>("/api/me/help").then(setHelp).catch(() => undefined);
  }, [self, rev]);
  if (error) return <Empty>{error}</Empty>;
  if (!user) return <Skeleton />;
  const listings = posts.filter((post) => post.kind === "offer");
  const asks = posts.filter((post) => post.kind === "ask");
  const polls = posts.filter((post) => post.kind === "poll");
  return (
    <div>
      <Card className="overflow-hidden">
        <div className="h-36 bg-gradient-to-br from-forest via-[#1f4a3c] to-gold/70" />
        <div className="p-5">
          <Avatar user={user} className="-mt-16 h-24 w-24 rounded-full border-4 border-white text-2xl" />
          <h1 className="mt-2 font-serif text-2xl font-semibold">{user.displayName}</h1>
          <p className="text-sm text-forest/70">@{user.handle} · {roleLabel(user.role)}{user.neighborhood ? ` · ${user.neighborhood}` : ""}</p>
          <p className="mt-1 text-xs text-forest/60">Not verified. Spekup does not issue professional badges.</p>
          {user.bio && <p className="mt-3 text-sm leading-relaxed">{user.bio}</p>}
          <div className="mt-4 flex flex-wrap gap-2">
            {self && <button onClick={() => setEditing(true)} className="rounded-full bg-forest px-4 py-2 text-sm font-semibold text-ivory">Edit profile</button>}
            {self && <button onClick={async () => { await api("/api/auth/logout", { method: "POST" }); await refreshMe(); toast("Logged out."); router.push("/"); }} className="rounded-full px-4 py-2 text-sm ring-1 ring-forest/20">Log out</button>}
            {!self && me && <button onClick={async () => { await api(`/api/users/${user.handle}/follow`, { method: following ? "DELETE" : "POST" }); bump(); }} className="rounded-full px-4 py-2 text-sm font-semibold ring-1 ring-forest/20">{following ? "Following" : "Follow"}</button>}
            <Link href={`/?`} className="rounded-full px-4 py-2 text-sm ring-1 ring-forest/20">Feed</Link>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-3 text-center">
            {[["Posts", counts.posts], ["Listings", counts.listings], ["Asks", counts.asks]].map(([label, value]) => (
              <div key={String(label)} className="rounded-2xl bg-sage p-3"><p className="font-serif text-2xl">{value}</p><p className="text-xs text-forest/70">{label}</p></div>
            ))}
          </div>
        </div>
      </Card>
      {editing && (
        <Card className="mt-4 p-5">
          <form className="space-y-3" onSubmit={async (e) => {
            e.preventDefault();
            try {
              await api("/api/me", { method: "PATCH", json: { displayName, bio, neighborhood, role, handle: nextHandle } });
              toast("Profile saved.");
              setEditing(false);
              bump();
              if (nextHandle !== handle) window.location.href = `/u/${nextHandle}`;
            } catch (err) {
              toast(err instanceof Error ? err.message : "Couldn't save the profile.");
            }
          }}>
            <input aria-label="Name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} className={fieldClass} />
            <input aria-label="Handle" value={nextHandle} onChange={(e) => setNextHandle(e.target.value)} className={fieldClass} />
            <input aria-label="Neighborhood" value={neighborhood} onChange={(e) => setNeighborhood(e.target.value)} placeholder="Neighborhood" className={fieldClass} />
            <textarea aria-label="Bio" value={bio} onChange={(e) => setBio(e.target.value)} rows={3} className={areaClass} />
            <select aria-label="Role" value={role} onChange={(e) => setRole(e.target.value as User["role"])} className={fieldClass}>{ROLES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select>
            <p className="text-xs text-forest/70">Choosing civic professional does not verify you.</p>
            <label className="block text-sm">Profile photo, up to 8 MB. JPEG, PNG, WebP, GIF, or HEIC.<input aria-label="Profile photo" type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif,.heic,.heif" className="mt-1 block w-full text-sm" onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              if (file.type.startsWith("video/")) { toast("Use Clip on a post for a short video."); return; }
              const form = new FormData();
              form.set("file", file);
              try {
                const uploaded = await api<{ media: { id: string } }>("/api/media", { form });
                await api("/api/me", { method: "PATCH", json: { avatarMediaId: uploaded.media.id } });
                toast("Photo updated.");
                bump();
              } catch (err) {
                toast(err instanceof Error ? err.message : "Couldn't update the photo.");
              }
            }} /></label>
            <div className="flex gap-2"><button className="rounded-full bg-forest px-4 py-2 text-sm font-semibold text-ivory">Save profile</button><button type="button" onClick={() => setEditing(false)} className="rounded-full px-4 py-2 text-sm ring-1 ring-forest/20">Cancel</button></div>
          </form>
        </Card>
      )}
      <div className="mt-5 flex flex-wrap gap-2">{(["posts", "polls", "causes", "listings", "help", "reports"] as const).map((item) => <button key={item} onClick={() => setTab(item)} className={`rounded-full px-4 py-1.5 text-sm ${tab === item ? "bg-forest text-ivory" : "bg-white ring-1 ring-forest/10"}`}>{item[0].toUpperCase() + item.slice(1)}</button>)}</div>
      <div className="mt-4 space-y-4">
        {tab === "posts" && (posts.length ? posts.map((post) => <PostCard key={post.id} post={post} />) : <Empty>No posts yet.</Empty>)}
        {tab === "polls" && (polls.length ? polls.map((post) => <PostCard key={post.id} post={post} />) : <Empty>No polls from this account. Voting is not listed here. Ballots stay on the voter's own account.</Empty>)}
        {tab === "listings" && (listings.length ? listings.map((post) => <PostCard key={post.id} post={post} />) : <Empty>No listings yet.</Empty>)}
        {tab === "causes" && <ProfileCauses handle={handle} self={self} />}
        {tab === "reports" && <ProfileReports handle={handle} self={self} />}
        {tab === "help" && (
          <>
            {asks.length ? asks.map((post) => <PostCard key={post.id} post={post} />) : <Empty>No public asks yet.</Empty>}
            {self && help && (
              <Card className="p-5">
                <h2 className="font-serif text-lg font-semibold">Responses you received</h2>
                {help.received.length === 0 ? <p className="mt-2 text-sm text-forest/70">None yet. These stay on Spekup and are not emailed.</p> : help.received.map((item) => <p key={item.id} className="mt-2 rounded-2xl bg-sage px-3 py-2 text-sm"><b>{item.from?.displayName || "Neighbor"}</b> on {item.post?.title}: {item.body}</p>)}
                <h2 className="mt-4 font-serif text-lg font-semibold">Responses you sent</h2>
                {help.sent.length === 0 ? <p className="mt-2 text-sm text-forest/70">None yet.</p> : help.sent.map((item) => <p key={item.id} className="mt-2 rounded-2xl bg-ivory px-3 py-2 text-sm ring-1 ring-forest/10">To {item.post?.authorName || "a neighbor"} · {item.body}</p>)}
              </Card>
            )}
          </>
        )}
      </div>
      {self && <ProfileActivity />}
      {self && <PlanInterest />}
      {self && (
        <div className="mt-6 grid gap-3">
          <Card className="p-5"><h2 className="font-serif text-lg">Payments</h2><p className="mt-1 text-sm text-forest/70">Payments, tips, and checkout are not enabled. No balance is stored. Asking for a plan does not charge you or verify you.</p></Card>
          <Card className="p-5"><h2 className="font-serif text-lg">Professional verification</h2><p className="mt-1 text-sm text-forest/70">Not available. No badge is shown. A Pro request is not a professional credential.</p><Link href="/account" className="mt-3 inline-block text-sm text-goldink underline">Account details</Link></Card>
        </div>
      )}
    </div>
  );
}

function PlanInterest() {
  const { toast, bump } = useApp();
  const [plans, setPlans] = useState<Array<{ code: string; title: string; summary: string }>>([]);
  useEffect(() => { api<{ plans: Array<{ code: string; title: string; summary: string }> }>("/api/plans").then((data) => setPlans(data.plans)).catch(() => undefined); }, []);
  return (
    <Card className="mt-4 p-5">
      <h2 className="font-serif text-lg">Plan interest</h2>
      <p className="mt-1 text-sm text-forest/70">These are proposed previews, not final prices and not active memberships. Saving interest does not charge you, verify you, or change reports or polls.</p>
      <div className="mt-3 space-y-3">
        {plans.map((plan) => (
          <div key={plan.code}>
            <p className="font-semibold">{plan.title}</p>
            <p className="text-sm text-forest/70">{plan.summary}</p>
            <button type="button" onClick={async () => { try { await api(`/api/me/plans/${plan.code}`, { method: "POST" }); toast(`${plan.title} interest saved. Nothing was charged.`); bump(); } catch (err) { toast(err instanceof Error ? err.message : "Couldn't save that."); } }} className="mt-1 rounded-full px-3 py-1 text-sm ring-1 ring-forest/20">Save {plan.title} interest</button>
          </div>
        ))}
      </div>
    </Card>
  );
}

export function AccountView() {
  const { me } = useApp();
  const [account, setAccount] = useState<{ email: string; payments: { message: string; balance: null }; verification: { message: string; status: string }; video: { message: string } } | null>(null);
  const [money, setMoney] = useState<{ payments: { enabled: boolean; balance: null; transactions: unknown[] }; entitlement: { proCommercial: boolean }; interests: { quotes: Array<{ id: string; title: string; status: string }>; plans: Array<{ plan_code: string; status: string }>; support: unknown[]; proposals: unknown[] } } | null>(null);
  useEffect(() => {
    api<NonNullable<typeof account>>("/api/me/account").then(setAccount).catch(() => undefined);
    api<NonNullable<typeof money>>("/api/me/money").then(setMoney).catch(() => undefined);
  }, [me]);
  if (!me) return <Empty><Link href="/login" className="underline">{tx("Log in to see your account.")}</Link></Empty>;
  if (!account || !money) return <Skeleton />;
  return (
    <div>
      <Heading sub={tx("Interests and quotes stay separate from transactions. There is no balance.")}>{tx("Account")}</Heading>
      <div className="space-y-4">
        <Card className="p-5"><h2 className="font-serif text-lg">Login</h2><p className="mt-1 text-sm">{account.email}</p></Card>
        <Card className="p-5">
          <h2 className="font-serif text-lg">Transactions</h2>
          <p className="mt-1 text-sm text-forest/70">{tx(account.payments.message)}</p>
          <p className="mt-2 text-sm">{tx("Balance: none. Recorded transactions: {{count}}.", { count: money.payments.transactions.length })}</p>
          <p className="mt-1 text-sm">Pro commercial label: {money.entitlement.proCommercial ? "active" : "not active"}.</p>
        </Card>
        <Card className="p-5">
          <h2 className="font-serif text-lg">Interests and quotes</h2>
          {money.interests.quotes.length === 0 && money.interests.plans.length === 0 ? <p className="mt-1 text-sm text-forest/70">None saved.</p> : null}
          {money.interests.quotes.map((item) => <p key={item.id} className="mt-2 text-sm">{item.title} · {item.status} · {tx("not an order")}</p>)}
          {money.interests.plans.map((item) => <p key={item.plan_code} className="mt-2 text-sm">{item.plan_code} · {item.status} · not a membership</p>)}
        </Card>
        <Card className="p-5"><h2 className="font-serif text-lg">Verification</h2><p className="mt-1 text-sm text-forest/70">{tx(account.verification.message)}</p><p className="mt-2 text-sm">Status: {account.verification.status}</p></Card>
        <Card className="p-5"><h2 className="font-serif text-lg">Clips</h2><p className="mt-1 text-sm text-forest/70">{account.video.message}</p></Card>
        <Card className="p-5"><h2 className="font-serif text-lg">Archived playbooks</h2><p className="mt-1 text-sm text-forest/70">Older playbooks are kept and are no longer the main module.</p><Link href="/playbooks" className="mt-2 inline-block text-sm text-goldink underline">View archive</Link></Card>
        <RecoveryCard />
        <DeleteAccount />
      </div>
    </div>
  );
}

function RecoveryCard() {
  const [note, setNote] = useState(tx("Password reset and email verification are not available yet. No mail is configured."));
  const [available, setAvailable] = useState(false);
  const [email, setEmail] = useState("");
  useEffect(() => {
    api<{ available: boolean; message: string }>("/api/auth/recovery").then((row) => { setAvailable(row.available); setNote(row.message); }).catch(() => undefined);
  }, []);
  return (
    <Card className="p-5">
      <h2 className="font-serif text-lg">Password and email</h2>
      <p className="mt-1 text-sm text-forest/70">{tx(note)}</p>
      {available && (
        <form className="mt-3 space-y-2" onSubmit={async (event) => {
          event.preventDefault();
          const row = await api<{ message: string }>("/api/auth/forgot", { json: { email } });
          setNote(row.message);
        }}>
          <input aria-label="Reset email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" className="w-full rounded-full border border-forest/15 px-4 py-2 text-sm" />
          <button className="rounded-full bg-forest px-4 py-2 text-sm font-semibold text-ivory">Send reset link</button>
        </form>
      )}
    </Card>
  );
}

function DeleteAccount() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [note, setNote] = useState("");
  return (
    <Card className="p-5">
      <h2 className="font-serif text-lg">Delete account</h2>
      <p className="mt-1 text-sm text-forest/70">This deletes your account, posts, listings, reports, and uploaded files. They are not kept under another name.</p>
      <form className="mt-3 space-y-2" onSubmit={async (event) => {
        event.preventDefault();
        try {
          await api("/api/me/delete", { json: { password, confirm } });
          window.location.href = "/";
        } catch (err) {
          setNote(err instanceof Error ? err.message : "The account was not deleted.");
        }
      }}>
        <input aria-label="Confirm password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" className="w-full rounded-full border border-forest/15 px-4 py-2 text-sm" />
        <input aria-label="Deletion phrase" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="delete my account" className="w-full rounded-full border border-forest/15 px-4 py-2 text-sm" />
        <button className="rounded-full bg-[#9A3412] px-4 py-2 text-sm font-semibold text-ivory">Delete account</button>
      </form>
      {note && <p className="mt-2 text-sm text-red-800" role="alert">{note}</p>}
    </Card>
  );
}

export function ResetView() {
  const [password, setPassword] = useState("");
  const [note, setNote] = useState("");
  const token = typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("token") || "";
  return (
    <Card className="mx-auto max-w-md p-6">
      <h1 className="font-serif text-3xl">Choose a new password</h1>
      <form className="mt-4 space-y-3" onSubmit={async (event) => {
        event.preventDefault();
        try {
          await api("/api/auth/reset", { json: { token, password } });
          setNote("Password updated. Log in with the new one.");
        } catch (err) {
          setNote(err instanceof Error ? err.message : "That link was not accepted.");
        }
      }}>
        <input aria-label="New password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full rounded-full border border-forest/15 px-4 py-2" />
        <button className="rounded-full bg-forest px-4 py-2 font-semibold text-ivory">Save password</button>
      </form>
      {note && <p className="mt-3 text-sm">{note}</p>}
    </Card>
  );
}

export function VerifyView() {
  const [note, setNote] = useState("Checking the link…");
  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("token") || "";
    api("/api/auth/verify", { json: { token } }).then(() => setNote("Email confirmed.")).catch((err) => setNote(err instanceof Error ? err.message : "That link was not accepted."));
  }, []);
  return <Card className="mx-auto max-w-md p-6"><h1 className="font-serif text-3xl">Email</h1><p className="mt-3 text-sm">{note}</p></Card>;
}

export function SavedView() {
  const { me, rev } = useApp();
  const [posts, setPosts] = useState<Post[] | null>(null);
  useEffect(() => {
    if (!me) return;
    api<{ posts: Post[] }>("/api/me/saved").then((data) => setPosts(data.posts)).catch(() => setPosts([]));
  }, [me, rev]);
  if (!me) return <Empty><Link href="/login" className="underline">Log in</Link> to see saved posts.</Empty>;
  return <div><Heading sub={tx("Posts you saved.")}>{tx("Saved")}</Heading><div className="space-y-4">{posts === null ? <Skeleton /> : posts.length ? posts.map((post) => <PostCard key={post.id} post={post} />) : <Empty>{tx("Nothing saved yet.")}</Empty>}</div></div>;
}

function ProfileActivity() {
  const { rev } = useApp();
  const [activity, setActivity] = useState<{ groups: Array<{ id: string; name: string; viewerRole: string | null }>; events: Array<{ id: string; title: string; status: string }> } | null>(null);
  useEffect(() => {
    api<NonNullable<typeof activity>>("/api/me/activity").then(setActivity).catch(() => undefined);
  }, [rev]);
  if (!activity) return null;
  return (
    <Card className="mt-6 p-5">
      <h2 className="font-serif text-lg">Groups and gatherings</h2>
      {activity.groups.length === 0 && activity.events.length === 0 ? <p className="mt-2 text-sm text-forest/70">You have not joined a group or RSVP'd yet.</p> : (
        <div className="mt-2 space-y-1 text-sm">
          {activity.groups.map((group) => <p key={group.id}><Link href={`/g/${group.id}`} className="font-semibold hover:underline">{group.name}</Link> · {group.viewerRole}</p>)}
          {activity.events.map((event) => <p key={event.id}><Link href={`/event/${event.id}`} className="hover:underline">{event.title}</Link> · {event.status}</p>)}
        </div>
      )}
    </Card>
  );
}

export function StatusView({ title, sub, body }: { title: string; sub: string; body: string }) {
  return <div><Heading sub={sub}>{title}</Heading><Empty>{body}</Empty></div>;
}

export function AuthView({ mode }: { mode: "login" | "signup" }) {
  const { refreshMe, toast } = useApp();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [handle, setHandle] = useState("");
  const [neighborhood, setNeighborhood] = useState("");
  const [role, setRole] = useState<User["role"]>("resident");
  const [fields, setFields] = useState<Record<string, string> | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFields(null);
    try {
      if (mode === "login") await api("/api/auth/login", { json: { email, password } });
      else await api("/api/auth/signup", { json: { email, password, displayName, handle, neighborhood, role } });
      await refreshMe();
      toast(mode === "login" ? "Welcome back." : "Account created.");
      router.push(takeNext());
    } catch (err) {
      if (err instanceof ApiError) setFields(err.fields);
      toast(err instanceof Error ? err.message : "Couldn't sign you in.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card className="mx-auto max-w-lg p-6">
      <h1 className="font-serif text-3xl font-semibold">{mode === "login" ? tx("Log in") : tx("Create an account")}</h1>
      <p className="mt-1 text-sm text-forest/70">Spekup accounts are for neighbors. This is not a government login.</p>
      <form onSubmit={submit} className="mt-5 space-y-3">
        {mode === "signup" && (
          <>
            <input aria-label="Name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Name" className={fieldClass} />
            {fields?.displayName && <p className="text-xs text-rose-800">{fields.displayName}</p>}
            <input aria-label="Handle" value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="Handle" className={fieldClass} />
            {fields?.handle && <p className="text-xs text-rose-800">{fields.handle}</p>}
            <input aria-label="Neighborhood" value={neighborhood} onChange={(e) => setNeighborhood(e.target.value)} placeholder="Neighborhood (optional)" className={fieldClass} />
            <select aria-label="Role" value={role} onChange={(e) => setRole(e.target.value as User["role"])} className={fieldClass}>{ROLES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select>
          </>
        )}
        <input aria-label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" className={fieldClass} />
        {fields?.email && <p className="text-xs text-rose-800">{fields.email}</p>}
        <input aria-label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" className={fieldClass} />
        {fields?.password && <p className="text-xs text-rose-800">{fields.password}</p>}
        <button disabled={busy} className="w-full rounded-full bg-forest py-3 font-semibold text-ivory disabled:opacity-40">{busy ? "Working…" : mode === "login" ? "Log in" : "Create account"}</button>
      </form>
      <p className="mt-4 text-sm text-forest/70">{mode === "login" ? <Link href="/signup" className="underline">Need an account?</Link> : <Link href="/login" className="underline">Already have an account?</Link>}</p>
    </Card>
  );
}

export function Sidebar() {
  const { setQ } = useApp();
  const router = useRouter();
  const [people, setPeople] = useState<User[]>([]);
  const [listings, setListings] = useState<Post[]>([]);
  const { rev } = useApp();
  useEffect(() => {
    api<{ people: User[] }>("/api/professionals").then((data) => setPeople(data.people.slice(0, 3))).catch(() => undefined);
    api<{ listings: Post[] }>("/api/listings").then((data) => setListings(data.listings.slice(0, 4))).catch(() => undefined);
  }, [rev]);
  return (
    <aside className="space-y-4">
      <Card className="p-5">
        <h3 className="font-serif text-lg font-semibold">{tx("Topics")}</h3>
        <div className="mt-3 flex flex-wrap gap-2">{TOPICS.map((topic) => <button key={topic.id} onClick={() => { setQ(""); router.push(`/?`); }} className="rounded-full bg-sage px-3 py-1 text-sm hover:bg-gold/30">{tx(topic.label)}</button>)}</div>
      </Card>
      <Card className="p-5">
        <div className="flex items-center justify-between"><h3 className="font-serif text-lg font-semibold">Civic neighbors</h3><Link href="/help" className="text-xs text-goldink">See all</Link></div>
        <div className="mt-3 space-y-3">{people.length === 0 ? <p className="text-sm text-forest/70">No self-described civic professionals yet.</p> : people.map((person) => <Link key={person.id} href={`/u/${person.handle}`} className="flex items-center gap-3"><Avatar user={person} className="h-10 w-10 rounded-full text-xs" /><div className="min-w-0"><p className="truncate text-sm font-semibold">{person.displayName}</p><p className="truncate text-xs text-forest/70">{roleLabel(person.role)} · not verified</p></div></Link>)}</div>
      </Card>
      <Card className="p-5">
        <h3 className="font-serif text-lg font-semibold">Causes</h3>
        <p className="mt-2 text-sm text-forest/70">Intentions neighbors have pledged. Not money collected, and not a charity registration.</p>
        <Link href="/help?tab=causes" className="mt-2 inline-block text-xs text-goldink">Open causes in Help</Link>
      </Card>
      <Card className="p-5">
        <h3 className="font-serif text-lg font-semibold">Polls</h3>
        <p className="mt-2 text-sm text-forest/70">Community opinions among people with accounts. Not an election and not a finding. An empty poll is zero respondents.</p>
        <Link href="/polls" className="mt-2 inline-block text-xs text-goldink">Open polls</Link>
      </Card>
      <Card className="p-5">
        <h3 className="font-serif text-lg font-semibold">Accountability</h3>
        <p className="mt-2 text-sm text-forest/70">Published allegations, after a person reviews the sources. An empty list is not a safety score.</p>
        <Link href="/reports" className="mt-2 inline-block text-xs text-goldink">Open reports</Link>
      </Card>
      <Card className="p-5">
        <h3 className="font-serif text-lg font-semibold">Recent listings</h3>
        <div className="mt-3 grid grid-cols-2 gap-2">{listings.length === 0 ? <p className="col-span-2 text-sm text-forest/70">No listings yet.</p> : listings.map((item) => <Link key={item.id} href={`/listing/${item.id}`} className="rounded-2xl bg-ivory p-3 text-left ring-1 ring-forest/10"><p className="text-sm font-semibold leading-tight">{item.title}</p><p className="text-[11px] text-forest/70">{item.priceLabel}</p></Link>)}</div>
      </Card>
      <Card className="p-5"><h3 className="font-serif text-lg font-semibold">Events</h3><p className="mt-2 text-sm text-forest/70">Gatherings you can RSVP to. Nothing is emailed or added to an outside calendar.</p><Link href="/events" className="mt-2 inline-block text-xs text-goldink">See gatherings</Link></Card>
      <p className="px-2 text-[11px] leading-relaxed text-forest/70">Spekup is a neighbor-run community space, not a government agency, campaign, or official record. Posts are written by the people who sign in. Verification and payments are not available. Short clips are prepared locally and are not reviewed by a moderator.</p>
    </aside>
  );
}

export function Missing() {
  return (
    <div className="grid place-items-center py-16 text-center">
      <h1 className="font-serif text-4xl font-semibold">{tx("Page not found")}</h1>
      <p className="mt-2 text-forest/70">This path is not part of Spekup.</p>
      <Link href="/" className="mt-6 rounded-full bg-forest px-6 py-3 font-semibold text-ivory">{tx("Back to the feed")}</Link>
    </div>
  );
}
