export type Role = "resident" | "organizer" | "civic_professional" | "community_business";
export type Kind = "share" | "ask" | "offer" | "poll";
export type PollSubject = "politician" | "corporation" | "community";
export type PollState = "open" | "closed" | "expired" | "canceled";
export type Topic =
  | "neighborhood"
  | "mutual_aid"
  | "local_business"
  | "housing"
  | "schools"
  | "transit"
  | "environment"
  | "civic_process"
  | "care";
export type PriceMode = "fixed" | "negotiable" | "free_service" | "free_advice";
export type ListingKind = "local_good" | "digital_guide" | "service";

export type User = {
  id: string;
  handle: string;
  displayName: string;
  bio: string;
  neighborhood: string;
  role: Role;
  avatarUrl: string | null;
  verification: { status: "not_available"; badge: null; label: string };
  createdAt: string;
  email?: string;
  moderator?: boolean;
  language?: string;
  counts?: { posts: number; listings: number; asks: number };
};

export type LinkedListing = {
  id: string;
  title: string | null;
  priceMode: PriceMode | null;
  priceCents: number | null;
  priceLabel: string | null;
  listingKind: ListingKind | null;
};

export type Playbook = {
  id: string;
  title: string;
  objective: string;
  weeks: number;
  steps: string;
  reviewStatus: "not_reviewed";
  saves: number;
  viewerSaved: boolean;
  viewerIsAuthor?: boolean;
  createdAt?: string;
  author?: User;
  linkedListing: LinkedListing | null;
};

export type Post = {
  id: string;
  kind: Kind;
  title: string;
  body: string;
  topic: Topic;
  priceMode: PriceMode | null;
  priceCents: number | null;
  priceLabel: string | null;
  listingKind: ListingKind | null;
  condition?: "new" | "good" | "fair" | "worn" | null;
  quantity?: number | null;
  availability?: "available" | "unavailable" | "sold" | "archived";
  handoff?: "pickup" | "delivery" | "either" | null;
  images?: Array<{ id: string; url: string }>;
  disclosureSponsor?: boolean;
  disclosurePaid?: boolean;
  disclosureAi?: boolean;
  commentsEnabled?: boolean;
  downloadAllowed?: boolean;
  heldForReview?: boolean;
  captionMode?: "off" | "sidecar" | "burn_in";
  coverHeadline?: string;
  captionUrl?: string | null;
  cards?: Array<{ kind: string; targetId: string; title: string | null; note: string; unavailable: boolean }>;
  rank?: { version: string; score: number; mode: string; reasons: Array<{ code: string; weight: number; value: number; text: string }> };
  digital?: {
    id: string;
    digitalForm: string | null;
    license: string | null;
    language: string | null;
    allowsResale: boolean;
    learningPurpose: string;
    payments: "not_available";
    accessNote: string;
    scan: { performed: boolean; label: string };
    personalizationPrompt: string;
    previews: Array<{ id: string; url: string; focalX: number; focalY: number }>;
    tags: string[];
    variants: Array<{ id: string; axisA: string; axisB: string; isFree: boolean; priceCents: number | null; sku: string; available: boolean; claimed: boolean; downloadable: boolean }>;
    files: Array<{ version: number; name: string; bytes: number; current: boolean }>;
  };
  mediaUrl: string | null;
  group: { id: string; name: string | null; visibility: "public" | "private" | null } | null;
  video: {
    id: string;
    status: "queued" | "processing" | "ready" | "failed";
    durationMs: number | null;
    width: number | null;
    height: number | null;
    error: string | null;
    posterUrl: string | null;
    fileUrl: string | null;
    moderation: "format_check_only";
  } | null;
  createdAt: string;
  updatedAt: string;
  edited: boolean;
  counts: { likes: number; comments: number };
  viewer: { liked: boolean; saved: boolean; isAuthor: boolean };
  author: User;
  playbook: Playbook | null;
  quote: {
    applicable: boolean;
    scheduleVersion: number;
    scheduleLabel: string | null;
    scheduleNote?: string | null;
    currency: "USD";
    listPriceCents: number | null;
    platformFeeBps?: number | null;
    platformFeeCents: number;
    sellerNetCents: number | null;
    buyerTotalCents: number | null;
    processorFeeCents: null;
    processorFeeStatus: "unknown_until_provider";
    charged: false;
    finalPricing: false;
    reason?: "no_fixed_price";
  } | null;
  poll: {
    subjectType: PollSubject;
    subjectLabel: string;
    closesAt: string | null;
    timezone: string;
    status: "open" | "closed" | "canceled";
    state: PollState;
    respondents: number;
    denominator: "respondents";
    viewerChoice: string | null;
    following: boolean;
    notice: string;
    options: Array<{ id: string; label: string; position: number; count: number; percent: number }>;
    history: Array<{ action: string; note: string; createdAt: string }>;
  } | null;
};

export type Comment = {
  id: string;
  body: string;
  createdAt: string;
  viewerIsAuthor: boolean;
  author: User;
};

export type Inquiry = {
  id: string;
  body: string;
  createdAt: string;
  from?: { handle: string; displayName: string; avatarUrl: string | null };
  post?: { id: string; title: string; kind: Kind; authorName?: string; authorHandle?: string };
};
