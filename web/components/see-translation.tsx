"use client";

import { useEffect, useState } from "react";
import { Languages } from "lucide-react";
import { api } from "@/lib/api";
import { normalizeLang, tx } from "@/lib/i18n";
import i18n from "i18next";
import { useApp } from "./context";

let enabledCache: boolean | null = null;
let enabledLoad: Promise<boolean> | null = null;

function loadEnabled() {
  enabledLoad ||= api<{ enabled: boolean }>("/api/translate").then((row) => { enabledCache = row.enabled; return row.enabled; }).catch(() => { enabledCache = false; return false; });
  return enabledLoad;
}

export function useTranslateEnabled() {
  const [enabled, setEnabled] = useState(enabledCache === true);
  useEffect(() => {
    let cancel = false;
    loadEnabled().then((value) => { if (!cancel) setEnabled(value); });
    return () => { cancel = true; };
  }, []);
  return enabled;
}

export function useContentTranslation(parts: Array<{ kind: string; id: string; text: string }>) {
  const { toast } = useApp();
  const enabled = useTranslateEnabled();
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [map, setMap] = useState<Record<string, string>>({});
  async function toggle() {
    if (!enabled) return;
    if (on) { setOn(false); return; }
    if (Object.keys(map).length > 0) { setOn(true); return; }
    setBusy(true);
    try {
      const target = normalizeLang(i18n.resolvedLanguage || i18n.language);
      const next: Record<string, string> = {};
      for (const part of parts) {
        if (!part.text.trim()) continue;
        const row = await api<{ text: string }>("/api/translate", { json: { kind: part.kind, id: part.id, target } });
        next[`${part.kind}:${part.id}`] = row.text;
      }
      setMap(next);
      setOn(true);
    } catch (err) {
      toast(err instanceof Error ? err.message : tx("Translation is unavailable right now"));
    } finally {
      setBusy(false);
    }
  }
  function textFor(kind: string, id: string, fallback: string) {
    if (!on) return fallback;
    return map[`${kind}:${id}`] ?? fallback;
  }
  return { enabled: enabled && parts.some((part) => part.text.trim()), on, busy, toggle, textFor };
}

export function TranslateButton({ on, busy, onClick }: { on: boolean; busy: boolean; onClick: () => void }) {
  return (
    <button type="button" data-testid="see-translation" onClick={onClick} disabled={busy} className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-goldink">
      <Languages className="h-3 w-3" />
      {busy ? tx("Translating…") : on ? tx("See original") : tx("See translation")}
    </button>
  );
}
