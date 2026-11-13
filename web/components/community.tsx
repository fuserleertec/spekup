"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ApiError, api, rememberNext } from "@/lib/api";
import { tx } from "@/lib/i18n";
import { TranslateButton, useContentTranslation } from "./see-translation";
import type { Post } from "@/lib/types";
import { useApp } from "./context";
import { PostCard } from "./post-card";
import { ClipForm } from "./publish";
import { Avatar, Card, Empty, Heading, Skeleton, ThreeColumn, areaClass, choiceClass, fieldClass, orangeCta } from "./ui";

const ZONES = ["America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "America/Phoenix", "Pacific/Honolulu", "UTC"];

type Group = {
  id: string;
  name: string;
  description: string;
  neighborhood: string;
  visibility: "public" | "private";
  memberCount: number;
  viewerRole: string | null;
  ownerHandle: string;
};

type Gathering = {
  id: string;
  title: string;
  description: string;
  startsAt: string;
  endsAt: string | null;
  timezone: string;
  place: string;
  onlineUrl: string;
  status: "scheduled" | "cancelled";
  passed: boolean;
  group: { id: string; name: string | null } | null;
  organizer: { handle: string; displayName: string };
  rsvpCount: number;
  viewerGoing: boolean;
  viewerCanManage: boolean;
};

function when(event: Gathering) {
  const start = new Date(event.startsAt);
  const zone = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short", timeZone: event.timezone }).format(start);
  const local = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(start);
  return { zone, local };
}

export function ClipsView() {
  const { rev, q, me, bump, toast } = useApp();
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const params = new URLSearchParams({ video: "1" });
    if (q.trim()) params.set("q", q.trim());
    api<{ posts: Post[] }>(`/api/feed?${params}`).then((data) => setPosts(data.posts)).catch(() => setPosts([]));
  }, [rev, q]);
  useEffect(() => {
    if (me && new URLSearchParams(window.location.search).get("post") === "1") setOpen(true);
  }, [me]);
  return (
    <div className="space-y-4">
      <Heading sub="Short clips from neighbors. Nothing plays until you press play. Originals stay private, and clips are not reviewed by a moderator.">Clips</Heading>
      <div>
        {me ? <button type="button" className={orangeCta} onClick={() => setOpen(true)}>Post a clip</button> : <Link href="/login" className={orangeCta} onClick={() => rememberNext("/clips?post=1")}>Log in to post a clip</Link>}
      </div>
      {open && me && <ClipForm onCancel={() => setOpen(false)} onDone={(post) => { setOpen(false); bump(); toast(post.video?.status === "ready" ? "Clip is ready." : post.video?.status === "failed" ? "The clip could not be prepared." : "Clip posted. It is still preparing."); }} />}
      {posts === null ? <Skeleton /> : posts.length === 0 ? <Empty>No clips yet. Post an MP4 or WebM from 0.2 to 30 seconds and up to 40 MB.</Empty> : (
        <div className="grid gap-4 sm:grid-cols-2">{posts.map((post) => <PostCard key={post.id} post={post} />)}</div>
      )}
    </div>
  );
}

