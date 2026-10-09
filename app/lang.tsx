"use client";

import { createContext, useContext } from "react";
import { translator, type T } from "@/lib/i18n";
import type { Language } from "@/lib/schema";

// The interface language. Text the model wrote stays in the language it was
// asked for; everything else follows this.
export const LangContext = createContext<Language>("en");

export function useT(): T {
  return translator(useContext(LangContext));
}
