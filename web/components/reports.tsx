"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api, rememberNext } from "@/lib/api";
import { tx } from "@/lib/i18n";
import { TranslateButton, useContentTranslation } from "./see-translation";
import { useApp } from "./context";
import { Avatar, Card, Empty, Heading, Skeleton, ThreeColumn, areaClass, choiceClass, fieldClass, orangeCta } from "./ui";

export const REPORT_CATEGORIES = [
  ["public_funds", "Public funds"],
  ["public_safety", "Public safety"],
  ["environment", "Environment"],
  ["housing", "Housing"],
  ["workplace", "Workplace"],
  ["services", "Services"],
  ["civic_process", "Civic process"],
  ["other", "Other"],
] as const;

const SUBJECTS = [
  ["politician", "Politician"],
  ["corporation", "Corporation"],
  ["community", "Community"],
] as const;

const STATUSES = [
  ["published", "Published allegation"],
  ["disputed", "Disputed"],
  ["resolved", "Resolved"],
  ["pending", "Pending moderation"],
  ["withdrawn", "Withdrawn"],
] as const;

type ReportCard = {
  id: string;
  title: string;
  subjectType: string;
  subjectLabel: string;
  subjectArea: string;
  category: string;
  status: string;
  locationLabel: string;
  latitude: number | null;
  longitude: number | null;
  incidentDate: string | null;
  updatedAt: string;
  createdAt: string;
  viewerFollowing?: boolean;
  author: { handle: string; displayName: string };
  detail?: string;
  sources?: Array<{ url: string; label: string; createdAt: string }>;
  history?: Array<{ action: string; note: string; createdAt: string }>;
  publicNote?: string;
  framing?: string;
  attachments?: Array<{ id: string; url: string }>;
};

type Pin = { id: string; title: string; latitude: number; longitude: number; status: string; subjectLabel: string };

function label(list: readonly (readonly [string, string])[], id: string) {
  return list.find((item) => item[0] === id)?.[1] || id;
}

export function Notice() {
  return (
    <Card className="mb-4 p-4 text-sm leading-relaxed text-forest/80">
      <p>{tx("If someone is in danger, call 911. Spekup does not contact police, does not dispatch help, and is not a place to file an official report.")}</p>
      <p className="mt-2">What you read here is an allegation with sources, not a finding that anyone committed a crime. A reviewed source is not a verdict, and there is no public vote.</p>
    </Card>
  );
}

