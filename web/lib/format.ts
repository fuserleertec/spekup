import type { Kind, ListingKind, PriceMode, Role, Topic } from "./types";

export const TOPICS: { id: Topic; label: string }[] = [
  { id: "neighborhood", label: "Neighborhood" },
  { id: "mutual_aid", label: "Mutual aid" },
  { id: "local_business", label: "Local business" },
  { id: "housing", label: "Housing" },
  { id: "schools", label: "Schools" },
  { id: "transit", label: "Transit" },
  { id: "environment", label: "Environment" },
  { id: "civic_process", label: "Civic process" },
  { id: "care", label: "Care" },
];

export const ROLES: { id: Role; label: string }[] = [
  { id: "resident", label: "Resident" },
  { id: "organizer", label: "Local organizer" },
  { id: "civic_professional", label: "Civic professional" },
  { id: "community_business", label: "Community business" },
];

export const PRICE_MODES: { id: PriceMode; label: string }[] = [
  { id: "fixed", label: "Fixed amount" },
  { id: "negotiable", label: "Negotiable" },
  { id: "free_service", label: "Free service" },
  { id: "free_advice", label: "Free advice" },
];

export const LISTING_KINDS: { id: ListingKind; label: string }[] = [
  { id: "local_good", label: "Local good" },
  { id: "digital_guide", label: "Digital guide" },
  { id: "service", label: "Service" },
];

export function topicLabel(id: Topic) {
  return TOPICS.find((t) => t.id === id)?.label || id;
}

export function roleLabel(id: Role) {
  return ROLES.find((r) => r.id === id)?.label || id;
}

export function listingLabel(id: ListingKind | null) {
  return LISTING_KINDS.find((k) => k.id === id)?.label || "";
}

export function kindLabel(id: Kind) {
  if (id === "share") return "Share";
  if (id === "ask") return "Ask";
  if (id === "poll") return "Poll";
  return "Offer";
}

export function ago(iso: string) {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export function centsToInput(cents: number | null) {
  if (cents == null) return "";
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}
