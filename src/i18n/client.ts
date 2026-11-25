"use client";
import { useMemo } from "react";
import { useLocale } from "next-intl";
import { makeFormat } from "@/lib/format";
import { isLocale, DEFAULT_LOCALE } from "./config";

export function useFormat() {
  const l = useLocale();
  return useMemo(() => makeFormat(isLocale(l) ? l : DEFAULT_LOCALE), [l]);
}