export function ReportsView() {
  const { me, toast, bump, rev } = useApp();
  const [subjectType, setSubjectType] = useState("");
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState("");
  const [area, setArea] = useState("");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"recent" | "updated">("recent");
  const [following, setFollowing] = useState(false);
  const [bounds, setBounds] = useState<string>("");
  const [reports, setReports] = useState<ReportCard[] | null>(null);
  const [pins, setPins] = useState<Pin[]>([]);
  const [moderators, setModerators] = useState<boolean | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [formMounted, setFormMounted] = useState(false);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setFormOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams();
    if (subjectType) params.set("subjectType", subjectType);
    if (category) params.set("category", category);
    if (status) params.set("status", status);
    if (area.trim()) params.set("area", area.trim());
    if (q.trim()) params.set("q", q.trim());
    params.set("sort", sort);
    if (following) params.set("following", "1");
    if (bounds) params.set("bbox", bounds);
    const mapParams = new URLSearchParams(params);
    mapParams.delete("sort");
    let cancel = false;
    api<{ reports: ReportCard[] }>(`/api/reports?${params}`).then((data) => { if (!cancel) setReports(data.reports); }).catch((err) => { if (!cancel) { setReports([]); toast(err instanceof Error ? err.message : "Couldn't load reports."); } });
    api<{ reports: Pin[] }>(`/api/reports/map?${mapParams}`).then((data) => { if (!cancel) setPins(data.reports); }).catch(() => { if (!cancel) setPins([]); });
    return () => { cancel = true; };
  }, [subjectType, category, status, area, q, sort, following, bounds, rev]);

  useEffect(() => {
    api<{ configured: boolean }>("/api/reports/moderation-status").then((data) => setModerators(data.configured)).catch(() => setModerators(null));
  }, [rev]);

  function openForm() {
    if (!me) { rememberNext("/reports/new"); window.location.href = "/login"; return; }
    setFormMounted(true);
    setFormOpen(true);
  }

  return (
    <ThreeColumn
      id="reports"
      label="Report filters"
      rail={
        <div className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible">
          <button type="button" onClick={() => setFollowing((value) => !value)} className={choiceClass(following)}>Following</button>
          <button type="button" onClick={() => setSort(sort === "recent" ? "updated" : "recent")} className={choiceClass(false)}>{sort === "recent" ? "Newest" : "Recently updated"}</button>
          <button type="button" onClick={() => setSubjectType("")} className={choiceClass(subjectType === "")}>All subjects</button>
          {SUBJECTS.map(([id, name]) => <button type="button" key={id} onClick={() => setSubjectType(id)} className={choiceClass(subjectType === id)}>{name}</button>)}
          <button type="button" onClick={() => setCategory("")} className={choiceClass(category === "")}>All topics</button>
          {REPORT_CATEGORIES.map(([id, name]) => <button type="button" key={id} onClick={() => setCategory(id)} className={choiceClass(category === id)}>{name}</button>)}
          <button type="button" onClick={() => setStatus("")} className={choiceClass(status === "")}>Public statuses</button>
          {STATUSES.filter(([id]) => id !== "pending" && id !== "withdrawn").map(([id, name]) => <button type="button" key={id} onClick={() => setStatus(id)} className={choiceClass(status === id)}>{name}</button>)}
        </div>
      }
      side={<ReportRail reports={reports || []} />}
    >
      <Heading sub={tx("Allegations about public life, with sources, held for a person to review before they are public.")}>{tx("Crime & accountability")}</Heading>
      <div className="rounded-[28px] bg-white p-4 ring-1 ring-forest/10" data-testid="reports-composer">
        <button type="button" className="w-full rounded-full bg-ivory px-4 py-2.5 text-left text-sm text-forest/70 ring-1 ring-forest/10" onClick={openForm}>Describe an allegation</button>
        <div className="mt-3 flex flex-wrap gap-2">
          {me ? <Link href="/reports/new" className={orangeCta}>Write a report</Link> : <Link href="/login" className={orangeCta} onClick={() => rememberNext("/reports/new")}>Log in to write a report</Link>}
          {me?.moderator && <Link href="/moderation" className="rounded-full px-4 py-2 text-sm ring-1 ring-forest/20">Moderation queue</Link>}
        </div>
        {formMounted && (
          <div hidden={!formOpen} role="dialog" aria-label="New allegation" className="relative z-20 mt-4 rounded-2xl bg-ivory p-3 pb-28 lg:pb-3">
            <div className="mb-2 flex justify-end"><button type="button" aria-label="Close" className="rounded-full px-3 py-1 text-sm ring-1 ring-forest/15" onClick={() => setFormOpen(false)}>Close</button></div>
            <ReportForm />
          </div>
        )}
      </div>
      <Notice />
      {moderators === false && <Card className="p-4 text-sm text-forest/80">No moderator is configured on this preview. Your submissions stay visible only to you until an operator grants a moderator role. Nothing is published automatically.</Card>}
      <input aria-label="Filter by area" value={area} onChange={(e) => setArea(e.target.value)} placeholder="Neighborhood, city, or region" className={fieldClass} />
      <input aria-label="Search reports" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the words in public reports" className={fieldClass} />
      <ReportMap pins={pins} onBounds={setBounds} />
      {reports === null ? <Skeleton /> : reports.length === 0 ? <Empty>No public reports match. An empty list means nothing has been published, not that a place is safe or unsafe.</Empty> : reports.map((report) => <ReportSummary key={report.id} report={report} />)}
    </ThreeColumn>
  );
}

