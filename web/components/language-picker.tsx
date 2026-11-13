"use client";

import { useState } from "react";
import { Check, Globe } from "lucide-react";
import { api } from "@/lib/api";
import { LANGUAGES, applyLanguage, tx, useLanguage } from "@/lib/i18n";
import { useApp } from "./context";

export function LanguagePicker({ compact = false }: { compact?: boolean }) {
  const { me, toast } = useApp();
  const current = useLanguage();
  const [open, setOpen] = useState(false);
  async function pick(code: string) {
    if (code === current) { setOpen(false); return; }
    if (me) {
      try { await api("/api/me/language", { method: "PUT", json: { language: code } }); }
      catch (err) { toast(err instanceof Error ? err.message : tx("Couldn't change the language. Try again.")); return; }
    }
    await applyLanguage(code);
    setOpen(false);
  }
  if (compact) {
    return (
      <div className="px-3 py-2">
        <p className="px-1 pb-1 text-xs font-semibold text-forest/70">{tx("Language")}</p>
        {LANGUAGES.map((item) => (
          <button key={item.code} type="button" data-testid={`language-option-${item.code}`} onClick={() => pick(item.code)} className="flex w-full items-center gap-2 rounded-2xl px-3 py-2 text-left text-sm text-forest">
            <span className="flex-1">{item.label}</span>
            {item.code === current && <Check className="h-4 w-4 text-goldink" />}
          </button>
        ))}
      </div>
    );
  }
  return (
    <div className="relative">
      <button type="button" data-testid="language-picker" aria-label={tx("Language")} aria-expanded={open} onClick={() => setOpen((value) => !value)} className="grid h-10 w-10 place-items-center rounded-full bg-sage hover:bg-gold/30">
        <Globe className="h-5 w-5" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-50 mt-2 w-52 rounded-2xl bg-ivory p-1 shadow-xl ring-1 ring-forest/10">
          {LANGUAGES.map((item) => (
            <button key={item.code} type="button" role="menuitem" data-testid={`language-option-${item.code}`} onClick={() => pick(item.code)} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm hover:bg-sage">
              <span className="flex-1">{item.label}</span>
              {item.code === current && <Check className="h-4 w-4 text-goldink" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
