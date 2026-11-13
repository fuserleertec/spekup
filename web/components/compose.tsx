"use client";

import { useEffect, useState } from "react";
import { ApiError, api } from "@/lib/api";
import { LISTING_KINDS, PRICE_MODES, TOPICS, centsToInput } from "@/lib/format";
import type { Kind, PollSubject, Post, Topic } from "@/lib/types";
import { useApp } from "./context";
import { areaClass, fieldClass } from "./ui";

export function ComposeModal({ kind, post, onClose }: { kind: Kind; post?: Post | null; onClose: () => void }) {
  const { toast, bump } = useApp();
  const [mode, setMode] = useState<Kind>(post?.kind || kind);
  const [title, setTitle] = useState(post?.title || "");
  const [body, setBody] = useState(post?.body || "");
  const [topic, setTopic] = useState<Topic>(post?.topic || "neighborhood");
  const [priceMode, setPriceMode] = useState(post?.priceMode || "negotiable");
  const [price, setPrice] = useState(centsToInput(post?.priceCents ?? null));
  const [listingKind, setListingKind] = useState(post?.listingKind || "service");
  const [file, setFile] = useState<File | null>(null);
  const [clip, setClip] = useState<File | null>(null);
  const [groupId, setGroupId] = useState(post?.group?.id || "");
  const [groups, setGroups] = useState<Array<{ id: string; name: string }>>([]);
  const [keepMedia, setKeepMedia] = useState(Boolean(post?.mediaUrl));
  const [options, setOptions] = useState<string[]>(post?.poll?.options.map((option) => option.label) || ["", ""]);
  const [subjectType, setSubjectType] = useState<PollSubject>(post?.poll?.subjectType || "community");
  const [subjectLabel, setSubjectLabel] = useState(post?.poll?.subjectLabel || "");
  const [closesAt, setClosesAt] = useState("");
  const [timezone, setTimezone] = useState(post?.poll?.timezone && post.poll.timezone !== "UTC" ? post.poll.timezone : "America/New_York");
  const [fields, setFields] = useState<Record<string, string> | null>(null);
  const [busy, setBusy] = useState(false);
  const locked = Boolean(post);
  const zones = ["America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "America/Phoenix", "Pacific/Honolulu", "UTC"];

  useEffect(() => {
    api<{ groups: Array<{ id: string; name: string }> }>("/api/groups?mine=1").then((data) => setGroups(data.groups)).catch(() => undefined);
  }, []);
  useEffect(() => { if (!post) setMode(kind); }, [kind, post]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFields(null);
    try {
      let mediaId: string | null = !file && keepMedia && post ? (post.mediaUrl?.split("/").pop() || null) : null;
      let videoId: string | null = !clip ? (post?.video?.id || null) : null;
      if (clip) {
        if (clip.size > 40 * 1024 * 1024) {
          setFields({ file: "The clip was not uploaded. Clips must be 40 MB or smaller and 0.2 to 30 seconds. Nothing was posted." });
          setBusy(false);
          return;
        }
        try {
          const form = new FormData();
          form.set("file", clip);
          const uploaded = await api<{ video: { id: string } }>("/api/videos", { form });
          videoId = uploaded.video.id;
        } catch (err) {
          const message = err instanceof Error ? err.message : "The clip did not upload.";
          setFields({ file: `The clip did not upload, so nothing was posted. ${message}` });
          setBusy(false);
          return;
        }
      }
      if (file) {
        if (file.size > 8 * 1024 * 1024) {
          setFields({ file: "The photo was not uploaded. Photos must be 8 MB or smaller. Nothing was posted." });
          setBusy(false);
          return;
        }
        try {
          const form = new FormData();
          form.set("file", file);
          const uploaded = await api<{ media: { id: string } }>("/api/media", { form });
          mediaId = uploaded.media.id;
        } catch (err) {
          const message = err instanceof Error ? err.message : "The photo did not upload.";
          setFields({ file: `The photo did not upload, so nothing was posted. ${message}` });
          setBusy(false);
          return;
        }
      }
      const payload: Record<string, unknown> = { kind: mode, title, body, topic, mediaId: mode === "poll" ? null : mediaId, videoId: mode === "poll" ? null : videoId, groupId: groupId || null, playbookId: mode === "poll" ? null : (post?.playbook?.id || null) };
      if (mode === "poll") {
        payload.subjectType = subjectType;
        payload.subjectLabel = subjectLabel;
        payload.options = options.map((option) => option.trim()).filter(Boolean);
        if (closesAt) {
          payload.closesAtLocal = closesAt;
          payload.timezone = timezone;
        }
      } else if (mode !== "share") {
        payload.priceMode = priceMode;
        if (priceMode === "fixed") payload.price = price;
        if (mode === "offer") payload.listingKind = listingKind;
      }
      if (post) await api(`/api/posts/${post.id}`, { method: "PATCH", json: payload });
      else await api("/api/posts", { json: payload });
      toast(post ? "Post updated." : "Posted to Spekup.");
      bump();
      onClose();
    } catch (err) {
      if (err instanceof ApiError) setFields(err.fields);
      toast(err instanceof Error ? err.message : "Couldn't save that.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      {!locked && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {(["share", "ask", "offer", "poll"] as Kind[]).map((item) => (
            <button type="button" key={item} onClick={() => setMode(item)} className={`rounded-full py-2 text-sm font-semibold ${mode === item ? "bg-forest text-ivory" : "bg-white ring-1 ring-forest/10"}`}>{item === "share" ? "Share" : item === "ask" ? "Ask" : item === "poll" ? "Poll" : "Offer"}</button>
          ))}
        </div>
      )}
      <input autoFocus aria-label={mode === "poll" ? "Poll question" : "Title"} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={mode === "poll" ? "Question" : mode === "share" ? "Title (optional)" : "Title"} className={fieldClass} />
      {fields?.title && <p className="text-xs text-rose-800">{fields.title}</p>}
      <textarea aria-label={mode === "poll" ? "Poll context" : "Post text"} value={body} onChange={(e) => setBody(e.target.value)} rows={4} placeholder={mode === "poll" ? "Context for a community opinion. This is not a report and not a verdict." : mode === "ask" ? "What do you need from a neighbor?" : mode === "offer" ? "What are you offering?" : "Share something with your neighbors…"} className={areaClass} />
      {fields?.body && <p className="text-xs text-rose-800">{fields.body}</p>}
      <div className="flex flex-wrap gap-2">{TOPICS.map((item) => <button type="button" key={item.id} onClick={() => setTopic(item.id)} className={`rounded-full px-3 py-1 text-sm ${topic === item.id ? "bg-forest text-ivory" : "bg-white ring-1 ring-forest/10"}`}>{item.label}</button>)}</div>
      {mode === "poll" && (
        <>
          <p className="text-xs text-forest/70">A poll is a community priority or opinion among people with accounts. It is not an election, not a representative sample, and not a finding about a person or a company. Sourced allegations stay in Reports.</p>
          <div className="flex flex-wrap gap-2">
            {([["politician", "Politician"], ["corporation", "Corporation"], ["community", "Community"]] as const).map(([id, label]) => (
              <button type="button" key={id} onClick={() => setSubjectType(id)} className={`rounded-full px-3 py-1 text-sm ${subjectType === id ? "bg-forest text-ivory" : "bg-white ring-1 ring-forest/10"}`}>{label}</button>
            ))}
          </div>
          <input aria-label="Subject name" value={subjectLabel} onChange={(e) => setSubjectLabel(e.target.value)} placeholder="Optional name. You type it. Nothing is looked up." className={fieldClass} />
          <div className="space-y-2">
            {options.map((option, index) => (
              <div key={index} className="flex gap-2">
                <input aria-label={`Option ${index + 1}`} value={option} onChange={(e) => setOptions(options.map((item, i) => i === index ? e.target.value : item))} placeholder={`Option ${index + 1}`} className={fieldClass} />
                {options.length > 2 && <button type="button" aria-label={`Remove option ${index + 1}`} onClick={() => setOptions(options.filter((_, i) => i !== index))} className="rounded-full px-3 text-sm ring-1 ring-forest/15">Remove</button>}
              </div>
            ))}
            {options.length < 6 && <button type="button" onClick={() => setOptions([...options, ""])} className="rounded-full px-3 py-1 text-sm ring-1 ring-forest/15">Add option</button>}
          </div>
          {fields?.options && <p className="text-xs text-rose-800">{fields.options}</p>}
          <label className="block text-sm">
            <span className="mb-1 block text-forest/70">Close time, optional</span>
            <input aria-label="Poll closes" type="datetime-local" value={closesAt} onChange={(e) => setClosesAt(e.target.value)} className={fieldClass} />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-forest/70">Close time zone</span>
            <select aria-label="Poll time zone" value={timezone} onChange={(e) => setTimezone(e.target.value)} className={fieldClass}>{zones.map((zone) => <option key={zone}>{zone}</option>)}</select>
          </label>
          <p className="text-xs text-forest/70">One account, one current choice. You can change or withdraw it until the poll closes. Ballots stay private. Totals update when you refresh. Nothing is emailed.</p>
        </>
      )}
      {mode !== "share" && mode !== "poll" && (
        <>
          <div className="flex flex-wrap gap-2">{PRICE_MODES.map((item) => <button type="button" key={item.id} onClick={() => setPriceMode(item.id)} className={`rounded-full px-3 py-1 text-sm ${priceMode === item.id ? "bg-forest text-ivory" : "bg-white ring-1 ring-forest/10"}`}>{item.label}</button>)}</div>
          {priceMode === "fixed" && <input aria-label="Dollar amount" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="25.00" className={fieldClass} />}
          {fields?.price && <p className="text-xs text-rose-800">{fields.price}</p>}
          <p className="text-xs text-forest/70">Amounts are dollars and cents, such as 25 or 25.00. Nothing is charged.</p>
        </>
      )}
      {mode === "offer" && (
        <div className="flex flex-wrap gap-2">{LISTING_KINDS.map((item) => <button type="button" key={item.id} onClick={() => setListingKind(item.id)} className={`rounded-full px-3 py-1 text-sm ${listingKind === item.id ? "bg-forest text-ivory" : "bg-white ring-1 ring-forest/10"}`}>{item.label}</button>)}</div>
      )}
      {mode !== "poll" && (
        <>
          <label className="block text-sm">
            <span className="mb-1 block text-forest/70">Photo</span>
            <input aria-label="Photo" type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif,.heic,.heif" className="block w-full text-sm" onChange={(e) => {
              const next = e.target.files?.[0] || null;
              setFile(next);
              if (next) setKeepMedia(false);
            }} />
          </label>
          <p className="text-xs text-forest/70">Photos: JPEG, PNG, WebP, GIF, or HEIC, up to 8 MB. HEIC is converted when this server can read it.</p>
          <label className="block text-sm">
            <span className="mb-1 block text-forest/70">Clip</span>
            <input data-testid="clip-file" aria-label="Clip" type="file" accept="video/mp4,video/webm,video/quicktime,.mov,.mp4,.webm" className="block w-full text-sm" onChange={(e) => {
              const next = e.target.files?.[0] || null;
              setClip(next);
            }} />
          </label>
        </>
      )}
      {mode !== "poll" && <p className="text-xs text-forest/70">Clips: MP4, WebM, or MOV, 0.2 to 30 seconds, up to 40 MB. MOV is converted to H.264. Spekup does not review what the clip shows. A photo and a clip can be on the same post. If either upload fails, nothing is posted.</p>}
      {!!groups.length && (
        <label className="block text-sm">
          <span className="mb-1 block text-forest/70">Group</span>
          <select aria-label="Group" value={groupId} onChange={(e) => setGroupId(e.target.value)} className={fieldClass}>
            <option value="">Neighborhood feed</option>
            {groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
          </select>
        </label>
      )}
      {post?.mediaUrl && keepMedia && !file && <p className="text-xs text-forest/70">Current photo stays attached. <button type="button" className="underline" onClick={() => setKeepMedia(false)}>Remove it</button></p>}
      {fields?.file && <p className="text-xs text-rose-800">{fields.file}</p>}
      <p className="text-xs text-forest/70">Share your own experience. Spekup is a neighbor space, not a government channel.</p>
      <button disabled={busy || !body.trim() || (mode === "poll" && (!title.trim() || options.filter((option) => option.trim()).length < 2))} className="w-full rounded-full bg-forest py-3 font-semibold text-ivory disabled:opacity-40">{busy ? "Saving…" : post ? "Save changes" : "Post"}</button>
    </form>
  );
}
