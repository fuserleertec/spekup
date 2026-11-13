import { platformFeeCents } from "./money.js";
import type { Kind, ListingKind, PriceMode, Role, Topic } from "./validate.js";

export type PublicUser = {
  id: string;
  handle: string;
  displayName: string;
  bio: string;
  neighborhood: string;
  role: Role;
  avatarUrl: string | null;
  verification: { status: "not_available"; badge: null; label: "Not verified" };
  createdAt: string;
};

const verification = { status: "not_available" as const, badge: null, label: "Not verified" as const };

export function publicUser(row: {
  id: string;
  handle: string;
  display_name: string;
  bio: string;
  neighborhood: string;
  role: Role;
  avatar_media_id: string | null;
  created_at: Date | string;
}): PublicUser {
  return {
    id: row.id,
    handle: row.handle,
    displayName: row.display_name,
    bio: row.bio,
    neighborhood: row.neighborhood,
    role: row.role,
    avatarUrl: row.avatar_media_id ? `/api/media/${row.avatar_media_id}` : null,
    verification,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

export function priceLabel(kind: Kind, mode: PriceMode | null, cents: number | null) {
  if (!mode) return null;
  const amount = mode === "fixed" && cents != null ? money(cents) : null;
  if (kind === "ask") {
    if (mode === "fixed") return `Can pay ${amount}`;
    if (mode === "negotiable") return "Budget negotiable";
    if (mode === "free_service") return "Asking for a free service";
    return "Asking for free advice";
  }
  if (mode === "fixed") return amount;
  if (mode === "negotiable") return "Negotiable";
  if (mode === "free_service") return "Free service";
  return "Free advice";
}

export function money(cents: number) {
  const whole = Math.floor(cents / 100);
  const frac = String(cents % 100).padStart(2, "0");
  return `$${whole}.${frac}`;
}

type PostRow = {
  id: string;
  kind: Kind;
  title: string;
  body: string;
  topic: Topic;
  price_mode: PriceMode | null;
  price_cents: number | null;
  listing_kind: ListingKind | null;
  item_condition: "new" | "good" | "fair" | "worn" | null;
  quantity: number | null;
  availability: "available" | "unavailable" | "sold" | "archived";
  handoff: "pickup" | "delivery" | "either" | null;
  gallery: Array<{ id: string; url: string }> | null;
  media_id: string | null;
  group_id: string | null;
  group_name: string | null;
  group_visibility: "public" | "private" | null;
  video_real_id: string | null;
  video_status: "queued" | "processing" | "ready" | "failed" | null;
  video_duration_ms: number | null;
  video_width: number | null;
  video_height: number | null;
  video_error: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  was_edited: boolean;
  like_count: number;
  comment_count: number;
  liked: boolean;
  saved: boolean;
  author_id: string;
  author_handle: string;
  author_display_name: string;
  author_role: Role;
  author_neighborhood: string;
  author_avatar: string | null;
  author_created_at: Date | string;
  playbook_real_id: string | null;
  playbook_title: string | null;
  playbook_objective: string | null;
  playbook_weeks: number | null;
  playbook_steps: string | null;
  playbook_save_count: number | null;
  playbook_saved: boolean | null;
  linked_id: string | null;
  linked_title: string | null;
  linked_price_mode: PriceMode | null;
  linked_price_cents: number | null;
  linked_listing_kind: ListingKind | null;
  poll_subject_type: "politician" | "corporation" | "community" | null;
  poll_subject_label: string | null;
  poll_closes_at: Date | string | null;
  poll_timezone: string | null;
  poll_status: "open" | "closed" | "canceled" | null;
  poll_respondents: number | null;
  poll_options: Array<{ id: string; label: string; position: number; count: number }> | null;
  poll_viewer_option: string | null;
  poll_following: boolean | null;
  poll_history: Array<{ action: string; note: string; createdAt: string }> | null;
  fee_version: number | null;
  fee_bps: number | null;
  fee_label: string | null;
  fee_note: string | null;
  disclosure_sponsor: boolean;
  disclosure_paid: boolean;
  disclosure_ai: boolean;
  comments_enabled: boolean;
  download_allowed: boolean;
  held_for_review: boolean;
  caption_mode: "off" | "sidecar" | "burn_in";
  cover_headline: string;
  studio_project_id: string | null;
};

function pollPercent(count: number, respondents: number) {
  if (!respondents) return 0;
  return Math.round((count / respondents) * 1000) / 10;
}

function pollState(status: "open" | "closed" | "canceled", closesAt: string | null) {
  if (status === "canceled") return "canceled" as const;
  if (status === "closed") return "closed" as const;
  if (closesAt && new Date(closesAt).getTime() <= Date.now()) return "expired" as const;
  return "open" as const;
}

export function mapPost(row: PostRow, viewerId: string | null) {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    body: row.body,
    topic: row.topic,
    priceMode: row.price_mode,
    priceCents: row.price_cents,
    priceLabel: priceLabel(row.kind, row.price_mode, row.price_cents),
    listingKind: row.listing_kind,
    condition: row.item_condition,
    quantity: row.quantity,
    availability: row.availability || "available",
    handoff: row.handoff,
    images: Array.isArray(row.gallery) && row.gallery.length ? row.gallery : (row.media_id ? [{ id: row.media_id, url: `/api/media/${row.media_id}` }] : []),
    mediaUrl: row.media_id ? `/api/media/${row.media_id}` : null,
    group: row.group_id ? { id: row.group_id, name: row.group_name, visibility: row.group_visibility } : null,
    video: row.video_real_id
      ? {
          id: row.video_real_id,
          status: row.video_status,
          durationMs: row.video_duration_ms,
          width: row.video_width,
          height: row.video_height,
          error: row.video_status === "failed" ? row.video_error : null,
          posterUrl: row.video_status === "ready" ? `/api/videos/${row.video_real_id}/poster` : null,
          fileUrl: row.video_status === "ready" ? `/api/videos/${row.video_real_id}/file` : null,
          moderation: "format_check_only" as const,
        }
      : null,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    edited: Boolean(row.was_edited),
    disclosureSponsor: Boolean(row.disclosure_sponsor),
    disclosurePaid: Boolean(row.disclosure_paid),
    disclosureAi: Boolean(row.disclosure_ai),
    commentsEnabled: row.comments_enabled !== false,
    downloadAllowed: row.download_allowed !== false,
    heldForReview: Boolean(row.held_for_review),
    captionMode: row.caption_mode || "off",
    coverHeadline: row.cover_headline || "",
    captionUrl: row.caption_mode === "sidecar" && row.studio_project_id ? `/api/posts/${row.id}/captions.vtt` : null,
    cards: [] as Array<{ kind: string; targetId: string; title: string | null; note: string; unavailable: boolean }>,
    counts: { likes: row.like_count, comments: row.comment_count },
    viewer: { liked: row.liked, saved: row.saved, isAuthor: viewerId === row.author_id },
    author: publicUser({
      id: row.author_id,
      handle: row.author_handle,
      display_name: row.author_display_name,
      bio: "",
      neighborhood: row.author_neighborhood,
      role: row.author_role,
      avatar_media_id: row.author_avatar,
      created_at: row.author_created_at,
    }),
    playbook: row.playbook_real_id
      ? {
          id: row.playbook_real_id,
          title: row.playbook_title,
          objective: row.playbook_objective,
          weeks: row.playbook_weeks,
          steps: row.playbook_steps,
          reviewStatus: "not_reviewed" as const,
          saves: row.playbook_save_count ?? 0,
          viewerSaved: Boolean(row.playbook_saved),
          linkedListing: row.linked_id
            ? {
                id: row.linked_id,
                title: row.linked_title,
                priceMode: row.linked_price_mode,
                priceCents: row.linked_price_cents,
                priceLabel: priceLabel("offer", row.linked_price_mode, row.linked_price_cents),
                listingKind: row.linked_listing_kind,
              }
            : null,
        }
      : null,
    poll: row.poll_subject_type
      ? {
          subjectType: row.poll_subject_type,
          subjectLabel: row.poll_subject_label || "",
          closesAt: row.poll_closes_at ? new Date(row.poll_closes_at).toISOString() : null,
          timezone: row.poll_timezone || "UTC",
          status: row.poll_status || "open",
          state: pollState(row.poll_status || "open", row.poll_closes_at ? new Date(row.poll_closes_at).toISOString() : null),
          respondents: row.poll_respondents ?? 0,
          denominator: "respondents" as const,
          viewerChoice: row.poll_viewer_option,
          following: Boolean(row.poll_following),
          notice: "Counts are accounts that voted. This is not an election, not a representative sample, and not a finding about anyone.",
          options: (row.poll_options || []).map((option) => ({
            id: option.id,
            label: option.label,
            position: option.position,
            count: option.count,
            percent: pollPercent(option.count, row.poll_respondents ?? 0),
          })),
          history: (row.poll_history || []).map((item) => ({
            action: item.action,
            note: item.note,
            createdAt: item.createdAt,
          })),
        }
      : null,
    quote: row.kind === "offer" && row.fee_version != null
      ? row.price_mode === "fixed" && row.price_cents != null
        ? {
            applicable: true as const,
            scheduleVersion: row.fee_version,
            scheduleLabel: row.fee_label,
            scheduleNote: row.fee_note,
            currency: "USD" as const,
            listPriceCents: row.price_cents,
            platformFeeBps: row.fee_bps,
            platformFeeCents: platformFeeCents(row.price_cents, row.fee_bps || 0),
            sellerNetCents: row.price_cents - platformFeeCents(row.price_cents, row.fee_bps || 0),
            buyerTotalCents: row.price_cents,
            processorFeeCents: null,
            processorFeeStatus: "unknown_until_provider" as const,
            charged: false as const,
            finalPricing: false as const,
          }
        : {
            applicable: false as const,
            scheduleVersion: row.fee_version,
            scheduleLabel: row.fee_label,
            reason: "no_fixed_price" as const,
            platformFeeCents: 0,
            listPriceCents: null,
            sellerNetCents: null,
            buyerTotalCents: null,
            processorFeeCents: null,
            processorFeeStatus: "unknown_until_provider" as const,
            charged: false as const,
            finalPricing: false as const,
          }
      : null,
  };
}

export const POST_SELECT = `
  p.id, p.kind, p.title, p.body, p.topic, p.price_mode, p.price_cents, p.listing_kind, p.media_id,
  p.item_condition, p.quantity, p.availability, p.handoff,
  (
    select coalesce(json_agg(json_build_object('id', m.id, 'url', '/api/media/' || m.id::text, 'focalX', pi.focal_x, 'focalY', pi.focal_y) order by pi.position), '[]'::json)
    from post_images pi join media m on m.id = pi.media_id
    where pi.post_id = p.id
  ) as gallery,
  g.id as group_id, g.name as group_name, g.visibility as group_visibility,
  v.id as video_real_id, v.status as video_status, v.duration_ms as video_duration_ms,
  v.width as video_width, v.height as video_height, v.error as video_error,
  p.created_at, p.updated_at, (p.updated_at > p.created_at) as was_edited, p.author_id,
  u.handle as author_handle, u.display_name as author_display_name, u.role as author_role,
  u.neighborhood as author_neighborhood, u.avatar_media_id as author_avatar, u.created_at as author_created_at,
  (select count(*)::int from likes l where l.post_id = p.id) as like_count,
  (select count(*)::int from comments c where c.post_id = p.id and c.deleted_at is null) as comment_count,
  exists(select 1 from likes l where l.post_id = p.id and l.user_id = $1) as liked,
  exists(select 1 from saves s where s.post_id = p.id and s.user_id = $1) as saved,
  b.id as playbook_real_id, b.title as playbook_title, b.objective as playbook_objective,
  b.weeks as playbook_weeks, b.steps as playbook_steps,
  (select count(*)::int from playbook_saves ps where ps.playbook_id = b.id) as playbook_save_count,
  exists(select 1 from playbook_saves ps where ps.playbook_id = b.id and ps.user_id = $1) as playbook_saved,
  lp.id as linked_id, lp.title as linked_title, lp.price_mode as linked_price_mode,
  lp.price_cents as linked_price_cents, lp.listing_kind as linked_listing_kind,
  pl.subject_type as poll_subject_type, pl.subject_label as poll_subject_label,
  pl.closes_at as poll_closes_at, pl.timezone as poll_timezone, pl.status as poll_status,
  (select count(*)::int from poll_votes pv where pv.post_id = p.id) as poll_respondents,
  (
    select coalesce(json_agg(json_build_object(
      'id', o.id, 'label', o.label, 'position', o.position,
      'count', (select count(*)::int from poll_votes v where v.option_id = o.id)
    ) order by o.position), '[]'::json)
    from poll_options o where o.post_id = p.id
  ) as poll_options,
  (select pv.option_id from poll_votes pv where pv.post_id = p.id and pv.user_id = $1) as poll_viewer_option,
  exists(select 1 from poll_follows pf where pf.post_id = p.id and pf.user_id = $1) as poll_following,
  (
    select coalesce(json_agg(json_build_object(
      'action', e.action, 'note', e.note, 'createdAt', e.created_at
    ) order by e.created_at), '[]'::json)
    from poll_events e where e.post_id = p.id
  ) as poll_history,
  fs.version as fee_version, fs.platform_fee_bps as fee_bps, fs.label as fee_label, fs.note as fee_note,
  p.disclosure_sponsor, p.disclosure_paid, p.disclosure_ai, p.comments_enabled, p.download_allowed,
  p.held_for_review, p.caption_mode, p.cover_headline, p.studio_project_id
`;

export const POST_FROM = `
  from posts p
  join users u on u.id = p.author_id
  left join playbooks b on b.id = p.playbook_id and b.deleted_at is null
  left join posts lp on lp.id = b.linked_post_id and lp.deleted_at is null
  left join groups g on g.id = p.group_id
  left join videos v on v.id = p.video_id
  left join polls pl on pl.post_id = p.id
  left join lateral (
    select version, platform_fee_bps, label, note
    from fee_schedules
    where status = 'proposed_preview'
    order by version desc
    limit 1
  ) fs on true
`;
