"use client";

import { createContext, useContext } from "react";
import type { Kind, Post, User } from "@/lib/types";

export type AppState = {
  me: User | null;
  booting: boolean;
  offline: string;
  q: string;
  setQ: (value: string) => void;
  toast: (message: string) => void;
  rev: number;
  bump: () => void;
  refreshMe: () => Promise<void>;
  openComposer: (kind?: Kind, post?: Post | null) => void;
};

const Ctx = createContext<AppState | null>(null);

export const AppProvider = Ctx.Provider;

export function useApp() {
  const value = useContext(Ctx);
  if (!value) throw new Error("Spekup shell is missing.");
  return value;
}
