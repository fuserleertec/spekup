"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { BarChart3, Bell, Bookmark, CalendarDays, ClipboardList, HeartHandshake, Home, Mail, Menu, Plus, Search, ShoppingBag, UserRound, UsersRound, X } from "lucide-react";
import { api, loadSession } from "@/lib/api";
import { applyLanguage, normalizeLang, tx, useLanguage } from "@/lib/i18n";
import type { Kind, Post, User } from "@/lib/types";
import { ComposeModal } from "./compose";
import { AppProvider } from "./context";
import { Logo } from "./icons";
import { Avatar } from "./ui";
import { EventDetail, EventsView, GroupDetail, GroupsView } from "./community";
import { SocialView } from "./social";
import { LibraryView, SellerShop } from "./digital";
import { CauseDetail } from "./causes";
import { ModerationView, NewReport, ReportDetail, ReportsView } from "./reports";
import { LanguagePicker } from "./language-picker";
import { MessagesView, ThreadView } from "./messages";
import { AccountView, AuthView, HelpView, MarketView, Missing, PlaybooksView, PollsView, PostDetail, ProfileView, ResetView, SavedView, Sidebar, VerifyView } from "./views";

const rail = [
  ["/", "social", "Social", Home],
  ["/help", "help", "Help", HeartHandshake],
  ["/reports", "reports", "Reports", ClipboardList],
  ["/polls", "polls", "Polls", BarChart3],
  ["/marketplace", "marketplace", "Market", ShoppingBag],
  ["/events", "events", "Events", CalendarDays],
  ["/groups", "groups", "Groups", UsersRound],
  ["/saved", "saved", "Saved", Bookmark],
  ["/messages", "messages", "Messages", Mail],
] as const;

const top = rail.filter(([href]) => href !== "/saved" && href !== "/messages");
const phone = [["/", "Social", Home], ["/help", "Help", HeartHandshake], ["/reports", "Reports", ClipboardList], ["/marketplace", "Market", ShoppingBag]] as const;
const moreHrefs = ["/polls", "/events", "/groups", "/messages"];

function onPath(href: string, pathname: string) {
  if (href === "/" && (pathname === "/" || pathname === "/social" || pathname === "/clips" || pathname === "/studio" || pathname.startsWith("/studio/") || pathname.startsWith("/post/"))) return true;
  if (href === "/marketplace" && (pathname === "/marketplace" || pathname.startsWith("/listing/"))) return true;
  if (href === "/reports" && pathname.startsWith("/reports")) return true;
  if (href === "/polls" && pathname === "/polls") return true;
  if (href === "/marketplace" && pathname === "/shop/new") return true;
  if (href === "/help" && (pathname === "/help" || pathname.startsWith("/causes"))) return true;
  if (href === "/help" && pathname.startsWith("/u/")) return false;
  if (href === "/messages" && pathname.startsWith("/messages")) return true;
  return pathname === href;
}