function ReportSummary({ report }: { report: ReportCard }) {
  return (
    <Card className="reveal overflow-hidden rounded-3xl p-4 shadow-[0_2px_0_rgba(23,55,45,0.08)]">
      <div className="flex items-center gap-3">
        <Link href={`/u/${report.author.handle}`}><Avatar user={{ displayName: report.author.displayName, avatarUrl: null }} className="h-11 w-11 rounded-full" /></Link>
        <div className="min-w-0 flex-1">
          <Link href={`/u/${report.author.handle}`} className="font-semibold hover:underline">{report.author.displayName}</Link>
          <p className="text-xs text-forest/70">{label(STATUSES, report.status)} · {report.locationLabel || "Area not listed"}</p>
        </div>
      </div>
      <p className="mt-3 text-[11px] font-semibold uppercase tracking-wider text-goldink">{label(SUBJECTS, report.subjectType)} · {label(REPORT_CATEGORIES, report.category)} · {label(STATUSES, report.status)}</p>
      <h2 className="mt-1 font-serif text-xl font-semibold"><Link href={`/reports/${report.id}`}>{report.title}</Link></h2>
      <p className="mt-1 text-sm text-forest/80">About {report.subjectLabel}. Said to have happened in {report.locationLabel}.{report.subjectArea ? ` Subject based in ${report.subjectArea}.` : ""}</p>
      {report.detail ? <p className="mt-2 whitespace-pre-wrap text-[15px] leading-relaxed text-forest/80">{report.detail}</p> : null}
    </Card>
  );
}

