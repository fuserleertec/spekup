"use client";

import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next, useTranslation } from "react-i18next";
import es from "@/locales/es.json";
import ptBR from "@/locales/pt-BR.json";
import ja from "@/locales/ja.json";
import ko from "@/locales/ko.json";
import zhCN from "@/locales/zh-CN.json";

export const LANGUAGES = [
  { code: "en", label: "English" },
  { code: "pt-BR", label: "Português (Brasil)" },
  { code: "es", label: "Español" },
  { code: "ja", label: "日本語" },
  { code: "ko", label: "한국어" },
  { code: "zh-CN", label: "简体中文" },
] as const;

export type LangCode = (typeof LANGUAGES)[number]["code"];

const BY_BASE: Record<string, LangCode> = { pt: "pt-BR", zh: "zh-CN", es: "es", ja: "ja", ko: "ko", en: "en" };

export function normalizeLang(value: string | null | undefined): LangCode {
  const raw = (value || "").trim();
  if (LANGUAGES.some((item) => item.code === raw)) return raw as LangCode;
  return BY_BASE[raw.split("-")[0].toLowerCase()] || "en";
}

if (!i18n.isInitialized) {
  i18n.use(LanguageDetector).use(initReactI18next).init({
    resources: {
      en: { translation: {} },
      es: { translation: es },
      "pt-BR": { translation: ptBR },
      ja: { translation: ja },
      ko: { translation: ko },
      "zh-CN": { translation: zhCN },
    },
    lng: "en",
    fallbackLng: "en",
    supportedLngs: LANGUAGES.map((item) => item.code),
    keySeparator: false,
    nsSeparator: false,
    interpolation: { escapeValue: false },
    returnNull: false,
    initImmediate: false,
    detection: {
      order: ["localStorage", "navigator"],
      lookupLocalStorage: "spekup_lang",
      caches: ["localStorage"],
      convertDetectedLanguage: (lng: string) => normalizeLang(lng),
    },
    react: { useSuspense: false },
  });
}

export function tx(text: string, vars?: Record<string, string | number>) {
  return i18n.t(text, { defaultValue: text, ...(vars || {}) });
}

export function useLanguage() {
  const { i18n: instance } = useTranslation();
  return normalizeLang(instance.resolvedLanguage || instance.language);
}

export async function applyLanguage(code: string) {
  const next = normalizeLang(code);
  if (typeof window !== "undefined") {
    window.localStorage.setItem("spekup_lang", next);
    document.documentElement.lang = next;
  }
  await i18n.changeLanguage(next);
  return next;
}