export function Shell() {
  useLanguage();
  const pathname = usePathname() || "/";
  const router = useRouter();
  const [me, setMe] = useState<User | null>(null);
  const [booting, setBooting] = useState(true);
  const [offline, setOffline] = useState("");
  const [q, setQ] = useState("");
  const [toastMessage, setToastMessage] = useState("");
  const [moreOpen, setMoreOpen] = useState(false);
  const [rev, setRev] = useState(0);
  const [composer, setComposer] = useState<{ kind: Kind; post: Post | null } | null>(null);
  const [unread, setUnread] = useState(0);

  const toast = (message: string) => {
    setToastMessage(message);
    window.setTimeout(() => setToastMessage(""), 2200);
  };
  const bump = () => setRev((value) => value + 1);
  async function refreshMe() {
    const user = await loadSession();
    setMe(user);
  }

  useEffect(() => {
    let cancel = false;
    loadSession().then((user) => { if (!cancel) { setMe(user); setOffline(""); } }).catch((err) => { if (!cancel) setOffline(err instanceof Error ? err.message : "Offline"); }).finally(() => { if (!cancel) setBooting(false); });
    return () => { cancel = true; };
  }, [rev]);

  useEffect(() => {
    const stored = window.localStorage.getItem("spekup_lang");
    const next = normalizeLang(me?.language || stored || navigator.language);
    applyLanguage(next).catch(() => undefined);
  }, [me?.language]);

  useEffect(() => {
    if (!me) { setUnread(0); return; }
    api<{ unread: number }>("/api/threads/summary").then((row) => setUnread(row.unread || 0)).catch(() => setUnread(0));
  }, [me, rev]);

  useEffect(() => {
    if (composer) document.body.dataset.shellComposer = "open";
    else delete document.body.dataset.shellComposer;
    return () => { delete document.body.dataset.shellComposer; };
  }, [composer]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setComposer(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const profileHref = me ? `/u/${me.handle}` : "/login";
  let main = <Missing />;
  if (pathname === "/" || pathname === "/social") main = <SocialView />;
  else if (pathname === "/clips") main = <SocialView video />;
  else if (pathname === "/studio") main = <SocialView compose />;
  else if (pathname.startsWith("/studio/")) main = <SocialView projectId={decodeURIComponent(pathname.split("/")[2] || "")} compose />;
  else if (pathname === "/help") main = <HelpView tab="asks" />;
  else if (pathname === "/causes") main = <HelpView tab="causes" />;
  else if (pathname === "/polls") main = <PollsView />;
  else if (pathname.startsWith("/causes/")) main = <CauseDetail id={decodeURIComponent(pathname.split("/")[2] || "")} />;
  else if (pathname === "/reports") main = <ReportsView />;
  else if (pathname === "/reports/new") main = <NewReport />;
  else if (pathname.startsWith("/reports/")) main = <ReportDetail id={decodeURIComponent(pathname.split("/")[2] || "")} />;
  else if (pathname === "/moderation") main = <ModerationView />;
  else if (pathname === "/playbooks") main = <PlaybooksView />;
  else if (pathname === "/marketplace") main = <MarketView />;
  else if (pathname === "/shop/new") main = <MarketView startDigital />;
  else if (pathname === "/library") main = <LibraryView />;
  else if (pathname.startsWith("/sellers/")) main = <SellerShop handle={decodeURIComponent(pathname.split("/")[2] || "")} />;
  else if (pathname === "/events") main = <EventsView />;
  else if (pathname === "/groups") main = <GroupsView />;
  else if (pathname.startsWith("/g/")) main = <GroupDetail id={decodeURIComponent(pathname.split("/")[2] || "")} />;
  else if (pathname.startsWith("/event/")) main = <EventDetail id={decodeURIComponent(pathname.split("/")[2] || "")} />;
  else if (pathname === "/saved") main = <SavedView />;
  else if (pathname === "/messages") main = <MessagesView />;
  else if (pathname.startsWith("/messages/")) main = <ThreadView id={decodeURIComponent(pathname.split("/")[2] || "")} />;
  else if (pathname === "/login") main = <AuthView mode="login" />;
  else if (pathname === "/signup") main = <AuthView mode="signup" />;
  else if (pathname === "/account") main = <AccountView />;
  else if (pathname === "/reset") main = <ResetView />;
  else if (pathname === "/verify") main = <VerifyView />;
  else if (pathname.startsWith("/u/")) main = <ProfileView handle={decodeURIComponent(pathname.split("/")[2] || "")} />;
  else if (pathname.startsWith("/post/") || pathname.startsWith("/listing/")) main = <PostDetail id={decodeURIComponent(pathname.split("/")[2] || "")} />;

  return (
    <AppProvider value={{
      me, booting, offline, q, setQ, toast, rev, bump, refreshMe,
      openComposer: (kind: Kind = "share", post: Post | null = null) => setComposer({ kind, post }),
    }}>
      <div className="min-h-screen">
        <header className="sticky top-0 z-40 border-b border-white/60 bg-ivory/70 shadow-[0_8px_30px_-20px_rgba(23,55,45,.4)] backdrop-blur-xl">
          <div className="mx-auto flex h-16 max-w-[1320px] items-center gap-3 px-4 lg:px-6">
            <Link href="/" aria-label="Spekup home"><Logo /></Link>
            <div className="ml-2 hidden min-w-0 flex-1 items-center gap-2 rounded-full bg-white/80 px-4 py-2 ring-1 ring-forest/10 xl:flex xl:max-w-[240px]">
              <Search className="h-4 w-4 text-forest/70" />
              <input aria-label={tx("Search Spekup")} value={q} onChange={(e) => setQ(e.target.value)} placeholder={tx("Search Spekup")} className="w-full bg-transparent text-sm outline-none" />
              {q && <button aria-label="Clear search" onClick={() => setQ("")}><X className="h-4 w-4" /></button>}
            </div>
            <nav aria-label="Primary" className="mx-auto hidden items-center gap-1 lg:flex">
              {top.map(([href, , label, Icon]) => {
                const on = onPath(href, pathname);
                return (
                  <Link key={href} href={href} aria-label={label} aria-current={on ? "page" : undefined} className="group relative flex flex-col items-center">
                    <span className={`grid h-11 place-items-center rounded-full shadow-[0_6px_16px_-8px_rgba(23,55,45,0.35)] ${on ? "w-14 bg-sage text-forest" : "w-11 bg-white text-forest"}`}><Icon className="h-5 w-5" /></span>
                    <span className="tip absolute left-1/2 top-full z-50 mt-1 -translate-x-1/2 whitespace-nowrap rounded-full bg-white px-2.5 py-0.5 text-[11px] font-semibold text-forest shadow-md">{tx(label)}</span>
                  </Link>
                );
              })}
            </nav>
            <div className="ml-auto flex items-center gap-2">
              <button aria-label="Create post" onClick={() => me ? setComposer({ kind: "share", post: null }) : router.push("/login")} className="group relative hidden h-10 w-10 place-items-center rounded-full bg-sage hover:bg-gold/30 sm:grid"><Plus className="h-5 w-5" /><span role="tooltip" className="tip absolute left-1/2 top-full z-50 mt-2 whitespace-nowrap rounded-full bg-forest px-3 py-1.5 text-xs font-semibold text-ivory shadow-lg">{tx("Create")}</span></button>
              {me && <Link href="/messages" aria-label={unread ? `${tx("Messages")}, ${unread} unread` : tx("Messages")} className="relative grid h-10 w-10 place-items-center rounded-full bg-sage hover:bg-gold/30"><Mail className="h-5 w-5" />{unread > 0 && <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-gold px-1 text-[10px] font-semibold text-forest">{unread}</span>}</Link>}
              <LanguagePicker />
              <button aria-label={tx("Notifications")} onClick={() => toast(tx("Notifications aren't available in this preview."))} className="group relative hidden h-10 w-10 place-items-center rounded-full bg-sage hover:bg-gold/30 sm:grid"><Bell className="h-5 w-5" /><span role="tooltip" className="tip absolute left-1/2 top-full z-50 mt-2 whitespace-nowrap rounded-full bg-forest px-3 py-1.5 text-xs font-semibold text-ivory shadow-lg">{tx("Notifications")}</span></button>
              {me ? (
                <Link href={profileHref} aria-label="Profile" className="group relative"><Avatar user={me} className="h-10 w-10 rounded-full text-xs ring-2 ring-gold/60" /></Link>
              ) : (
                <Link href="/login" className="rounded-full bg-forest px-4 py-2 text-sm font-semibold text-ivory">{tx("Log in")}</Link>
              )}
            </div>
          </div>
          <div className="no-scrollbar flex gap-1 overflow-x-auto px-3 pb-2 lg:hidden">
            {rail.map(([href, , label]) => <Link key={href} href={href} className={`whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm ${onPath(href, pathname) ? "bg-forest text-ivory" : "text-forest/70"}`}>{tx(label)}</Link>)}
          </div>
          <div className="search-compact px-4 pb-2 xl:hidden">
            <div className="flex items-center gap-2 rounded-full bg-white/80 px-4 py-2 ring-1 ring-forest/10">
              <Search className="h-4 w-4 text-forest/70" />
              <input aria-label={tx("Search Spekup")} value={q} onChange={(e) => setQ(e.target.value)} placeholder={tx("Search")} className="w-full bg-transparent text-sm outline-none" />
            </div>
          </div>
        </header>
        {offline && <p className="mx-auto max-w-[1320px] px-4 pt-3 text-sm text-forest">{offline}</p>}
        <div className="mx-auto flex max-w-[1320px] gap-6 px-4 pb-32 pt-5 lg:px-6 lg:pb-10">
          <nav aria-label="Shortcuts" className="sticky top-24 hidden h-fit w-[72px] shrink-0 flex-col items-center gap-2 rounded-full bg-white/70 p-2 shadow-[0_10px_30px_-18px_rgba(23,55,45,.4)] ring-1 ring-white backdrop-blur">
            {rail.map(([href, , label, Icon]) => {
              const on = onPath(href, pathname);
              return (
                <Link key={href} href={href} aria-label={href === "/messages" && unread ? `${tx("Messages")}, ${unread} unread` : tx(label)} className={`group relative grid h-12 w-12 place-items-center rounded-full outline-none transition focus-visible:ring-2 focus-visible:ring-gold ${on ? "bg-forest text-ivory shadow-lg" : "text-forest/70 hover:bg-sage hover:text-forest"}`}>
                  <Icon className="h-5 w-5 transition-transform group-hover:scale-110" />
                  {href === "/messages" && unread > 0 && <span className="absolute right-0 top-0 grid h-4 min-w-4 place-items-center rounded-full bg-gold px-1 text-[10px] font-semibold text-forest">{unread}</span>}
                  <span role="tooltip" className="tipr absolute left-full top-1/2 z-50 ml-3 whitespace-nowrap rounded-full bg-forest px-3 py-1.5 text-xs font-semibold text-ivory shadow-lg">{tx(label)}</span>
                </Link>
              );
            })}
            <div className="my-1 h-px w-8 bg-forest/10" />
            <Link href={profileHref} aria-label="Profile" className="group relative">
              {me ? <Avatar user={me} className={`h-11 w-11 rounded-full text-xs ${pathname.startsWith("/u/") ? "ring-2 ring-gold" : ""}`} /> : <UserRound className="h-5 w-5 text-forest/70" />}
              <span role="tooltip" className="tipr absolute left-full top-1/2 z-50 ml-3 whitespace-nowrap rounded-full bg-forest px-3 py-1.5 text-xs font-semibold text-ivory shadow-lg">{tx("Profile")}</span>
            </Link>
          </nav>
          <main className="min-w-0 flex-1">
            {booting ? <div className="h-40 rounded-[30px] bg-white/70 motion-safe:animate-pulse" /> : main}
            <p className="mt-8 text-center text-[11px] leading-relaxed text-forest/70 xl:hidden">{tx("Spekup is a neighbor-run community space, not a government agency. Verification and payments are not available. Reports are allegations until a moderator publishes them. Polls are opinions, not verdicts.")}</p>
          </main>
          {!["/", "/social", "/help", "/causes", "/reports", "/polls", "/marketplace", "/shop/new", "/events", "/groups"].includes(pathname) && <div className="sticky top-24 hidden h-[calc(100vh-7rem)] w-80 shrink-0 overflow-y-auto no-scrollbar xl:block"><Sidebar /></div>}
        </div>
        {moreOpen && (
          <div className="fixed inset-x-3 bottom-20 z-30 rounded-3xl bg-white p-2 shadow-xl ring-1 ring-forest/10 lg:hidden">
            {moreHrefs.map((href) => {
              const item = rail.find((entry) => entry[0] === href);
              if (!item) return null;
              const [, , label, Icon] = item;
              return <Link key={href} href={href} onClick={() => setMoreOpen(false)} className={`flex items-center gap-3 rounded-2xl px-3 py-2 text-sm ${onPath(href, pathname) ? "bg-sage font-semibold text-forest" : "text-forest"}`}><Icon className="h-5 w-5" />{tx(label)}</Link>;
            })}
            <Link href={profileHref} onClick={() => setMoreOpen(false)} className="flex items-center gap-3 rounded-2xl px-3 py-2 text-sm text-forest"><UserRound className="h-5 w-5" />{tx("Me")}</Link>
            <LanguagePicker compact />
            {unread > 0 && <p className="px-3 py-1 text-xs text-forest/70">{unread} unread</p>}
          </div>
        )}
        <nav className="fixed inset-x-3 bottom-3 z-30 flex rounded-full border border-white bg-white/80 shadow-xl backdrop-blur lg:hidden">
          {phone.map(([href, label, Icon]) => (
            <Link key={href} href={href} className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] ${onPath(href, pathname) ? "font-semibold text-forest" : "text-forest/70"}`}><Icon className="h-6 w-6" />{tx(label)}</Link>
          ))}
          <button type="button" aria-expanded={moreOpen} onClick={() => setMoreOpen((value) => !value)} className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] ${moreOpen || moreHrefs.some((href) => onPath(href, pathname)) ? "font-semibold text-forest" : "text-forest/70"}`}><Menu className="h-6 w-6" />{tx("More")}</button>
        </nav>
        {composer && (
          <div className="fixed inset-0 z-[60] flex items-end justify-center bg-forest/40 backdrop-blur-sm sm:items-center" onClick={() => setComposer(null)}>
            <div role="dialog" aria-modal="true" aria-label={composer.post ? "Edit post" : "Create a post"} onClick={(e) => e.stopPropagation()} className="mb-[5.75rem] max-h-[calc(100dvh-8.5rem)] w-full max-w-lg overflow-y-auto rounded-t-[32px] bg-ivory p-6 shadow-2xl sm:mb-0 sm:max-h-[90vh] sm:rounded-[32px]">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="font-serif text-2xl font-semibold">{composer.post ? "Edit post" : "Create a post"}</h2>
                <button aria-label="Close" onClick={() => setComposer(null)} className="grid h-9 w-9 place-items-center rounded-full bg-sage"><X className="h-4 w-4" /></button>
              </div>
              <ComposeModal kind={composer.kind} post={composer.post} onClose={() => setComposer(null)} />
            </div>
          </div>
        )}
        {toastMessage && <div role="status" aria-live="polite" className="app-toast rounded-full bg-forest px-5 py-2.5 text-center text-sm text-ivory shadow-lg">{toastMessage}</div>}
      </div>
    </AppProvider>
  );
}
