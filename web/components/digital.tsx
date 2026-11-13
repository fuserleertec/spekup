"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ApiError, api, rememberNext } from "@/lib/api";
import type { Post } from "@/lib/types";
import { useApp } from "./context";
import { fieldClass, Heading, orangeCta } from "./ui";

type Listing = {
  id: string;
  title: string;
  editVersion: number;
  listingStatus: string;
  previews: Array<{ id: string; focalX: number; focalY: number }>;
  variants: Array<{ id: string; isFree: boolean }>;
};

export function DigitalPanel({ postId, digital }: { postId: string; digital: NonNullable<Post["digital"]> }) {
  const { me, toast } = useApp();
  const [note, setNote] = useState("");
  const [text, setText] = useState("");
  async function claim(variantId: string) {
    try {
      await api(`/api/digital/listings/${postId}/variants/${variantId}/claim`, { method: "POST", json: {} });
      toast("Saved in your library. Nothing was charged.");
      location.reload();
    } catch (err) {
      setNote(err instanceof Error ? err.message : "That file stayed private.");
    }
  }
  return (
    <div className="mt-3 rounded-2xl bg-ivory p-3 text-sm ring-1 ring-forest/10">
      <p className="font-semibold">Digital file · payments are not available</p>
      <p className="mt-1 text-forest/70">{digital.learningPurpose}</p>
      <p className="mt-1 text-forest/70">{digital.license === "commercial" ? "Commercial use, as the seller described it." : "Personal use."} {digital.allowsResale ? "" : "Resale is not included."} {digital.scan.label}</p>
      <p className="mt-1 text-xs text-forest/70">{digital.accessNote}</p>
      <div className="mt-2 flex gap-2 overflow-x-auto">
        {digital.previews.map((preview) => <img key={preview.id} src={preview.url} alt="" className="h-24 w-24 rounded-xl object-cover" style={{ objectPosition: `${preview.focalX}% ${preview.focalY}%` }} />)}
      </div>
      {digital.personalizationPrompt && <p className="mt-2">Personalization is a request, not an instant download: {digital.personalizationPrompt}</p>}
      <div className="mt-2 space-y-2">
        {digital.variants.map((variant) => (
          <div key={variant.id} className="flex flex-wrap items-center gap-2">
            <span>{variant.axisA} {variant.axisB} · {variant.isFree ? "Free" : variant.priceCents != null ? `$${(variant.priceCents / 100).toFixed(2)}` : "Paid"}</span>
            {variant.isFree && me && !variant.claimed && <button type="button" className={orangeCta} onClick={() => claim(variant.id)}>Claim</button>}
            {variant.downloadable && <a className="underline" href={`/api/digital/listings/${postId}/variants/${variant.id}/file`}>Download</a>}
            {!variant.isFree && <span>The full file stays private until a real payment provider is connected.</span>}
          </div>
        ))}
      </div>
      {me && digital.personalizationPrompt && (
        <form className="mt-2 space-y-2" onSubmit={async (event) => {
          event.preventDefault();
          try {
            await api(`/api/posts/${postId}/inquiries`, { json: { body: text, personalization: text } });
            setNote("Request saved here. It was not emailed, and no file was generated.");
          } catch (err) {
            setNote(err instanceof Error ? err.message : "Couldn't save that.");
          }
        }}>
          <textarea aria-label="Personalization request" value={text} onChange={(e) => setText(e.target.value)} className="w-full rounded-2xl border border-forest/15 px-3 py-2" rows={2} />
          <button className="rounded-full bg-forest px-4 py-2 text-sm font-semibold text-ivory">Send request</button>
        </form>
      )}
      {note && <p className="mt-2" role="status">{note}</p>}
    </div>
  );
}

