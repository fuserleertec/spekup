"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, api, csrfToken, refreshCsrf } from "@/lib/api";
import { TOPICS } from "@/lib/format";
import type { Topic } from "@/lib/types";
import { areaClass, fieldClass, orangeCta } from "./ui";

const TEMPLATES = [
  ["none", "No template", ""],
  ["grow", "Grow", "What is growing, and where does it come from? Keep the place general."],
  ["harvest", "Harvest", "What was harvested, and who is it for?"],
  ["prep", "Prep", "Show the steps. This is not a food-safety or medical certification."],
  ["sourcing", "Sourcing", "Name the local producer and how a neighbor can ask about it."],
  ["volunteer", "Volunteer", "What help is needed, and when?"],
  ["community_lesson", "Community lesson", "A neighbor lesson. Not a certified course and not medical advice."],
] as const;

const ZONES = ["America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "America/Phoenix", "Pacific/Honolulu", "UTC"];

type Segment = { videoId: string; startMs: number; endMs: number; speed: number };
type Project = {
  id: string;
  title: string;
  body: string;
  topic: Topic;
  template: string;
  status: string;
  originalVolume: number;
  voiceVolume: number;
  voiceoverId: string | null;
  captionMode: "off" | "sidecar" | "burn_in";
  commentsEnabled: boolean;
  downloadAllowed: boolean;
  remixPermission: string;
  disclosureSponsor: boolean;
  disclosurePaid: boolean;
  disclosureAi: boolean;
  rightsDeclared: boolean;
  healthClaim: boolean;
  reviewStatus: string;
  coverHeadline: string;
  coverTimeMs: number;
  timezone: string;
  scheduledAt: string | null;
  publishedPostId: string | null;
  segments: Segment[];
  overlays: Array<{ startMs: number; endMs: number; text: string; x: number; y: number; size: string }>;
  captions: Array<{ startMs: number; endMs: number; text: string }>;
  cards: Array<{ kind: string; targetId: string; title: string | null; note: string; unavailable: boolean }>;
  render: { phase: string; message: string | null; percent: null };
  reviewersConfigured: boolean;
  transcription: { connected: boolean; message: string };
  limits: { maxSeconds: number };
};

type Source = { id: string; status: string; durationMs: number | null; fileUrl: string | null };

export function VideoEditor({ id, onBack, onMeta }: { id: string; onBack?: () => void; onMeta?: (meta: { title: string; body: string; topic: Topic }) => void }) {
  return <Editor id={id} onBack={onBack} onMeta={onMeta} />;
}

function Editor({ id, onBack, onMeta }: { id: string; onBack?: () => void; onMeta?: (meta: { title: string; body: string; topic: Topic }) => void }) {
  const router = useRouter();
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const focused = useRef(false);
  const [project, setProject] = useState<Project | null>(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [sources, setSources] = useState<Source[]>([]);
  const [recording, setRecording] = useState(false);
  const [take, setTake] = useState<Blob | null>(null);
  const [consent, setConsent] = useState(false);
  const [schedule, setSchedule] = useState("");
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);

  async function load() {
    const row = await api<{ project: Project }>(`/api/studio/projects/${id}`);
    setProject(row.project);
    const clips = await api<{ videos: Source[] }>("/api/studio/sources");
    setSources(clips.videos);
  }
  useEffect(() => { load().catch((err) => setError(err instanceof Error ? err.message : "Couldn't open that project.")); }, [id]);
  useEffect(() => { if (project && !focused.current) { focused.current = true; headingRef.current?.focus(); } }, [project]);
  useEffect(() => {
    if (!sources.some((source) => source.status === "queued" || source.status === "processing")) return;
    const timer = window.setInterval(() => {
      api<{ videos: Source[] }>("/api/studio/sources").then((row) => setSources(row.videos)).catch(() => undefined);
    }, 1500);
    return () => window.clearInterval(timer);
  }, [sources]);
  useEffect(() => {
    if (!project || (project.render.phase !== "queued" && project.render.phase !== "running" && project.status !== "rendering")) return;
    const timer = window.setInterval(() => { load().catch(() => undefined); }, 1500);
    return () => window.clearInterval(timer);
  }, [project?.render.phase, project?.status]);

  if (!project) return <p className="text-sm">{error || "Opening the project…"}</p>;
  const prompt = TEMPLATES.find((item) => item[0] === project.template)?.[2];

  async function save(path: string, json: unknown) {
    setError("");
    setNote("");
    try {
      const method = path.endsWith("/segments") || path.endsWith("/overlays") || path.endsWith("/captions") || path.endsWith("/cards") ? "PUT" : path.includes("/schedule") || path.includes("/review") || path.includes("/import") ? "POST" : "PATCH";
      const row = await api<{ project: Project }>(path, { method, json });
      setProject(row.project);
      onMeta?.({ title: row.project.title, body: row.project.body, topic: row.project.topic });
      setNote(path.endsWith("/segments") ? "Track saved." : path.endsWith("/captions") ? "Captions saved." : "Saved.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That edit was not saved.");
    }
  }

  async function uploadSource(file: File) {
    const form = new FormData();
    form.set("file", file);
    await api("/api/videos", { form });
    await load();
  }

  function addSource(source: Source) {
    setProject((current) => {
      if (!current) return current;
      const end = source.durationMs || 1000;
      return { ...current, segments: [...current.segments, { videoId: source.id, startMs: 0, endMs: end, speed: 1 }] };
    });
  }

  async function record() {
    if (!consent) return setError("Confirm the microphone consent before recording.");
    const live = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.current = live;
    const media = new MediaRecorder(live);
    const chunks: Blob[] = [];
    media.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
    media.onstop = () => {
      live.getTracks().forEach((track) => track.stop());
      setTake(new Blob(chunks, { type: media.mimeType || "audio/webm" }));
      setRecording(false);
    };
    recorder.current = media;
    media.start();
    setRecording(true);
  }

  async function uploadTake(blob: Blob, name: string) {
    const form = new FormData();
    form.set("file", blob, name);
    const request = new XMLHttpRequest();
    const saved = await new Promise<{ audio: { id: string } }>((resolve, reject) => {
      request.open("POST", "/api/studio/audio?kind=voiceover");
      request.withCredentials = true;
      const token = csrfToken();
      if (token) request.setRequestHeader("x-csrf-token", token);
      request.onload = () => {
        const payload = JSON.parse(request.responseText || "{}");
        if (request.status >= 200 && request.status < 300) resolve(payload);
        else if (request.status === 403 && payload.error?.code === "csrf") {
          refreshCsrf().finally(() => reject(new ApiError(403, "csrf_refreshed", "Your sign-in check was refreshed. Try that again. Nothing was posted.", null)));
        } else reject(new ApiError(request.status, payload.error?.code || "upload_failed", payload.error?.message || "Upload failed.", null));
      };
      request.onerror = () => reject(new ApiError(0, "network", "Upload failed.", null));
      request.send(form);
    });
    const row = await api<{ project: Project }>(`/api/studio/projects/${id}/voiceover`, { json: { audioId: saved.audio.id } });
    setProject(row.project);
    setTake(null);
  }

  return (
    <div className="space-y-4 overflow-x-hidden" data-project-id={id}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 ref={headingRef} tabIndex={-1} className="font-serif text-2xl outline-none">Edit video</h2>
        {onBack && <button type="button" className="min-h-11 rounded-full px-4 text-sm ring-1 ring-forest/20" onClick={onBack}>Back to post</button>}
      </div>
      <p className="text-sm text-forest/70">Browser playback is an approximation. The published clip is the server render, 0.2 to 30 seconds and at most 40 MB after speed changes. {prompt}</p>
      <section className="rounded-[28px] bg-white p-4 ring-1 ring-forest/10">
        <h3 className="font-serif text-xl">Details</h3>
        <input aria-label="Studio title" value={project.title} onChange={(e) => { const title = e.target.value; setProject({ ...project, title }); onMeta?.({ title, body: project.body, topic: project.topic }); }} className={`${fieldClass} mt-3`} />
        <textarea aria-label="Description" value={project.body} onChange={(e) => { const body = e.target.value; setProject({ ...project, body }); onMeta?.({ title: project.title, body, topic: project.topic }); }} className={`${areaClass} mt-3`} rows={3} />
        <label className="mt-3 block text-sm">Template
          <select aria-label="Template" className={`${fieldClass} mt-1`} value={project.template} onChange={(e) => setProject({ ...project, template: e.target.value })}>{TEMPLATES.map((item) => <option key={item[0]} value={item[0]}>{item[1]}</option>)}</select>
        </label>
        <label className="mt-3 block text-sm">Category
          <select aria-label="Category" className={`${fieldClass} mt-1`} value={project.topic} onChange={(e) => setProject({ ...project, topic: e.target.value as Topic })}>{TOPICS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select>
        </label>
        <button type="button" className="mt-3 rounded-full bg-forest px-4 py-2 text-sm font-semibold text-ivory" onClick={() => save(`/api/studio/projects/${id}`, project)}>Save details</button>
      </section>
      <section className="rounded-[28px] bg-white p-4 ring-1 ring-forest/10">
        <h2 className="font-serif text-xl">Clips</h2>
        <p className="mt-1 text-sm text-forest/70">One track. Upload an MP4 or WebM you own. Speeds are 0.5, 1, 1.5, and 2, with pitch kept steady.</p>
        <p className="mt-1 text-sm text-forest/70">MP4, WebM, or MOV, up to 40 MB. MOV is converted to H.264. Photos elsewhere are up to 8 MB.</p>
        <input aria-label="Source clip" type="file" accept="video/mp4,video/webm,video/quicktime,.mov,.mp4,.webm" className="mt-3 block w-full text-sm" onChange={(e) => { const file = e.target.files?.[0]; if (file) uploadSource(file).catch((err) => setError(err instanceof Error ? err.message : "Upload failed.")); }} />
        <div className="mt-3 space-y-2">
          {sources.map((source) => (
            <div key={source.id} className="flex flex-wrap items-center gap-2 text-sm">
              <span>{source.status} · {source.durationMs ? `${(source.durationMs / 1000).toFixed(1)}s` : "length unknown"}</span>
              {source.fileUrl && <video className="h-16 rounded-lg" src={source.fileUrl} controls playsInline preload="metadata" />}
              <button type="button" className="underline" onClick={() => addSource(source)} disabled={source.status !== "ready"}>Add to track</button>
            </div>
          ))}
        </div>
        <div className="mt-3 space-y-3">
          {project.segments.map((segment, index) => (
            <div key={`${segment.videoId}-${index}`} className="grid gap-2 rounded-2xl bg-sage/40 p-3 sm:grid-cols-4">
              <label className="text-xs">Start ms<input aria-label={`Segment ${index + 1} start`} className={fieldClass} value={segment.startMs} onChange={(e) => updateSegment(index, { startMs: Number(e.target.value) })} /></label>
              <label className="text-xs">End ms<input aria-label={`Segment ${index + 1} end`} className={fieldClass} value={segment.endMs} onChange={(e) => updateSegment(index, { endMs: Number(e.target.value) })} /></label>
              <label className="text-xs">Speed
                <select aria-label={`Segment ${index + 1} speed`} className={fieldClass} value={segment.speed} onChange={(e) => updateSegment(index, { speed: Number(e.target.value) })}>
                  {[0.5, 1, 1.5, 2].map((speed) => <option key={speed} value={speed}>{speed}x</option>)}
                </select>
              </label>
              <button type="button" className="text-sm underline" onClick={() => setProject({ ...project, segments: project.segments.filter((_, item) => item !== index) })}>Remove</button>
            </div>
          ))}
        </div>
        {project.segments[0] && sources.find((source) => source.id === project.segments[0].videoId)?.fileUrl && (
          <div className="mt-3">
            <p className="text-xs text-forest/70">Approximate preview of the first clip at {project.segments[0].speed}x. The server render is the published file.</p>
            <video className="mt-2 max-h-48 rounded-2xl" src={sources.find((source) => source.id === project.segments[0].videoId)?.fileUrl || ""} controls playsInline preload="metadata" onLoadedMetadata={(e) => { e.currentTarget.playbackRate = project.segments[0].speed; }} />
          </div>
        )}
        <button type="button" className={`${orangeCta} mt-3`} onClick={() => save(`/api/studio/projects/${id}/segments`, { segments: project.segments })}>Save track</button>
        {note && <p className="mt-2 text-sm" role="status">{note}</p>}
      </section>
      <section className="rounded-[28px] bg-white p-4 ring-1 ring-forest/10">
        <h2 className="font-serif text-xl">Voiceover</h2>
        <p className="mt-1 text-sm text-forest/70">Nothing is recorded until you press Record, and nothing is uploaded until you press Upload recording. There is no voice cloning.</p>
        <label className="mt-3 flex items-start gap-2 text-sm"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} /> I agree to use the microphone for this recording only.</label>
        <div className="mt-3 flex flex-wrap gap-2">
          {!recording ? <button type="button" className={orangeCta} onClick={() => record().catch((err) => setError(err instanceof Error ? err.message : "The microphone was blocked."))}>Record</button> : <button type="button" className={orangeCta} onClick={() => recorder.current?.stop()}>Stop</button>}
          {recording && <span role="status">Recording</span>}
        </div>
        {take && <div className="mt-3 flex flex-wrap gap-2"><audio controls src={URL.createObjectURL(take)} /><button type="button" className="underline" onClick={() => uploadTake(take, "voiceover.webm").catch((err) => setError(err instanceof Error ? err.message : "Upload failed."))}>Upload recording</button><button type="button" className="underline" onClick={() => setTake(null)}>Delete take</button></div>}
        {project.voiceoverId && <p className="mt-2 text-sm">Recording attached.</p>}
        <label className="mt-3 block text-sm">Or choose an audio file you have the right to use
          <input aria-label="Voiceover file" type="file" accept="audio/*" className="mt-1 block w-full text-sm" onChange={(e) => { const file = e.target.files?.[0]; if (file) uploadTake(file, file.name).catch((err) => setError(err instanceof Error ? err.message : "Upload failed.")); }} />
        </label>
        <label className="mt-3 block text-sm">Original volume {project.originalVolume}
          <input aria-label="Original volume" type="range" min="0" max="1" step="0.05" value={project.originalVolume} onChange={(e) => setProject({ ...project, originalVolume: Number(e.target.value) })} className="w-full" />
        </label>
        <label className="mt-2 block text-sm">Voice volume {project.voiceVolume}
          <input aria-label="Voice volume" type="range" min="0" max="1" step="0.05" value={project.voiceVolume} onChange={(e) => setProject({ ...project, voiceVolume: Number(e.target.value) })} className="w-full" />
        </label>
        <button type="button" className="mt-3 text-sm underline" onClick={() => save(`/api/studio/projects/${id}`, { originalVolume: project.originalVolume, voiceVolume: project.voiceVolume })}>Save volumes</button>
      </section>
      <section className="rounded-[28px] bg-white p-4 ring-1 ring-forest/10">
        <h2 className="font-serif text-xl">Captions and cover</h2>
        <p className="mt-1 text-sm">{project.transcription.message}</p>
        <label className="mt-3 block text-sm">Caption delivery
          <select aria-label="Caption mode" className={`${fieldClass} mt-1`} value={project.captionMode} onChange={(e) => setProject({ ...project, captionMode: e.target.value as Project["captionMode"] })}>
            <option value="sidecar">Separate caption track</option>
            <option value="burn_in">Burned into the picture</option>
            <option value="off">Off</option>
          </select>
        </label>
        {project.captions.map((cue, index) => (
          <div key={index} className="mt-2 grid gap-2 sm:grid-cols-3">
            <input aria-label={`Caption ${index + 1} start`} className={fieldClass} value={cue.startMs} onChange={(e) => updateCaption(index, { startMs: Number(e.target.value) })} />
            <input aria-label={`Caption ${index + 1} end`} className={fieldClass} value={cue.endMs} onChange={(e) => updateCaption(index, { endMs: Number(e.target.value) })} />
            <input aria-label={`Caption ${index + 1} text`} className={fieldClass} value={cue.text} onChange={(e) => updateCaption(index, { text: e.target.value })} />
          </div>
        ))}
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className="underline" onClick={() => setProject({ ...project, captions: [...project.captions, { startMs: 0, endMs: 1000, text: "Caption" }] })}>Add caption</button>
          <button type="button" className="underline" onClick={() => save(`/api/studio/projects/${id}/captions`, { cues: project.captions })}>Save captions</button>
        </div>
        <textarea aria-label="Caption file" placeholder="Paste SRT or VTT" className={`${areaClass} mt-3`} rows={3} id="caption-file" />
        <button type="button" className="mt-2 text-sm underline" onClick={() => {
          const text = (document.getElementById("caption-file") as HTMLTextAreaElement | null)?.value || "";
          save(`/api/studio/projects/${id}/captions/import`, { text });
        }}>Import captions</button>
        <input aria-label="Cover headline" value={project.coverHeadline} onChange={(e) => setProject({ ...project, coverHeadline: e.target.value })} placeholder="Static cover headline" className={`${fieldClass} mt-3`} />
        <label className="mt-2 block text-sm">Cover frame, milliseconds<input aria-label="Cover time" className={fieldClass} value={project.coverTimeMs} onChange={(e) => setProject({ ...project, coverTimeMs: Number(e.target.value) })} /></label>
        <p className="mt-1 text-xs text-forest/70">The cover is one still frame plus that headline. It does not animate.</p>
      </section>
      <CardPicker project={project} onChange={(cards) => save(`/api/studio/projects/${id}/cards`, { cards })} />
      <section className="rounded-[28px] bg-white p-4 ring-1 ring-forest/10">
        <h2 className="font-serif text-xl">Disclose and publish</h2>
        <label className="mt-2 flex gap-2 text-sm"><input type="checkbox" checked={project.disclosureSponsor} onChange={(e) => setProject({ ...project, disclosureSponsor: e.target.checked })} /> Sponsor disclosure. This does not mean Spekup paid anyone.</label>
        <label className="mt-2 flex gap-2 text-sm"><input type="checkbox" checked={project.disclosurePaid} onChange={(e) => setProject({ ...project, disclosurePaid: e.target.checked })} /> Paid partnership. No payment is collected or sent here.</label>
        <label className="mt-2 flex gap-2 text-sm"><input type="checkbox" checked={project.disclosureAi} onChange={(e) => setProject({ ...project, disclosureAi: e.target.checked })} /> AI-generated or AI-assisted.</label>
        <label className="mt-2 flex gap-2 text-sm"><input aria-label="Recording rights" type="checkbox" checked={project.rightsDeclared} onChange={(e) => setProject({ ...project, rightsDeclared: e.target.checked })} /> I have the right to share this recording, and people shown agreed to be recorded.</label>
        <label className="mt-2 flex gap-2 text-sm"><input aria-label="Health claim" type="checkbox" checked={project.healthClaim} onChange={(e) => setProject({ ...project, healthClaim: e.target.checked })} /> This promotes a health or clinical claim. It stays private until a person reviews it. This app does not check whether the claim is true.</label>
        <label className="mt-2 flex gap-2 text-sm"><input type="checkbox" checked={project.commentsEnabled} onChange={(e) => setProject({ ...project, commentsEnabled: e.target.checked })} /> Allow comments</label>
        <label className="mt-2 flex gap-2 text-sm"><input type="checkbox" checked={project.downloadAllowed} onChange={(e) => setProject({ ...project, downloadAllowed: e.target.checked })} /> Show a download of the prepared clip. Hiding it is not copy protection.</label>
        <label className="mt-3 block text-sm">Remix preference
          <select aria-label="Remix preference" className={`${fieldClass} mt-1`} value={project.remixPermission} onChange={(e) => setProject({ ...project, remixPermission: e.target.value })}>
            <option value="none">No remix. Tools for duet or stitch are not in this version.</option>
            <option value="attributed_later">Record that an attributed remix may be allowed later. No remix tool is available now.</option>
          </select>
        </label>
        <button type="button" className="mt-3 rounded-full bg-forest px-4 py-2 text-sm font-semibold text-ivory" onClick={() => save(`/api/studio/projects/${id}`, project)}>Save disclosures</button>
        <p className="mt-3 text-sm" role="status">Render: {project.render.phase}. {project.render.message || "A percent is not shown because the server does not report one."}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className={orangeCta} onClick={() => api(`/api/studio/projects/${id}/render`, { method: "POST" }).then(() => load())}>Render</button>
          <button type="button" className="min-h-11 rounded-full px-4 text-sm ring-1 ring-forest/20" onClick={() => api(`/api/studio/projects/${id}/render/cancel`, { method: "POST" }).then(() => load())}>Cancel queued render</button>
          {project.healthClaim && project.reviewStatus !== "approved" ? <button type="button" className={orangeCta} onClick={() => save(`/api/studio/projects/${id}/review`, { action: "submit" })}>Submit for review</button> : <button type="button" className={orangeCta} onClick={() => api<{ postId: string }>(`/api/studio/projects/${id}/publish`, { method: "POST" }).then((row) => router.push(`/post/${row.postId}`)).catch((err) => setError(err instanceof Error ? err.message : "Publish failed."))}>Publish</button>}
        </div>
        {project.healthClaim && !project.reviewersConfigured && <p className="mt-2 text-sm">No reviewer is configured, so a health promotion cannot become public.</p>}
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <input aria-label="Schedule time" type="datetime-local" value={schedule} onChange={(e) => setSchedule(e.target.value)} className={fieldClass} />
          <select aria-label="Schedule time zone" className={fieldClass} value={project.timezone} onChange={(e) => setProject({ ...project, timezone: e.target.value })}>{ZONES.map((zone) => <option key={zone}>{zone}</option>)}</select>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" className="rounded-full px-4 py-2 text-sm ring-1 ring-forest/20" onClick={() => save(`/api/studio/projects/${id}/schedule`, { startsAtLocal: schedule, timezone: project.timezone })}>Schedule</button>
          <button type="button" className="text-sm underline" onClick={() => api(`/api/studio/projects/${id}/schedule/cancel`, { method: "POST" }).then(() => load())}>Cancel schedule</button>
        </div>
        {project.scheduledAt && <p className="mt-2 text-sm">Scheduled for {project.scheduledAt}. It stays private until then, and only if the render and any required review are still valid.</p>}
        {error && <p className="mt-3 text-sm text-red-800" role="alert">{error}</p>}
      </section>
    </div>
  );

  function updateSegment(index: number, patch: Partial<Segment>) {
    setProject({ ...project!, segments: project!.segments.map((segment, item) => item === index ? { ...segment, ...patch } : segment) });
  }
  function updateCaption(index: number, patch: Partial<Project["captions"][number]>) {
    setProject({ ...project!, captions: project!.captions.map((cue, item) => item === index ? { ...cue, ...patch } : cue) });
  }
}

function CardPicker({ project, onChange }: { project: Project; onChange: (cards: Array<{ kind: string; targetId: string }>) => void }) {
  const [kind, setKind] = useState("offer");
  const [choices, setChoices] = useState<Array<{ id: string; title: string; note: string }>>([]);
  useEffect(() => { api<{ cards: Array<{ id: string; title: string; note: string }> }>(`/api/studio/eligible?kind=${kind}`).then((row) => setChoices(row.cards)).catch(() => setChoices([])); }, [kind]);
  return (
    <section className="rounded-[28px] bg-white p-4 ring-1 ring-forest/10">
      <h2 className="font-serif text-xl">Cards</h2>
      <p className="mt-1 text-sm text-forest/70">Cards stay live on the post. They are not burned into the picture. A deleted, private, or archived card shows only that it is unavailable.</p>
      <select aria-label="Card type" className={`${fieldClass} mt-3`} value={kind} onChange={(e) => setKind(e.target.value)}>
        <option value="offer">Product</option>
        <option value="ask">Help request</option>
        <option value="cause">Cause</option>
        <option value="group">Group</option>
        <option value="event">Gathering</option>
        <option value="playbook">Community guide, not reviewed</option>
      </select>
      <div className="mt-2 space-y-1">
        {choices.map((choice) => <button type="button" key={choice.id} className="block text-left text-sm underline" onClick={() => onChange([...project.cards.filter((card) => card.title).map((card) => ({ kind: card.kind, targetId: card.targetId })), { kind, targetId: choice.id }])}>{choice.title} · {choice.note}</button>)}
        {choices.length === 0 && <p className="text-sm text-forest/70">Nothing you can attach in this category yet.</p>}
      </div>
      <div className="mt-2 space-y-1 text-sm">
        {project.cards.map((card) => <p key={card.targetId}>{card.unavailable ? "This card is no longer available." : `${card.title} · ${card.note}`}</p>)}
      </div>
    </section>
  );
}