export function GroupsView() {
  const { me, toast, bump, rev } = useApp();
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [neighborhood, setNeighborhood] = useState("");
  const [visibility, setVisibility] = useState<"public" | "private">("public");
  const [shown, setShown] = useState<"" | "public" | "private">("");
  const [open, setOpen] = useState(false);
  useEffect(() => {
    api<{ groups: Group[] }>("/api/groups").then((data) => setGroups(data.groups)).catch(() => setGroups([]));
  }, [rev]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const visible = (groups || []).filter((group) => !shown || group.visibility === shown);
  function start() {
    if (!me) { rememberNext("/groups"); window.location.href = "/login"; return; }
    setOpen(true);
  }
  return (
    <ThreeColumn
      id="groups"
      label="Group filters"
      rail={
        <div className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible">
          <button type="button" onClick={() => setShown("")} className={choiceClass(shown === "")}>All groups</button>
          <button type="button" onClick={() => setShown("public")} className={choiceClass(shown === "public")}>Public</button>
          <button type="button" onClick={() => setShown("private")} className={choiceClass(shown === "private")}>Private</button>
        </div>
      }
      side={<GroupRail groups={groups || []} />}
    >
      <Heading sub={tx("Neighborhood and community groups. Public groups are open to join. Private groups are visible by name only until an owner or admin adds you.")}>{tx("Groups")}</Heading>
      <div className="rounded-[28px] bg-white p-4 ring-1 ring-forest/10" data-testid="groups-composer">
        <button type="button" className="w-full rounded-full bg-ivory px-4 py-2.5 text-left text-sm text-forest/70 ring-1 ring-forest/10" onClick={start}>Start a neighborhood group</button>
        <div className="mt-3"><button type="button" className={orangeCta} onClick={start}>Start a group</button></div>
        <div hidden={!open} role="dialog" aria-label="Start a group" className="relative z-20 mt-4 rounded-2xl bg-ivory p-3 pb-28 lg:pb-3">
          <div className="mb-2 flex justify-end"><button type="button" aria-label="Close" className="rounded-full px-3 py-1 text-sm ring-1 ring-forest/15" onClick={() => setOpen(false)}>Close</button></div>
          <form className="space-y-3" onSubmit={async (e) => {
            e.preventDefault();
            try {
              await api("/api/groups", { json: { name, description, neighborhood, visibility } });
              setName(""); setDescription("");
              setOpen(false);
              toast("Group created.");
              bump();
            } catch (err) {
              toast(err instanceof Error ? err.message : "Couldn't create the group.");
            }
          }}>
            <h2 className="font-serif text-xl">Start a group</h2>
            <input aria-label="Group name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Group name" className={fieldClass} />
            <input aria-label="Group neighborhood" value={neighborhood} onChange={(e) => setNeighborhood(e.target.value)} placeholder="Neighborhood" className={fieldClass} />
            <textarea aria-label="Group description" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="What neighbors do here" className={areaClass} />
            <div className="flex gap-2">
              <button type="button" onClick={() => setVisibility("public")} className={`rounded-full px-3 py-1 text-sm ${visibility === "public" ? "bg-forest text-ivory" : "bg-white ring-1 ring-forest/10"}`}>Public</button>
              <button type="button" onClick={() => setVisibility("private")} className={`rounded-full px-3 py-1 text-sm ${visibility === "private" ? "bg-forest text-ivory" : "bg-white ring-1 ring-forest/10"}`}>Private</button>
            </div>
            <button className="rounded-full bg-forest px-4 py-2 text-sm font-semibold text-ivory">Create group</button>
          </form>
        </div>
      </div>
      {groups === null ? <Skeleton /> : visible.length === 0 ? <Empty>{tx("No groups yet.")}</Empty> : visible.map((group) => (
        <Card key={group.id} className="reveal rounded-3xl p-4 shadow-[0_2px_0_rgba(23,55,45,0.08)]">
          <div className="flex items-center gap-3">
            <Avatar user={{ displayName: group.name, avatarUrl: null }} className="h-11 w-11 rounded-full" />
            <div>
              <p className="text-xs text-forest/70">{group.visibility} · {group.memberCount} {group.memberCount === 1 ? "member" : "members"}</p>
              <p className="text-xs text-forest/70">{group.neighborhood || "Neighborhood not listed"}</p>
            </div>
          </div>
          <h2 className="mt-3 font-serif text-xl font-semibold"><Link href={`/g/${group.id}`}>{group.name}</Link></h2>
          <GroupBlurb id={group.id} text={group.description} />
        </Card>
      ))}
    </ThreeColumn>
  );
}

function GroupRail({ groups }: { groups: Group[] }) {
  const mine = groups.filter((group) => group.viewerRole);
  const shown = mine.length ? mine : groups;
  return (
    <>
      <div className="rounded-3xl bg-white p-5 ring-1 ring-forest/10">
        <h3 className="font-serif text-lg font-semibold">{mine.length ? "Your groups" : "Listed groups"}</h3>
        {shown.length === 0 ? <p className="mt-3 text-sm text-forest/70">No groups yet.</p> : shown.slice(0, 5).map((group) => (
          <div key={group.id} className="mt-3">
            <p className="text-sm font-semibold">{group.name}</p>
            <p className="text-xs text-forest/70">{group.visibility} · {group.memberCount} {group.memberCount === 1 ? "member" : "members"}</p>
          </div>
        ))}
      </div>
      <div className="rounded-3xl bg-forest p-5 text-sm text-ivory">
        <h3 className="font-serif text-lg font-semibold">Privacy</h3>
        <p className="mt-2 text-ivory/85">A private group's posts stay hidden. Someone who is not a member gets no media from that group.</p>
      </div>
    </>
  );
}

function GroupBlurb({ id, text }: { id: string; text: string }) {
  const translated = useContentTranslation([{ kind: "group", id, text: text || "" }]);
  if (!text) return null;
  return (
    <>
      <p className="mt-2 whitespace-pre-wrap text-[15px] leading-relaxed text-forest/80">{translated.textFor("group", id, text)}</p>
      {translated.enabled && <TranslateButton on={translated.on} busy={translated.busy} onClick={translated.toggle} />}
    </>
  );
}

export function GroupDetail({ id }: { id: string }) {
  const { me, toast, bump, rev } = useApp();
  const [group, setGroup] = useState<Group | null>(null);
  const [members, setMembers] = useState<Array<{ handle: string; displayName: string; role: string }>>([]);
  const [canView, setCanView] = useState(false);
  const [posts, setPosts] = useState<Post[]>([]);
  const [error, setError] = useState("");
  const [handle, setHandle] = useState("");
  const description = useContentTranslation([{ kind: "group", id, text: group?.description || "" }]);
  useEffect(() => {
    api<{ group: Group; members: typeof members; canViewPosts: boolean }>(`/api/groups/${id}`).then((data) => {
      setGroup(data.group); setMembers(data.members); setCanView(data.canViewPosts); setError("");
    }).catch((err) => setError(err instanceof Error ? err.message : "Group not found."));
    api<{ posts: Post[] }>(`/api/feed?groupId=${id}`).then((data) => setPosts(data.posts)).catch(() => setPosts([]));
  }, [id, rev]);
  if (error) return <Empty>{error}</Empty>;
  if (!group) return <Skeleton />;
  return (
    <div className="space-y-4">
      <Link href="/groups" className="text-sm text-goldink">All groups</Link>
      <Card className="p-5">
        <p className="text-xs uppercase tracking-wider text-goldink">{group.visibility} group · {group.memberCount} members</p>
        <h1 className="mt-1 font-serif text-3xl font-semibold">{group.name}</h1>
        <p className="mt-2 text-sm text-forest/80">{group.description ? description.textFor("group", id, group.description) : tx("No description yet.")}</p>
        {description.enabled && <TranslateButton on={description.on} busy={description.busy} onClick={description.toggle} />}
        <div className="mt-4 flex flex-wrap gap-2">
          {me && !group.viewerRole && group.visibility === "public" && <button onClick={async () => { await api(`/api/groups/${id}/join`, { method: "POST" }); toast("You joined."); bump(); }} className="rounded-full bg-forest px-4 py-2 text-sm font-semibold text-ivory">Join</button>}
          {group.viewerRole && group.viewerRole !== "owner" && <button onClick={async () => { await api(`/api/groups/${id}/join`, { method: "DELETE" }); toast("You left the group."); bump(); }} className="rounded-full px-4 py-2 text-sm ring-1 ring-forest/20">Leave</button>}
          {group.viewerRole === "owner" && <button onClick={async () => { if (!confirm("Delete this group and its posts and gatherings?")) return; await api(`/api/groups/${id}`, { method: "DELETE" }); toast("Group deleted."); window.location.href = "/groups"; }} className="rounded-full px-4 py-2 text-sm text-rose-800 ring-1 ring-forest/20">Delete group</button>}
        </div>
      </Card>
      {group.viewerRole && members.length > 0 && (
        <Card className="p-5">
          <h2 className="font-serif text-lg">People</h2>
          <ul className="mt-2 space-y-1 text-sm">{members.map((member) => <li key={member.handle}><Link href={`/u/${member.handle}`} className="font-semibold hover:underline">{member.displayName}</Link> · {member.role}</li>)}</ul>
          {(group.viewerRole === "owner" || group.viewerRole === "admin") && (
            <form className="mt-3 flex gap-2" onSubmit={async (e) => {
              e.preventDefault();
              try { await api(`/api/groups/${id}/members`, { json: { handle, role: "member" } }); setHandle(""); toast("Person added."); bump(); }
              catch (err) { toast(err instanceof ApiError ? err.message : "Couldn't add that person."); }
            }}>
              <input aria-label="Add member handle" value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="Handle to add" className={fieldClass} />
              <button className="rounded-full bg-forest px-4 text-sm font-semibold text-ivory">Add</button>
            </form>
          )}
        </Card>
      )}
      {!canView && <Empty>This group is private. Posts and gatherings stay hidden until you are added.</Empty>}
      {canView && <GroupGoals groupId={id} canOrganize={group.viewerRole === "owner" || group.viewerRole === "admin"} />}
      {canView && <div className="space-y-4">{posts.length ? posts.map((post) => <PostCard key={post.id} post={post} />) : <Empty>No posts in this group yet.</Empty>}</div>}
    </div>
  );
}

function GroupGoals({ groupId, canOrganize }: { groupId: string; canOrganize: boolean }) {
  const { me, toast, bump, rev } = useApp();
  const [goals, setGoals] = useState<Array<{ id: string; title: string; detail: string; progressLabel: string; progressCount: number; progressTarget: number; moneyRaised: null; proposals: Array<{ id: string; kind: string; statement: string; status: string; label: string | null; disclaimer: string | null; from: { displayName: string } }> }>>([]);
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [progressLabel, setProgressLabel] = useState("neighbors");
  const [progressTarget, setProgressTarget] = useState("4");
  const [statement, setStatement] = useState("");
  useEffect(() => {
    api<{ goals: typeof goals }>(`/api/groups/${groupId}/goals`).then((data) => setGoals(data.goals)).catch(() => setGoals([]));
  }, [groupId, rev]);
  return (
    <Card className="p-5">
      <h2 className="font-serif text-lg">Community goals</h2>
      <p className="mt-1 text-sm text-forest/70">Progress is a count you enter. It is not money raised. A sponsor label appears only after an organizer agrees, and that agreement is not a payment.</p>
      {canOrganize && (
        <form className="mt-3 space-y-2" onSubmit={async (e) => {
          e.preventDefault();
          try {
            await api(`/api/groups/${groupId}/goals`, { json: { title, detail, progressLabel, progressTarget: Number(progressTarget) } });
            setTitle(""); setDetail("");
            toast("Goal saved. No funds were recorded.");
            bump();
          } catch (err) { toast(err instanceof Error ? err.message : "Couldn't save the goal."); }
        }}>
          <input aria-label="Goal title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Goal" className={fieldClass} />
          <textarea aria-label="Goal detail" value={detail} onChange={(e) => setDetail(e.target.value)} rows={2} placeholder="What the group is trying to do" className={areaClass} />
          <input aria-label="Progress label" value={progressLabel} onChange={(e) => setProgressLabel(e.target.value)} className={fieldClass} />
          <input aria-label="Progress target" value={progressTarget} onChange={(e) => setProgressTarget(e.target.value)} className={fieldClass} />
          <button className="rounded-full bg-forest px-4 py-2 text-sm font-semibold text-ivory">Save goal</button>
        </form>
      )}
      <div className="mt-4 space-y-4">
        {goals.length === 0 ? <p className="text-sm text-forest/70">No goals yet.</p> : goals.map((goal) => (
          <div key={goal.id} className="rounded-2xl bg-ivory p-3 ring-1 ring-forest/10">
            <p className="font-semibold">{goal.title}</p>
            <p className="text-sm">{goal.detail}</p>
            <p className="mt-1 text-sm">{goal.progressCount} of {goal.progressTarget} {goal.progressLabel}. Money raised: none.</p>
            {canOrganize && <button type="button" className="mt-2 rounded-full px-3 py-1 text-sm ring-1 ring-forest/20" onClick={async () => { await api(`/api/goals/${goal.id}`, { method: "PATCH", json: { progressCount: goal.progressCount + 1 } }); toast("Progress count updated. No money was added."); bump(); }}>Add one to the count</button>}
            {goal.proposals.map((proposal) => (
              <div key={proposal.id} className="mt-2 text-sm">
                <p>{proposal.from.displayName}: {proposal.statement}</p>
                {proposal.label && <p className="font-semibold">{proposal.label}. {proposal.disclaimer}</p>}
                {canOrganize && proposal.status === "submitted" && <button type="button" className="mt-1 rounded-full bg-forest px-3 py-1 text-sm font-semibold text-ivory" onClick={async () => { await api(`/api/proposals/${proposal.id}/decision`, { json: { status: "agreed" } }); toast("Marked agreed. Nothing was paid."); bump(); }}>Mark agreed</button>}
              </div>
            ))}
            {me && !canOrganize && (
              <form className="mt-2 space-y-2" onSubmit={async (e) => {
                e.preventDefault();
                try { await api(`/api/goals/${goal.id}/proposals`, { json: { kind: "sponsor", statement } }); setStatement(""); toast("Proposal saved. It is not a payment."); bump(); }
                catch (err) { toast(err instanceof Error ? err.message : "Couldn't save the proposal."); }
              }}>
                <textarea aria-label="Sponsor proposal" value={statement} onChange={(e) => setStatement(e.target.value)} rows={2} placeholder="What you are proposing. No payment is sent." className={areaClass} />
                <button className="rounded-full px-3 py-1 text-sm ring-1 ring-forest/20">Send sponsor proposal</button>
              </form>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}

export function EventsView() {
  const { me, toast, bump, rev } = useApp();
  const [events, setEvents] = useState<Gathering[] | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [startsAtLocal, setStartsAtLocal] = useState("");
  const [timezone, setTimezone] = useState("America/New_York");
  const [place, setPlace] = useState("");
  const [onlineUrl, setOnlineUrl] = useState("");
  const [groupId, setGroupId] = useState("");
  const [shown, setShown] = useState<"" | "scheduled" | "cancelled">("");
  const [open, setOpen] = useState(false);
  useEffect(() => {
    api<{ events: Gathering[] }>("/api/events").then((data) => setEvents(data.events)).catch(() => setEvents([]));
    if (me) api<{ groups: Group[] }>("/api/groups?mine=1").then((data) => setGroups(data.groups)).catch(() => undefined);
  }, [rev, me]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const visible = (events || []).filter((event) => !shown || event.status === shown);
  function plan() {
    if (!me) { rememberNext("/events"); window.location.href = "/login"; return; }
    setOpen(true);
  }
  return (
    <ThreeColumn
      id="events"
      label="Gathering filters"
      rail={
        <div className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible">
          <button type="button" onClick={() => setShown("")} className={choiceClass(shown === "")}>All gatherings</button>
          <button type="button" onClick={() => setShown("scheduled")} className={choiceClass(shown === "scheduled")}>Scheduled</button>
          <button type="button" onClick={() => setShown("cancelled")} className={choiceClass(shown === "cancelled")}>Cancelled</button>
        </div>
      }
      side={<EventRail events={events || []} />}
    >
      <Heading sub={tx("Gatherings with a time zone, a place or a link, and RSVPs saved here. Nothing is emailed, and there are no tickets.")}>{tx("Events")}</Heading>
      <div className="rounded-[28px] bg-white p-4 ring-1 ring-forest/10" data-testid="events-composer">
        <button type="button" className="w-full rounded-full bg-ivory px-4 py-2.5 text-left text-sm text-forest/70 ring-1 ring-forest/10" onClick={plan}>Set a time and a place</button>
        <div className="mt-3"><button type="button" className={orangeCta} onClick={plan}>Plan a gathering</button></div>
        <div hidden={!open} role="dialog" aria-label="Plan a gathering" className="relative z-20 mt-4 rounded-2xl bg-ivory p-3 pb-28 lg:pb-3">
          <div className="mb-2 flex justify-end"><button type="button" aria-label="Close" className="rounded-full px-3 py-1 text-sm ring-1 ring-forest/15" onClick={() => setOpen(false)}>Close</button></div>
          <form className="space-y-3" onSubmit={async (e) => {
            e.preventDefault();
            try {
              await api("/api/events", { json: { title, description, startsAtLocal, timezone, place, onlineUrl, groupId: groupId || null } });
              setTitle(""); setDescription(""); setPlace(""); setOnlineUrl("");
              setOpen(false);
              toast("Gathering saved.");
              bump();
            } catch (err) {
              toast(err instanceof Error ? err.message : "Couldn't save the gathering.");
            }
          }}>
            <h2 className="font-serif text-xl">Plan a gathering</h2>
            <input aria-label="Event title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" className={fieldClass} />
            <textarea aria-label="Event details" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="What neighbors should know" className={areaClass} />
            <input aria-label="Event start" type="datetime-local" value={startsAtLocal} onChange={(e) => setStartsAtLocal(e.target.value)} className={fieldClass} />
            <select aria-label="Event time zone" value={timezone} onChange={(e) => setTimezone(e.target.value)} className={fieldClass}>{ZONES.map((zone) => <option key={zone}>{zone}</option>)}</select>
            <input aria-label="Event place" value={place} onChange={(e) => setPlace(e.target.value)} placeholder="Place" className={fieldClass} />
            <input aria-label="Event link" value={onlineUrl} onChange={(e) => setOnlineUrl(e.target.value)} placeholder="Online link (optional)" className={fieldClass} />
            {!!groups.length && <select aria-label="Event group" value={groupId} onChange={(e) => setGroupId(e.target.value)} className={fieldClass}><option value="">No group</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select>}
            <button className="rounded-full bg-forest px-4 py-2 text-sm font-semibold text-ivory">Save gathering</button>
          </form>
        </div>
      </div>
      {events === null ? <Skeleton /> : visible.length === 0 ? <Empty>No gatherings yet.</Empty> : visible.map((event) => <EventCard key={event.id} event={event} />)}
    </ThreeColumn>
  );
}

function EventRail({ events }: { events: Gathering[] }) {
  const upcoming = events.filter((event) => event.status === "scheduled" && !event.passed);
  return (
    <>
      <div className="rounded-3xl bg-white p-5 ring-1 ring-forest/10">
        <h3 className="font-serif text-lg font-semibold">Upcoming</h3>
        {upcoming.length === 0 ? <p className="mt-3 text-sm text-forest/70">No upcoming gatherings.</p> : upcoming.slice(0, 4).map((event) => (
          <div key={event.id} className="mt-3">
            <p className="text-sm font-semibold">{event.title}</p>
            <p className="text-xs text-forest/70">{event.place || "Online"} · {event.rsvpCount} going</p>
          </div>
        ))}
      </div>
      <div className="rounded-3xl bg-forest p-5 text-sm text-ivory">
        <h3 className="font-serif text-lg font-semibold">How gatherings work</h3>
        <p className="mt-2 text-ivory/85">A gathering keeps a time zone, a place or a link, and RSVPs on Spekup. Nothing is emailed and there are no tickets.</p>
      </div>
    </>
  );
}

function EventCard({ event }: { event: Gathering }) {
  const time = when(event);
  const description = useContentTranslation([{ kind: "event", id: event.id, text: event.description || "" }]);
  return (
    <Card className="reveal rounded-3xl p-4 shadow-[0_2px_0_rgba(23,55,45,0.08)]">
      <div className="flex items-center gap-3">
        <Link href={`/u/${event.organizer.handle}`}><Avatar user={{ displayName: event.organizer.displayName, avatarUrl: null }} className="h-11 w-11 rounded-full" /></Link>
        <div>
          <Link href={`/u/${event.organizer.handle}`} className="font-semibold hover:underline">{event.organizer.displayName}</Link>
          <p className="text-xs text-forest/70">{event.status === "cancelled" ? "Cancelled" : event.passed ? "Already started" : "Scheduled"} · {event.rsvpCount} going</p>
        </div>
      </div>
      <p className="mt-3 text-[11px] font-semibold uppercase tracking-wider text-goldink">{time.zone} ({event.timezone})</p>
      <h2 className="mt-1 font-serif text-xl font-semibold"><Link href={`/event/${event.id}`}>{event.title}</Link></h2>
      {event.description ? <p className="mt-2 whitespace-pre-wrap text-[15px] leading-relaxed text-forest/80">{description.textFor("event", event.id, event.description)}</p> : null}
      {description.enabled && <TranslateButton on={description.on} busy={description.busy} onClick={description.toggle} />}
      <p className="mt-2 text-sm text-forest/70">{event.place || "Online"}{event.group ? ` · ${event.group.name}` : ""}</p>
      <p className="mt-1 text-xs text-forest/60">On this device: {time.local}</p>
    </Card>
  );
}

export function EventDetail({ id }: { id: string }) {
  const { toast, bump, rev } = useApp();
  const [event, setEvent] = useState<Gathering | null>(null);
  const [error, setError] = useState("");
  const description = useContentTranslation([{ kind: "event", id, text: event?.description || "" }]);
  useEffect(() => {
    api<{ event: Gathering }>(`/api/events/${id}`).then((data) => { setEvent(data.event); setError(""); }).catch((err) => setError(err instanceof Error ? err.message : "Not found."));
  }, [id, rev]);
  if (error) return <Empty>{error}</Empty>;
  if (!event) return <Skeleton />;
  const time = when(event);
  return (
    <div className="space-y-4">
      <Link href="/events" className="text-sm text-goldink">All gatherings</Link>
      <Card className="p-5">
        <p className="text-xs font-semibold uppercase tracking-wider text-goldink">{event.status === "cancelled" ? "Cancelled" : event.passed ? "This gathering has already started" : "Scheduled"}</p>
        <h1 className="mt-1 font-serif text-3xl font-semibold">{event.title}</h1>
        <p className="mt-2 text-sm">{time.zone}</p>
        <p className="text-xs text-forest/60">{event.timezone}. On this device: {time.local}.</p>
        <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed">{description.textFor("event", id, event.description || "")}</p>
        {description.enabled && <TranslateButton on={description.on} busy={description.busy} onClick={description.toggle} />}
        {event.place && <p className="mt-3 text-sm"><b>Place.</b> {event.place}</p>}
        {event.onlineUrl && <p className="mt-1 text-sm"><b>Link.</b> <a className="underline" href={event.onlineUrl}>{event.onlineUrl}</a></p>}
        <p className="mt-3 text-sm text-forest/70">Hosted by <Link className="underline" href={`/u/${event.organizer.handle}`}>{event.organizer.displayName}</Link>{event.group ? <> · <Link className="underline" href={`/g/${event.group.id}`}>{event.group.name}</Link></> : null}</p>
        <p className="mt-1 text-sm">{event.rsvpCount} going. RSVPs stay on Spekup. No email or calendar invitation is sent.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {event.status === "scheduled" && !event.passed && <button onClick={async () => {
            try { await api(`/api/events/${id}/rsvp`, { method: event.viewerGoing ? "DELETE" : "POST" }); bump(); }
            catch (err) { toast(err instanceof Error ? err.message : "Couldn't update RSVP."); }
          }} className="rounded-full bg-forest px-4 py-2 text-sm font-semibold text-ivory">{event.viewerGoing ? "Cancel RSVP" : "RSVP"}</button>}
          {event.viewerCanManage && event.status === "scheduled" && <button onClick={async () => { await api(`/api/events/${id}/cancel`, { method: "POST" }); toast("Gathering cancelled."); bump(); }} className="rounded-full px-4 py-2 text-sm ring-1 ring-forest/20">Cancel gathering</button>}
        </div>
        {event.status === "cancelled" && <p className="mt-4 text-sm text-forest/70">This gathering was cancelled. New RSVPs are closed.</p>}
      </Card>
    </div>
  );
}