export function DigitalForm({ embedded = false, existingId = "", onDraft }: { embedded?: boolean; existingId?: string; onDraft?: () => void } = {}) {
  const { me } = useApp();
  const router = useRouter();
  const [listing, setListing] = useState<Listing | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("A neighbor guide. Not medical advice.");
  const [purpose, setPurpose] = useState("A practical neighbor skill.");
  const [license, setLicense] = useState("personal");
  const [rights, setRights] = useState(false);
  const [free, setFree] = useState(true);
  const [price, setPrice] = useState("12.00");
  const [focalX, setFocalX] = useState(50);
  const [tag, setTag] = useState("guide");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const pending = useRef<Promise<Listing> | null>(null);
  useEffect(() => {
    if (!existingId) return;
    api<{ post: Post }>(`/api/posts/${existingId}`).then((row) => {
      const digital = row.post.digital as { editVersion?: number; learningPurpose?: string; license?: string | null; rightsDeclared?: boolean; tags?: string[]; variants?: Listing["variants"] } | undefined;
      setTitle(row.post.title);
      setBody(row.post.body);
      if (digital?.learningPurpose) setPurpose(digital.learningPurpose);
      if (digital?.license) setLicense(digital.license);
      if (digital?.rightsDeclared) setRights(true);
      if (digital?.tags?.length) setTag(digital.tags.join(", "));
      setListing({ id: existingId, title: row.post.title, editVersion: digital?.editVersion || 1, listingStatus: row.post.availability || "published", previews: [], variants: digital?.variants || [] });
    }).catch(() => setError("Couldn't open that digital listing."));
  }, [existingId]);
  if (!me) return embedded ? null : <Link href="/login" className={orangeCta} onClick={() => rememberNext("/shop/new")}>Log in to post a product</Link>;

  async function ensure() {
    onDraft?.();
    if (existingId) {
      const current = listing || { id: existingId, title, editVersion: 1, listingStatus: "published", previews: [], variants: [] };
      if (!listing) setListing(current);
      return current;
    }
    if (listing) return listing;
    if (!pending.current) {
      pending.current = api<{ listing: Listing }>("/api/digital/listings", { json: { title: title || "Untitled draft" } }).then((row) => {
        setListing(row.listing);
        return row.listing;
      });
    }
    return pending.current;
  }

  async function save() {
    setError("");
    try {
      const current = await ensure();
      const cents = Math.round(Number(price) * 100);
      const row = await api<{ listing: Listing }>(`/api/digital/listings/${current.id}`, {
        method: "PATCH",
        json: {
          editVersion: current.editVersion,
          title, body, digitalForm: "guide", contentFormat: "pdf", language: "en", learningPurpose: purpose,
          license, licenseTerms: "Seller-written terms. Not a legal warranty.", origin: "made", sellerRole: "creator",
          rightsDeclared: rights, allowsResale: false, tags: tag.split(",").map((item) => item.trim()).filter(Boolean),
          variants: [{ axisA: "PDF", axisB: license === "commercial" ? "Commercial" : "Personal", isFree: free, priceCents: free ? null : cents, sku: "GUIDE", available: true }],
          personalizationPrompt: "Tell the seller what to adjust. They deliver it by hand.",
        },
      });
      setListing(row.listing);
      setNote("Draft saved.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Not saved.");
    }
  }

  async function addPhoto(file: File) {
    const current = await ensure();
    const form = new FormData();
    form.set("file", file);
    const media = await api<{ media: { id: string } }>("/api/media", { form });
    const row = await api<{ listing: Listing }>(`/api/digital/listings/${current.id}`, { method: "PATCH", json: { previews: [{ mediaId: media.media.id, focalX, focalY: 50 }] } });
    setListing(row.listing);
    setNote("Preview stored.");
  }

  async function addFile(file: File) {
    const current = await ensure();
    const variantId = current.variants[0]?.id;
    const form = new FormData();
    form.set("file", file);
    const query = new URLSearchParams({ name: file.name });
    if (variantId) query.set("variantId", variantId);
    await api(`/api/digital/listings/${current.id}/files?${query}`, { form });
    const row = await api<{ listing: Listing }>(`/api/digital/listings/${current.id}`, { method: "PATCH", json: {} });
    setListing(row.listing);
    setNote("File stored.");
  }

  async function publish() {
    if (!listing) return setError("Save the draft first.");
    try {
      const row = await api<{ listing: Listing }>(`/api/digital/listings/${listing.id}/publish`, { method: "POST", json: { editVersion: listing.editVersion } });
      router.push(`/listing/${row.listing.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Not published.");
    }
  }

  return (
    <div className="space-y-4 overflow-x-hidden">
      {embedded ? <h3 className="font-serif text-xl">Digital file</h3> : <Heading sub="The cover is public. The full file stays private. A paid file cannot be downloaded while payments are off.">Digital file</Heading>}
      <p className="text-sm text-forest/70">The cover is public. The full file stays private. A paid file cannot be downloaded while payments are off. Before this can be published you need a preview photo, the full file, a learning purpose, and a confirmation that you have the right to distribute it.</p>
      <div className="grid gap-3 rounded-[28px] bg-white p-4 ring-1 ring-forest/10">
        <input aria-label="Digital title" value={title} maxLength={140} onChange={(e) => { setTitle(e.target.value); onDraft?.(); }} placeholder="Title, 140 characters" className={fieldClass} />
        <textarea aria-label="Digital description" value={body} onChange={(e) => setBody(e.target.value)} className="min-h-24 rounded-3xl border border-forest/15 px-4 py-3 text-sm" />
        <textarea aria-label="Learning purpose" value={purpose} onChange={(e) => setPurpose(e.target.value)} className="min-h-20 rounded-3xl border border-forest/15 px-4 py-3 text-sm" />
        <label className="text-sm">License
          <select aria-label="License" className={`${fieldClass} mt-1`} value={license} onChange={(e) => setLicense(e.target.value)}>
            <option value="personal">Personal use</option>
            <option value="commercial">Commercial use, seller terms</option>
          </select>
        </label>
        <label className="flex gap-2 text-sm"><input aria-label="Free version" type="checkbox" checked={free} onChange={(e) => setFree(e.target.checked)} /> This version is free. Paid versions stay locked.</label>
        {!free && <input aria-label="Price in dollars" value={price} onChange={(e) => setPrice(e.target.value)} className={fieldClass} />}
        <label className="text-sm">Tags, comma separated, up to 13<input aria-label="Tags" value={tag} onChange={(e) => setTag(e.target.value)} className={`${fieldClass} mt-1`} /></label>
        <label className="text-sm">Thumbnail focal point {focalX}
          <input aria-label="Focal point" type="range" min="0" max="100" value={focalX} onChange={(e) => setFocalX(Number(e.target.value))} className="w-full" />
        </label>
        <label className="text-sm">Preview photo, up to 8 MB. JPEG, PNG, WebP, or HEIC.<input aria-label="Preview photo" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif" className="mt-1 block w-full" onChange={(e) => { const file = e.target.files?.[0]; if (file) addPhoto(file).catch((err) => setError(err instanceof Error ? err.message : "Photo failed.")); }} /></label>
        <label className="flex gap-2 text-sm"><input aria-label="Distribution rights" type="checkbox" checked={rights} onChange={(e) => setRights(e.target.checked)} /> I have the right to distribute this file. Resale is not included.</label>
        <label className="text-sm">Full file, not the preview<input aria-label="Deliverable file" type="file" className="mt-1 block w-full" onChange={(e) => { const file = e.target.files?.[0]; if (file) addFile(file).catch((err) => setError(err instanceof Error ? err.message : "File failed.")); }} /></label>
        <label className="text-sm">Optional 15-second silent demo, up to 40 MB. MP4, WebM, or MOV.<input aria-label="Demo clip" type="file" accept="video/mp4,video/webm,video/quicktime,.mov" className="mt-1 block w-full" onChange={(e) => { const file = e.target.files?.[0]; if (!file || !listing) return; const form = new FormData(); form.set("file", file); api(`/api/digital/listings/${listing.id}/demo`, { form }).then(() => setNote("Demo queued. It is muted and must be 15 seconds or shorter.")).catch((err) => setError(err instanceof Error ? err.message : "Demo failed.")); }} /></label>
        {note && <p className="text-sm" role="status">{note}</p>}
        {error && <p className="text-sm text-red-800" role="alert">{error}</p>}
        <div className="flex flex-wrap gap-2">
          <button type="button" className="rounded-full px-4 py-2 text-sm ring-1 ring-forest/20" onClick={save}>Save draft</button>
          <button type="button" className={orangeCta} onClick={publish}>Publish preview</button>
        </div>
        <p className="text-xs text-forest/70">A draft is not in the shop, feed, or search. ZIP files are stored as-is and are not opened or scanned.</p>
      </div>
    </div>
  );
}

export function SellerShop({ handle }: { handle: string }) {
  const [shop, setShop] = useState<{ shop: { name: string }; listings: Array<{ id: string; title: string; digital_form: string; license_kind: string }> } | null>(null);
  useEffect(() => { api<NonNullable<typeof shop>>(`/api/shop/${handle}`).then(setShop).catch(() => setShop(null)); }, [handle]);
  if (!shop) return <p className="text-sm">That shop is not available.</p>;
  return (
    <div>
      <Heading sub="Public previews only. Full files are not on this page.">{shop.shop.name}</Heading>
      <div className="grid gap-3 sm:grid-cols-2">
        {shop.listings.map((item) => <Link key={item.id} href={`/listing/${item.id}`} className="rounded-2xl bg-white p-4 ring-1 ring-forest/10">{item.title}<span className="mt-1 block text-xs text-forest/70">{item.digital_form} · {item.license_kind}</span></Link>)}
      </div>
    </div>
  );
}

export function LibraryView() {
  const { me } = useApp();
  const [rows, setRows] = useState<Array<{ postId: string; variantId: string; title: string; isFree: boolean; availability: string }>>([]);
  useEffect(() => { if (me) api<{ grants: typeof rows }>("/api/library").then((row) => setRows(row.grants)).catch(() => setRows([])); }, [me]);
  if (!me) return <Link href="/login" className={orangeCta} onClick={() => rememberNext("/library")}>Log in to see your library</Link>;
  return (
    <div>
      <Heading sub="Free claims live here. A claim is not a payment, and a paid file is not unlocked.">Your library</Heading>
      {rows.length === 0 && <p className="text-sm text-forest/70">Nothing claimed yet.</p>}
      {rows.map((row) => (
        <div key={row.variantId} className="mt-3 rounded-2xl bg-white p-4 ring-1 ring-forest/10">
          <p className="font-semibold">{row.title}</p>
          <p className="text-xs text-forest/70">{row.availability === "archived" ? "The seller archived this. The file stays private." : "Download is checked against your account."}</p>
          {row.availability !== "archived" && row.isFree && <a className="mt-2 inline-block underline" href={`/api/digital/listings/${row.postId}/variants/${row.variantId}/file`}>Download</a>}
        </div>
      ))}
    </div>
  );
}
