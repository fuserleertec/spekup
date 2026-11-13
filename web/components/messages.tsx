"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { tx } from "@/lib/i18n";
import { TranslateButton, useContentTranslation } from "./see-translation";
import { useApp } from "./context";
import { Card, Empty, Heading, Skeleton, areaClass } from "./ui";

type ThreadRow = {
  id: string;
  postId: string;
  title: string;
  other: { handle: string; displayName: string };
  lastMessage: string | null;
  lastAt: string | null;
  unread: number;
};

function MessageLine({ message }: { message: { id: string; body: string; createdAt: string; mine: boolean; read: boolean; author: { displayName: string } } }) {
  const translated = useContentTranslation([{ kind: "message", id: message.id, text: message.body }]);
  return (
    <p className="rounded-2xl bg-sage px-3 py-2 text-sm">
      <b>{message.author.displayName}</b> · {new Date(message.createdAt).toLocaleString()} · {message.mine ? (message.read ? "Read" : "Sent") : "Received"}
      <span className="mt-1 block whitespace-pre-wrap">{translated.textFor("message", message.id, message.body)}</span>
      {translated.enabled && <TranslateButton on={translated.on} busy={translated.busy} onClick={translated.toggle} />}
    </p>
  );
}

export function MessagesView() {
  const { me } = useApp();
  const [threads, setThreads] = useState<ThreadRow[] | null>(null);
  useEffect(() => {
    if (!me) return;
    api<{ threads: ThreadRow[] }>("/api/threads").then((row) => setThreads(row.threads)).catch(() => setThreads([]));
  }, [me]);
  if (!me) return <Empty><Link href="/login" className="underline">{tx("Log in")}</Link></Empty>;
  return (
    <div className="space-y-4" data-testid="inbox">
      <Heading sub={tx("Private notes about a listing. You'll see replies here. Nothing is emailed.")}>{tx("Messages")}</Heading>
      {threads === null ? <Skeleton /> : threads.length === 0 ? <Empty>{tx("No messages yet.")}</Empty> : threads.map((thread) => (
        <Card key={thread.id} className="p-4">
          <Link href={`/messages/${thread.id}`} className="block">
            <p className="text-xs text-forest/60">{thread.other.displayName}{thread.unread ? ` · ${thread.unread} unread` : ""}</p>
            <h2 className="font-serif text-xl font-semibold">{thread.title}</h2>
            <p className="mt-1 text-sm text-forest/80">{thread.lastMessage || "No message yet."}</p>
          </Link>
        </Card>
      ))}
    </div>
  );
}

export function ThreadView({ id }: { id: string }) {
  const { me, toast, bump } = useApp();
  const [body, setBody] = useState("");
  const [data, setData] = useState<{ thread: { title: string; postId: string; other: { displayName: string }; muted: boolean; note: string }; messages: Array<{ id: string; body: string; createdAt: string; mine: boolean; read: boolean; author: { displayName: string } }> } | null>(null);
  const [error, setError] = useState("");
  function load(refreshNav = false) {
    api<NonNullable<typeof data>>(`/api/threads/${id}`).then((row) => { setData(row); setError(""); if (refreshNav) bump(); }).catch((err) => setError(err instanceof Error ? err.message : "Not found."));
  }
  useEffect(() => { if (me) load(false); }, [me?.id, id]);
  if (!me) return <Empty><Link href="/login" className="underline">Log in</Link> to read this.</Empty>;
  if (error) return <Empty>{error}</Empty>;
  if (!data) return <Skeleton />;
  return (
    <div className="space-y-4" data-testid="thread">
      <Link href="/messages" className="text-sm text-goldink">{tx("All messages")}</Link>
      <Heading sub={tx(data.thread.note)}>{data.thread.title}</Heading>
      <p className="text-sm text-forest/70">{tx("With {{name}}.", { name: data.thread.other.displayName })} <Link className="underline" href={`/listing/${data.thread.postId}`}>{tx("Open the listing")}</Link></p>
      {data.thread.muted && <p className="text-sm text-forest/70">{tx("You muted this person in Social. Mute does not block messages.")}</p>}
      <Card className="space-y-3 p-4">
        {data.messages.map((message) => (
          <MessageLine key={message.id} message={message} />
        ))}
        <p className="text-xs text-forest/70">{tx("You'll see replies here.")}</p>
      </Card>
      <form className="space-y-2" onSubmit={async (event) => {
        event.preventDefault();
        try {
          await api(`/api/threads/${id}/messages`, { json: { body } });
          setBody("");
          load(true);
        } catch (err) { toast(err instanceof Error ? err.message : "Not sent."); }
      }}>
        <textarea aria-label={tx("Reply")} value={body} onChange={(e) => setBody(e.target.value)} rows={3} className={areaClass} placeholder={tx("Reply")} />
        <button className="rounded-full bg-forest px-4 py-2 text-sm font-semibold text-ivory">{tx("Send reply")}</button>
      </form>
    </div>
  );
}
