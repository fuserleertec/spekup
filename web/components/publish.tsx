"use client";

import { useEffect, useRef, useState } from "react";
import { ApiError, api, csrfToken, refreshCsrf } from "@/lib/api";
import { tx } from "@/lib/i18n";
import { TOPICS } from "@/lib/format";
import type { ListingKind, Post, PriceMode, Topic } from "@/lib/types";
import { DigitalForm } from "./digital";
import { VideoEditor } from "./studio";
import { areaClass, fieldClass, orangeCta } from "./ui";

type Group = { id: string; name: string };
type Shot = { key: string; file: File | null; previewUrl: string; mediaId: string | null };

export function ClipForm({ onDone, onCancel, projectId = "" }: { onDone: (post: Post) => void; onCancel: () => void; projectId?: string }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [topic, setTopic] = useState<Topic>("neighborhood");
  const [groupId, setGroupId] = useState("");
  const [groups, setGroups] = useState<Group[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [videoId, setVideoId] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [phase, setPhase] = useState("Choose a file");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const previewRef = useRef("");
  const [editorId, setEditorId] = useState(projectId);
  const [editing, setEditing] = useState(Boolean(projectId));
  const [drafts, setDrafts] = useState<Array<{ id: string; title: string; status: string }>>([]);

  useEffect(() => {
    api<{ groups: Group[] }>("/api/groups?mine=1").then((row) => setGroups(row.groups)).catch(() => setGroups([]));
    api<{ projects: Array<{ id: string; title: string; status: string }> }>("/api/studio/projects").then((row) => setDrafts(row.projects)).catch(() => setDrafts([]));
    return () => { if (previewRef.current) URL.revokeObjectURL(previewRef.current); };
  }, []);
  useEffect(() => {
    if (!projectId) return;
    setEditorId(projectId);
    setEditing(true);
  }, [projectId]);

  async function openEditor() {
    setError("");
    try {
      let id = editorId;
      if (!id) {
        const row = await api<{ project: { id: string } }>("/api/studio/projects", { json: { title: title.trim() || "Untitled clip", template: "none" } });
        id = row.project.id;
        await api(`/api/studio/projects/${id}`, { method: "PATCH", json: { title: title.trim() || "Untitled clip", body, topic } });
        setEditorId(id);
        setDrafts((current) => [{ id, title: title.trim() || "Untitled clip", status: "draft" }, ...current]);
      }
      setEditing(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The video editor did not open. Your text is still here.");
    }
  }

  function pick(next: File | null) {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    const url = next ? URL.createObjectURL(next) : "";
    previewRef.current = url;
    setFile(next);
    setVideoId(null);
    setPreview(url);
    setError("");
    setPhase(next ? "Ready to upload" : "Choose a file");
  }

  async function cancel() {
    xhrRef.current?.abort();
    xhrRef.current = null;
    if (videoId) await api(`/api/videos/${videoId}`, { method: "DELETE" }).catch(() => undefined);
    pick(null);
    setVideoId(null);
    setProgress(null);
    setBusy(false);
    onCancel();
  }

  async function submit() {
    if (busy) return;
    if (!file && !videoId) return setError("Choose an MP4 or WebM clip, 0.2 to 30 seconds, up to 40 MB.");
    if (!title.trim() || !body.trim()) return setError("Add a title and a caption.");
    setBusy(true);
    setError("");
    try {
      let id = videoId;
      if (!id && file) {
        setPhase("Uploading");
        setProgress(0);
        id = await uploadClip(file, setProgress, xhrRef);
        setVideoId(id);
      }
      setPhase("Preparing");
      const res = await api<{ post: Post }>("/api/posts", {
        json: { kind: "share", title, body, topic, videoId: id, groupId: groupId || null },
      });
      const ready = await waitForClip(res.post);
      setPhase(ready.video?.status === "failed" ? "Failed" : ready.video?.status === "ready" ? "Ready" : "Preparing");
      onDone(ready);
    } catch (err) {
      if (err instanceof ApiError && err.code === "aborted") return;
      setPhase("Not published");
      setError(err instanceof ApiError ? err.message : "The clip was not published. Your form is still here.");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  return (
    <div className="rounded-[28px] bg-white p-4 ring-1 ring-forest/10">
      <h2 className="font-serif text-2xl">Post a clip</h2>
      <p className="mt-1 text-sm text-forest/70">MP4, WebM, or MOV, 0.2 to 30 seconds, up to 40 MB. MOV is converted to H.264. The server checks the bytes, codec, and duration. A format check is not content moderation, and the original file stays private.</p>
      <div className="mt-4 grid gap-3">
        <label className="block rounded-2xl border border-dashed border-forest/25 p-4 text-sm" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); pick(e.dataTransfer.files?.[0] || null); }}>
          Drop a clip here or choose a file
          <input aria-label="Clip file" className="mt-2 block w-full text-sm" type="file" accept="video/mp4,video/webm,video/quicktime,.mov,.mp4,.webm" onChange={(e) => pick(e.target.files?.[0] || null)} />
        </label>
        {preview && <video className="max-h-64 w-full rounded-2xl bg-black" src={preview} controls playsInline preload="metadata" />}
        <input aria-label="Clip title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={140} placeholder="Title" className={fieldClass} />
        <textarea aria-label="Clip caption" value={body} maxLength={4000} onChange={(e) => setBody(e.target.value)} placeholder="Caption" className={areaClass} rows={4} />
        <label className="block text-sm font-medium">Category
          <select aria-label="Clip category" className={`${fieldClass} mt-1`} value={topic} onChange={(e) => setTopic(e.target.value as Topic)}>{TOPICS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select>
        </label>
        {groups.length > 0 && (
          <label className="block text-sm font-medium">Group
            <select aria-label="Clip group" className={`${fieldClass} mt-1`} value={groupId} onChange={(e) => setGroupId(e.target.value)}>
              <option value="">Neighborhood feed</option>
              {groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
            </select>
          </label>
        )}
        <p className="text-sm" role="status">{phase}{progress != null ? ` ${progress}%` : ""}</p>
        {error && <p className="text-sm text-red-800" role="alert">{error}</p>}
        <div className="flex flex-wrap gap-2">
          {!editorId && <button type="button" className={orangeCta} onClick={submit} disabled={busy}>{busy ? "Working…" : "Publish clip"}</button>}
          <button type="button" className={editorId ? orangeCta : "min-h-11 rounded-full border-2 border-[#C2410C] bg-[#FFF4E8] px-4 text-sm font-semibold text-[#9A3412]"} onClick={openEditor}>{editing ? "Edit video" : "Edit video"}</button>
          <button type="button" className="min-h-11 rounded-full px-4 py-2 text-sm ring-1 ring-forest/20" onClick={cancel}>Cancel</button>
        </div>
        {editorId && <p className="text-sm text-forest/70">Publishing happens in Edit video after the server render is ready. This form will not create a second post.</p>}
        {editing && editorId && (
          <VideoEditor id={editorId} onBack={() => setEditing(false)} onMeta={(meta) => { setTitle(meta.title); setBody(meta.body); setTopic(meta.topic); }} />
        )}
        {drafts.length > 0 && (
          <div className="rounded-2xl bg-ivory p-3 text-sm">
            <p className="font-semibold">Saved video drafts</p>
            <div className="mt-2 flex flex-col items-start gap-1">
              {drafts.map((draft) => <button type="button" key={draft.id} className="underline" onClick={() => { setEditorId(draft.id); setEditing(true); }}>{draft.title} · {draft.status}</button>)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

type ProductChoice = "physical" | "digital" | "service";

function choiceFor(post?: Post | null, initial?: ProductChoice): ProductChoice {
  if (post?.listingKind === "digital_guide") return "digital";
  if (post?.listingKind === "service") return "service";
  if (post?.listingKind === "local_good") return "physical";
  return initial || "physical";
}

export function ProductForm({ existing, onDone, initialKind = "physical" }: { existing?: Post | null; onDone: (post: Post) => void; initialKind?: ProductChoice }) {
  const [title, setTitle] = useState(existing?.title || "");
  const [body, setBody] = useState(existing?.body || "");
  const [topic, setTopic] = useState<Topic>(existing?.topic || "neighborhood");
  const [choice, setChoice] = useState<ProductChoice>(choiceFor(existing, initialKind));
  const [pendingChoice, setPendingChoice] = useState<ProductChoice | null>(null);
  const [digitalDraft, setDigitalDraft] = useState(existing?.listingKind === "digital_guide");
  const listingKind: ListingKind = choice === "service" ? "service" : "local_good";
  const [priceMode, setPriceMode] = useState<PriceMode>(existing?.priceMode || "fixed");
  const [price, setPrice] = useState(existing?.priceCents != null ? (existing.priceCents / 100).toFixed(2) : "");
  const [condition, setCondition] = useState(existing?.condition || "good");
  const [quantity, setQuantity] = useState(existing?.quantity != null ? String(existing.quantity) : "1");
  const [handoff, setHandoff] = useState(existing?.handoff || "pickup");
  const [availability, setAvailability] = useState(existing?.availability || "available");
  const [shots, setShots] = useState<Shot[]>((existing?.images || []).map((image) => ({ key: image.id, file: null, previewUrl: image.url, mediaId: image.id })));
  const [error, setError] = useState("");
  const [photoError, setPhotoError] = useState("");
  const [busy, setBusy] = useState(false);

  function requestChoice(next: ProductChoice) {
    if (existing || next === choice) return;
    const dirty = choice === "digital" ? digitalDraft : Boolean(title.trim() || body.trim() || shots.length || price.trim());
    setPhotoError("");
    if (dirty) setPendingChoice(next);
    else setChoice(next);
  }

  function addFiles(files: File[]) {
    const next = files.slice(0, Math.max(0, 6 - shots.length)).map((file) => ({ key: crypto.randomUUID(), file, previewUrl: URL.createObjectURL(file), mediaId: null }));
    setShots((current) => [...current, ...next].slice(0, 6));
  }

  async function submit() {
    if (busy) return;
    const count = Number(quantity);
    if (!title.trim() || !body.trim()) return setError("Add a title and a description.");
    if (choice === "physical" && shots.length === 0) {
      setPhotoError("Add at least one photo you own.");
      return;
    }
    setPhotoError("");
    if (priceMode === "fixed" && !/^\d{1,7}(\.\d{1,2})?$/.test(price.trim())) return setError("Enter a price in dollars and cents, from $0.01 to $1,000,000.00.");
    if (listingKind === "local_good" && (!Number.isInteger(count) || count < 0 || count > 10000)) return setError("Quantity is a whole number from 0 to 10000.");
    setBusy(true);
    setError("");
    try {
      const uploaded = shots.map((shot) => ({ ...shot }));
      for (const shot of uploaded) {
        if (shot.mediaId || !shot.file) continue;
        const form = new FormData();
        form.set("file", shot.file);
        const saved = await api<{ media: { id: string } }>("/api/media", { form });
        shot.mediaId = saved.media.id;
      }
      setShots(uploaded);
      const payload: Record<string, unknown> = {
        kind: "offer",
        title,
        body,
        topic,
        listingKind,
        priceMode,
        imageIds: uploaded.map((shot) => shot.mediaId),
        availability,
      };
      if (priceMode === "fixed") payload.price = price.trim();
      if (listingKind === "local_good") {
        payload.condition = condition;
        payload.quantity = count;
        payload.handoff = handoff;
      }
      const res = await api<{ post: Post }>(existing ? `/api/posts/${existing.id}` : "/api/posts", {
        method: existing ? "PATCH" : "POST",
        json: payload,
      });
      onDone(res.post);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "The listing was not saved. Your photos and text are still here.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-[28px] bg-white p-4 ring-1 ring-forest/10">
      <h2 className="font-serif text-2xl">{existing ? "Edit listing" : "Post a product"}</h2>
      <p className="mt-1 text-sm text-forest/70">Choose a physical good, a digital file, or a service. Checkout and payment are not connected. A proposed 5% fee on a fixed price is not charged.</p>
      <div role="radiogroup" aria-label="Product type" className="mt-4 flex flex-wrap gap-2">
        {([["physical", "Physical good"], ["digital", "Digital file"], ["service", "Service"]] as const).map(([id, label]) => (
          <button type="button" key={id} role="radio" aria-checked={choice === id} className={choice === id ? orangeCta : "min-h-11 rounded-full border-2 border-[#C2410C] bg-[#FFF4E8] px-4 text-sm font-semibold text-[#9A3412]"} onClick={() => requestChoice(id)} disabled={Boolean(existing) && choice !== id}>{label}</button>
        ))}
      </div>
      {existing && <p className="mt-2 text-sm text-forest/70">This listing stays a {choice === "digital" ? "digital file" : choice === "service" ? "service" : "physical good"}. Changing the type would be a different product.</p>}
      {pendingChoice && (
        <div className="mt-3 rounded-2xl bg-ivory p-3 text-sm" role="alert">
          <p>Switching keeps what you already saved. It does not delete files, and it does not publish this product.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className="underline" onClick={() => setPendingChoice(null)}>Stay</button>
            <button type="button" className={orangeCta} onClick={() => { setChoice(pendingChoice); setPendingChoice(null); }}>Switch and keep the draft</button>
          </div>
        </div>
      )}
      {choice === "digital" ? <div className="mt-4"><DigitalForm embedded existingId={existing?.listingKind === "digital_guide" ? existing.id : ""} onDraft={() => setDigitalDraft(true)} /></div> : null}
      {choice !== "digital" && <div className="mt-4 grid gap-3">
        <div className="rounded-2xl border border-dashed border-forest/25 p-4 text-sm">
          <p>{choice === "physical" ? "Photos. Required for a physical good." : "Photos. Optional. A service can be text only."} Up to 6. JPEG, PNG, WebP, or HEIC, up to 8 MB each.</p>
          <input aria-label="Product photos" aria-invalid={Boolean(photoError)} aria-describedby={photoError ? "product-photo-error" : undefined} className="mt-2 block w-full text-sm" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif" multiple onChange={(e) => { setPhotoError(""); addFiles([...(e.target.files || [])]); }} />
          {photoError && <p id="product-photo-error" className="mt-2 text-sm text-red-800" role="alert">{photoError}</p>}
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {shots.map((shot, index) => (
            <div key={shot.key} className="rounded-2xl bg-sage/50 p-2">
              <img src={shot.previewUrl} alt="" className="h-24 w-full rounded-xl object-cover" />
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" className="text-xs underline" onClick={() => setShots((rows) => move(rows, index, -1))} disabled={index === 0}>Earlier</button>
                <button type="button" className="text-xs underline" onClick={() => setShots((rows) => move(rows, index, 1))} disabled={index === shots.length - 1}>Later</button>
                <button type="button" className="text-xs underline" onClick={() => setShots((rows) => rows.filter((row) => row.key !== shot.key))}>Remove</button>
              </div>
            </div>
          ))}
        </div>
        <input aria-label="Listing title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={140} placeholder="Title" className={fieldClass} />
        <textarea aria-label="Listing description" value={body} maxLength={4000} onChange={(e) => setBody(e.target.value)} placeholder="Description" className={areaClass} rows={4} />
        <label className="block text-sm font-medium">Category
          <select aria-label="Listing category" className={`${fieldClass} mt-1`} value={topic} onChange={(e) => setTopic(e.target.value as Topic)}>{TOPICS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select>
        </label>
        <label className="block text-sm font-medium">Price
          <select aria-label="Price mode" className={`${fieldClass} mt-1`} value={priceMode} onChange={(e) => setPriceMode(e.target.value as PriceMode)}>
            <option value="fixed">Fixed price</option>
            <option value="negotiable">Negotiable</option>
            <option value="free_service">Free service</option>
            <option value="free_advice">Free advice</option>
          </select>
        </label>
        {priceMode === "fixed" && <input aria-label="Amount in USD" value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" placeholder="12.00" className={fieldClass} />}
        {priceMode === "fixed" && <LiveQuote dollars={price} />}
        {listingKind === "local_good" && (
          <>
            <label className="block text-sm font-medium">Condition
              <select aria-label="Condition" className={`${fieldClass} mt-1`} value={condition || "good"} onChange={(e) => setCondition(e.target.value as NonNullable<Post["condition"]>)}>
                <option value="new">New</option>
                <option value="good">Good</option>
                <option value="fair">Fair</option>
                <option value="worn">Worn</option>
              </select>
            </label>
            <input aria-label="Quantity" value={quantity} onChange={(e) => setQuantity(e.target.value)} inputMode="numeric" placeholder="1" className={fieldClass} />
            <label className="block text-sm font-medium">How a neighbor can receive it
              <select aria-label="Handoff" className={`${fieldClass} mt-1`} value={handoff || "pickup"} onChange={(e) => setHandoff(e.target.value as NonNullable<Post["handoff"]>)}>
                <option value="pickup">Pickup</option>
                <option value="delivery">Delivery — arranged in the inquiry, not shipped here</option>
                <option value="either">Either</option>
              </select>
            </label>
          </>
        )}
        {existing && (
          <label className="block text-sm font-medium">Availability
            <select aria-label="Availability" className={`${fieldClass} mt-1`} value={availability} onChange={(e) => setAvailability(e.target.value as NonNullable<Post["availability"]>)}>
              <option value="available">Available</option>
              <option value="unavailable">Unavailable</option>
              <option value="sold">Sold</option>
              <option value="archived">Archived</option>
            </select>
          </label>
        )}
        {error && <p className="text-sm text-red-800" role="alert">{error}</p>}
        <button type="button" className={orangeCta} onClick={submit} disabled={busy}>{busy ? "Saving…" : existing ? "Save listing" : "Publish listing"}</button>
      </div>}
    </div>
  );
}

function dollarsToCents(raw: string) {
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(raw.trim())) return null;
  const [whole, frac = ""] = raw.trim().split(".");
  return Number(whole) * 100 + Number((frac + "00").slice(0, 2));
}

function money(cents: number) {
  return `$${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

function LiveQuote({ dollars }: { dollars: string }) {
  const cents = dollarsToCents(dollars);
  const fee = cents == null ? null : Math.floor((cents * 500) / 10_000);
  return (
    <div className="rounded-2xl bg-ivory p-3 text-sm" data-testid="listing-quote">
      <p className="font-semibold">{tx("Quote only, not a charge. Payments are off.")}</p>
      {cents == null || fee == null ? <p className="mt-1 text-forest/70">Enter a price such as 40 or 40.00 to see the 5% quote.</p> : (
        <>
          <p className="mt-1">{tx("List price {{amount}}", { amount: money(cents) })}</p>
          <p>{tx("Platform fee {{fee}} (500 basis points)", { fee: money(fee) })}</p>
          <p>{tx("Seller net {{net}}", { net: money(cents - fee) })}</p>
          <p>{tx("Buyer total {{total}}", { total: money(cents) })}</p>
        </>
      )}
    </div>
  );
}

function move<T>(rows: T[], index: number, direction: number) {
  const next = [...rows];
  const target = index + direction;
  if (target < 0 || target >= next.length) return rows;
  const [item] = next.splice(index, 1);
  next.splice(target, 0, item);
  return next;
}

function uploadClip(file: File, onProgress: (value: number) => void, xhrRef: { current: XMLHttpRequest | null }) {
  return new Promise<string>((resolve, reject) => {
    const body = new FormData();
    body.set("file", file);
    const request = new XMLHttpRequest();
    xhrRef.current = request;
    request.open("POST", "/api/videos");
    request.withCredentials = true;
    const token = csrfToken();
    if (token) request.setRequestHeader("x-csrf-token", token);
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)));
    };
    request.onload = () => {
      const payload = JSON.parse(request.responseText || "{}");
      if (request.status >= 200 && request.status < 300) resolve(payload.video.id);
      else if (request.status === 403 && payload.error?.code === "csrf") {
        refreshCsrf().finally(() => reject(new ApiError(403, "csrf_refreshed", "Your sign-in check was refreshed. Try that again. Nothing was posted.", null)));
      } else reject(new ApiError(request.status, payload.error?.code || "upload_failed", payload.error?.message || "Upload failed.", payload.error?.fields || null));
    };
    request.onerror = () => reject(new ApiError(0, "network", "Upload failed.", null));
    request.onabort = () => reject(new ApiError(0, "aborted", "Upload canceled.", null));
    request.send(body);
  });
}

async function waitForClip(post: Post) {
  let current = post;
  for (let i = 0; i < 40 && current.video && current.video.status !== "ready" && current.video.status !== "failed"; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    current = await api<{ post: Post }>(`/api/posts/${post.id}`).then((row) => row.post);
  }
  return current;
}