function ReportRail({ reports }: { reports: ReportCard[] }) {
  const areas = new Map<string, ReportCard[]>();
  for (const report of reports) {
    const area = report.locationLabel || report.subjectArea || "Area not listed";
    areas.set(area, [...(areas.get(area) || []), report]);
  }
  const groups = [...areas.entries()].slice(0, 4);
  return (
    <>
      <div className="rounded-3xl bg-white p-5 ring-1 ring-forest/10">
        <h3 className="font-serif text-lg font-semibold">Recent reports by area</h3>
        {reports.length === 0 ? <p className="mt-3 text-sm text-forest/70">No public reports yet.</p> : groups.map(([area, items]) => (
          <div key={area} className="mt-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-goldink">{area}</p>
            {items.slice(0, 2).map((report) => (
              <div key={report.id} className="mt-1">
                <p className="text-sm font-semibold">{report.title}</p>
                <Link href={`/reports/${report.id}`} aria-label="Open this report" className="text-xs font-semibold text-[#9A3412]">Open</Link>
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="rounded-3xl bg-forest p-5 text-sm text-ivory">
        <h3 className="font-serif text-lg font-semibold">How reporting works</h3>
        <p className="mt-2 text-ivory/85">An allegation stays with you until a moderator publishes it. No moderator is assigned in this preview, so nothing is published on its own. This is not a finding and not a call to the police.</p>
      </div>
    </>
  );
}

export function ReportMap({ pins, onBounds, onPick, pick }: { pins: Pin[]; onBounds?: (bbox: string) => void; onPick?: (lat: number, lng: number) => void; pick?: { lat: number; lng: number } | null }) {
  const host = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<import("leaflet").Map | null>(null);
  const layerRef = useRef<import("leaflet").LayerGroup | null>(null);
  const pickFn = useRef(onPick);
  pickFn.current = onPick;
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const leaflet = await import("leaflet");
      if (cancelled || !host.current || mapRef.current) return;
      const map = leaflet.map(host.current, { zoomControl: true }).setView(pick ? [pick.lat, pick.lng] : [20, 0], pick ? 8 : 2);
      leaflet.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 18,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(map);
      layerRef.current = leaflet.layerGroup().addTo(map);
      mapRef.current = map;
      const drop = (lat: number, lng: number) => {
        const round = (n: number) => Math.round(n * 100) / 100;
        pickFn.current?.(round(lat), round(lng));
      };
      map.on("click", (event) => drop(event.latlng.lat, event.latlng.lng));
      host.current.addEventListener("click", (event) => {
        const target = event.target as HTMLElement | null;
        if (target?.closest(".leaflet-control")) return;
        if (!mapRef.current) return;
        const at = mapRef.current.mouseEventToLatLng(event);
        drop(at.lat, at.lng);
      });
      map.whenReady(() => { map.invalidateSize(); window.setTimeout(() => map.invalidateSize(), 200); });
      setReady(true);
    })();
    return () => { cancelled = true; mapRef.current?.remove(); mapRef.current = null; };
  }, []);
  useEffect(() => {
    const leafletReady = mapRef.current && layerRef.current;
    if (!leafletReady) return;
    let cancelled = false;
    (async () => {
      const leaflet = await import("leaflet");
      if (cancelled || !layerRef.current) return;
      layerRef.current.clearLayers();
      for (const pin of pins) {
        leaflet.circleMarker([pin.latitude, pin.longitude], { radius: 8, color: "#17372D", fillColor: "#B9A16C", fillOpacity: 0.9 })
          .addTo(layerRef.current)
          .bindPopup(`${pin.title} — approximate area, not a home address`);
      }
      if (pick) leaflet.circleMarker([pick.lat, pick.lng], { radius: 10, color: "#7D6A3A", fillColor: "#17372D", fillOpacity: 1 }).addTo(layerRef.current);
    })();
    return () => { cancelled = true; };
  }, [pins, pick?.lat, pick?.lng, ready]);
  return (
    <div>
      <div ref={host} data-testid="report-map" className="h-80 overflow-hidden rounded-[28px] bg-sage ring-1 ring-forest/10" />
      <p className="mt-2 text-[11px] leading-relaxed text-forest/70">{tx("This map asks your browser to load tiles from OpenStreetMap at tile.openstreetmap.org. Spekup does not proxy those tiles and does not receive your map browsing from OpenStreetMap. Pins are approximate areas, not street addresses or the home of a named person. This is not Google Maps. If the tiles do not appear, the list still works.")}</p>
    </div>
  );
}

export function ReportForm({ existing }: { existing?: ReportCard | null }) {
  const { toast } = useApp();
  const [subjectType, setSubjectType] = useState(existing?.subjectType || "community");
  const [subjectLabel, setSubjectLabel] = useState(existing?.subjectLabel || "");
  const [subjectArea, setSubjectArea] = useState(existing?.subjectArea || "");
  const [category, setCategory] = useState(existing?.category || "civic_process");
  const [title, setTitle] = useState(existing?.title || "");
  const [detail, setDetail] = useState(existing?.detail || "");
  const [incidentDate, setIncidentDate] = useState(existing?.incidentDate || "");
  const [locationLabel, setLocationLabel] = useState(existing?.locationLabel || "");
  const [source, setSource] = useState(existing?.sources?.[0]?.url || "");
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(existing?.latitude != null && existing.longitude != null ? { lat: existing.latitude, lng: existing.longitude } : null);
  const [photo, setPhoto] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const payload = {
        subjectType, subjectLabel, subjectArea, category, title, detail, incidentDate: incidentDate || null, locationLabel,
        latitude: pin?.lat ?? null, longitude: pin?.lng ?? null,
        sources: source.trim() ? [{ url: source.trim(), label: "" }] : [],
      };
      const saved = existing
        ? await api<{ report: { id: string } }>(`/api/reports/${existing.id}`, { method: "PATCH", json: payload })
        : await api<{ report: { id: string } }>("/api/reports", { json: payload });
      if (photo && !existing) {
        const form = new FormData();
        form.set("file", photo);
        const uploaded = await api<{ media: { id: string } }>("/api/media", { form });
        await api(`/api/reports/${saved.report.id}/attachments`, { json: { mediaId: uploaded.media.id } });
      }
      toast(existing ? "Saved. A published allegation goes back to moderation." : "Submitted. Only you can see it until a moderator publishes it.");
      window.location.href = `/reports/${saved.report.id}`;
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't save the report.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <Notice />
      <div className="flex flex-wrap gap-2">{SUBJECTS.map(([id, name]) => <button type="button" key={id} onClick={() => setSubjectType(id)} className={`rounded-full px-3 py-1 text-sm ${subjectType === id ? "bg-forest text-ivory" : "bg-white ring-1 ring-forest/10"}`}>{name}</button>)}</div>
      <input aria-label="Subject name" value={subjectLabel} onChange={(e) => setSubjectLabel(e.target.value)} placeholder="Name you are writing about, in your own words" className={fieldClass} />
      <input aria-label="Subject area" value={subjectArea} onChange={(e) => setSubjectArea(e.target.value)} placeholder="Where that party is based (city or region, not a home)" className={fieldClass} />
      <select aria-label="Report category" value={category} onChange={(e) => setCategory(e.target.value)} className={fieldClass}>{REPORT_CATEGORIES.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>
      <input aria-label="Report title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" className={fieldClass} />
      <textarea aria-label="Allegation" value={detail} onChange={(e) => setDetail(e.target.value)} rows={5} placeholder="What you allege, in your own words" className={areaClass} />
      <input aria-label="Incident date" type="date" value={incidentDate || ""} onChange={(e) => setIncidentDate(e.target.value)} className={fieldClass} />
      <input aria-label="Incident area" value={locationLabel} onChange={(e) => setLocationLabel(e.target.value)} placeholder="Neighborhood or city where this is said to have happened" className={fieldClass} />
      <input aria-label="Source URL" value={source} onChange={(e) => setSource(e.target.value)} placeholder="https:// source a moderator can read" className={fieldClass} />
      <p className="text-xs text-forest/70">A public allegation needs at least one http or https source. Spekup does not fetch that page. Do not include a home address, a private phone number, or a minor's identity.</p>
      <ReportMap pins={[]} onPick={(lat, lng) => setPin({ lat, lng })} pick={pin} />
      {pin ? <p className="text-xs text-forest/70">{tx("Approximate pin")} {pin.lat.toFixed(2)}, {pin.lng.toFixed(2)}. <button type="button" className="underline" onClick={() => setPin(null)}>{tx("Remove")}</button></p> : <p className="text-xs text-forest/70">{tx("No pin added")}</p>}
      <label className="block text-sm">Optional photo. Only you can open it. It is not published.
        <input aria-label="Report photo" type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif,.heic,.heif" className="mt-1 block w-full text-sm" onChange={(e) => setPhoto(e.target.files?.[0] || null)} />
      </label>
      <button disabled={busy} className="rounded-full bg-forest px-5 py-2 text-sm font-semibold text-ivory disabled:opacity-40">{busy ? "Saving…" : existing ? "Save and send back for review" : "Submit for moderation"}</button>
    </form>
  );
}

export function NewReport() {
  const { me } = useApp();
  if (!me) return <Empty><Link href="/login" className="underline" onClick={() => rememberNext("/reports/new")}>Log in</Link> to write a report.</Empty>;
  return <div><Heading sub={tx("This stays private to you until a moderator publishes it.")}>{tx("New allegation")}</Heading><ReportForm /></div>;
}

export function ReportDetail({ id }: { id: string }) {
  const { me, toast, bump, rev } = useApp();
  const [report, setReport] = useState<ReportCard | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [flag, setFlag] = useState("");
  const [reply, setReply] = useState("");
  const [moderator, setModerator] = useState<boolean | null>(null);
  const allegation = useContentTranslation([{ kind: "report", id, text: report?.detail || "" }]);
  useEffect(() => {
    api<{ report: ReportCard }>(`/api/reports/${id}`).then((data) => { setReport(data.report); setError(""); }).catch((err) => setError(err instanceof Error ? err.message : "Not found."));
    api<{ configured: boolean }>("/api/reports/moderation-status").then((row) => setModerator(row.configured)).catch(() => setModerator(false));
  }, [id, rev]);
  if (error) return <Empty>{error}</Empty>;
  if (!report) return <Skeleton />;
  const own = me?.handle === report.author.handle;
  return (
    <div className="space-y-4">
      <Link href="/reports" className="text-sm text-goldink">All reports</Link>
      <Notice />
      {editing ? <ReportForm existing={report} /> : (
        <Card className="p-5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-goldink">Allegation · {label(STATUSES, report.status)} · not a verdict</p>
          <h1 className="mt-1 font-serif text-3xl font-semibold">{report.title}</h1>
          <p className="mt-2 text-sm text-forest/70">{label(SUBJECTS, report.subjectType)} · {report.subjectLabel}{report.subjectArea ? ` · based in ${report.subjectArea}` : ""}</p>
          {own && report.status === "pending" && moderator === false && <p className="mt-3 rounded-2xl bg-sage px-3 py-2 text-sm">{tx("Pending. No moderator is assigned in this preview, so it won't be published yet.")}</p>}
          <p className="text-sm text-forest/70">Said to have happened in {report.locationLabel}{report.incidentDate ? ` · ${report.incidentDate}` : ""}. {report.latitude != null ? `Approximate pin ${report.latitude.toFixed(2)}, ${report.longitude?.toFixed(2)}.` : "No map pin."}</p>
          {report.latitude != null && report.longitude != null && <div className="mt-3"><ReportMap pins={[{ id: report.id, title: report.title, latitude: report.latitude, longitude: report.longitude, status: report.status, subjectLabel: report.subjectLabel }]} pick={{ lat: report.latitude, lng: report.longitude }} /></div>}
          {own && (report.attachments || []).length > 0 && <div className="mt-3 space-y-2">{report.attachments?.map((file) => <img key={file.id} src={file.url} alt="Report photo, visible only to you" className="max-h-64 rounded-2xl" />)}</div>}
          <p className="mt-4 whitespace-pre-wrap text-[15px] leading-relaxed">{allegation.textFor("report", id, report.detail || "")}</p>
          {allegation.enabled && <TranslateButton on={allegation.on} busy={allegation.busy} onClick={allegation.toggle} />}
          {report.publicNote && <p className="mt-4 rounded-2xl bg-sage px-3 py-2 text-sm">Moderator note: {report.publicNote}</p>}
          <h2 className="mt-4 font-serif text-lg">Sources</h2>
          <ul className="mt-1 space-y-1 text-sm">{(report.sources || []).length === 0 ? <li>No source link yet. A moderator cannot publish this until there is one.</li> : report.sources?.map((source) => <li key={source.url}><a href={source.url} rel="noreferrer noopener" className="underline">{source.label || source.url}</a> <span className="text-forest/60">· {source.createdAt.slice(0, 10)}</span></li>)}</ul>
          <p className="mt-4 text-xs text-forest/60">Submitted by <Link className="underline" href={`/u/${report.author.handle}`}>{report.author.displayName}</Link>. Updated {report.updatedAt.slice(0, 10)}.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {own && report.status !== "withdrawn" && <button onClick={() => setEditing(true)} className="rounded-full bg-forest px-4 py-2 text-sm font-semibold text-ivory">Edit</button>}
            {own && report.status !== "withdrawn" && <button onClick={async () => { await api(`/api/reports/${id}/withdraw`, { method: "POST" }); toast("Withdrawn. It is no longer public."); bump(); }} className="rounded-full px-4 py-2 text-sm ring-1 ring-forest/20">Withdraw</button>}
            {["published", "disputed", "resolved"].includes(report.status) && <button onClick={async () => { await api(`/api/reports/${id}/follow`, { method: report.viewerFollowing ? "DELETE" : "POST" }); bump(); }} className="rounded-full px-4 py-2 text-sm ring-1 ring-forest/20">{report.viewerFollowing ? "Unfollow" : "Follow"}</button>}
          </div>
        </Card>
      )}
      {(report.history || []).length > 0 && <Card className="p-5"><h2 className="font-serif text-lg">Activity on Spekup</h2><ul className="mt-2 space-y-2 text-sm">{report.history?.map((item, index) => <li key={index}><b>{item.action}</b> · {item.createdAt.slice(0, 16).replace("T", " ")} · {item.note}</li>)}</ul></Card>}
      {["published", "disputed", "resolved"].includes(report.status) && me && (
        <Card className="p-5">
          <h2 className="font-serif text-lg">Flag or ask for a reply</h2>
          <p className="mt-1 text-xs text-forest/70">These stay inside Spekup. Nobody is emailed or called.</p>
          <textarea aria-label="Flag reason" value={flag} onChange={(e) => setFlag(e.target.value)} rows={2} placeholder="Why a moderator should look again" className={`${areaClass} mt-2`} />
          <button onClick={async () => { try { await api(`/api/reports/${id}/flags`, { json: { reason: flag } }); setFlag(""); toast("Flag saved for a moderator."); } catch (err) { toast(err instanceof Error ? err.message : "Couldn't save the flag."); } }} className="mt-2 rounded-full px-4 py-2 text-sm ring-1 ring-forest/20">Save flag</button>
          <textarea aria-label="Right of reply" value={reply} onChange={(e) => setReply(e.target.value)} rows={3} placeholder="Right-of-reply request. This is not published automatically." className={`${areaClass} mt-3`} />
          <button onClick={async () => { try { await api(`/api/reports/${id}/disputes`, { json: { statement: reply } }); setReply(""); toast("Request saved. No one was contacted."); } catch (err) { toast(err instanceof Error ? err.message : "Couldn't save the request."); } }} className="mt-2 rounded-full px-4 py-2 text-sm ring-1 ring-forest/20">Request a reply</button>
        </Card>
      )}
    </div>
  );
}

export function ProfileReports({ handle, self }: { handle: string; self: boolean }) {
  const [reports, setReports] = useState<ReportCard[] | null>(null);
  useEffect(() => {
    const path = self ? "/api/reports?mine=1" : `/api/users/${handle}/reports`;
    api<{ reports: ReportCard[] }>(path).then((data) => setReports(data.reports)).catch(() => setReports([]));
  }, [handle, self]);
  if (reports === null) return <Skeleton />;
  if (reports.length === 0) return <Empty>{self ? "You have not submitted a report." : "No published allegations from this account."}</Empty>;
  return <div className="space-y-3">{reports.map((report) => <ReportSummary key={report.id} report={report} />)}</div>;
}

export function ModerationView() {
  const { me, toast, bump, rev } = useApp();
  const [reports, setReports] = useState<ReportCard[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api<{ reports: ReportCard[] }>("/api/moderation/reports").then((data) => { setReports(data.reports); setError(""); }).catch((err) => setError(err instanceof Error ? err.message : "Not available."));
  }, [rev, me]);
  if (!me?.moderator && error) return <Empty>{error} Moderator access is granted by the operator, not by editing a profile.</Empty>;
  return (
    <div>
      <Heading sub="Pending allegations. Publishing one does not decide guilt.">Moderation</Heading>
      <FlagQueue />
      {reports === null ? <Skeleton /> : reports.length === 0 ? <Empty>No reports are waiting.</Empty> : reports.map((report) => (
        <Card key={report.id} className="mb-3 p-4">
          <h2 className="font-serif text-xl"><Link href={`/reports/${report.id}`}>{report.title}</Link></h2>
          <p className="text-sm text-forest/70">{report.subjectLabel} · {report.locationLabel}</p>
          <button onClick={async () => { try { await api(`/api/moderation/reports/${report.id}/publish`, { method: "POST" }); toast("Published as an allegation."); bump(); } catch (err) { toast(err instanceof Error ? err.message : "Couldn't publish."); } }} className="mt-3 rounded-full bg-forest px-4 py-2 text-sm font-semibold text-ivory">Publish allegation</button>
        </Card>
      ))}
    </div>
  );
}

function FlagQueue() {
  const [flags, setFlags] = useState<Array<{ id: string; reason: string; note: string; targetType: string; reporterHandle: string }> | null>(null);
  useEffect(() => {
    api<{ flags: Array<{ id: string; reason: string; note: string; targetType: string; reporterHandle: string }> }>("/api/moderation/flags").then((row) => setFlags(row.flags)).catch(() => setFlags([]));
  }, []);
  if (!flags || flags.length === 0) return null;
  return (
    <Card className="mb-4 p-4">
      <h2 className="font-serif text-lg">Post and comment flags</h2>
      <p className="mt-1 text-xs text-forest/70">Saved for a moderator. Nothing is hidden automatically.</p>
      <ul className="mt-2 space-y-1 text-sm">{flags.map((flag) => <li key={flag.id}>{flag.targetType} · {flag.reason} · @{flag.reporterHandle}{flag.note ? ` · ${flag.note}` : ""}</li>)}</ul>
    </Card>
  );
}
