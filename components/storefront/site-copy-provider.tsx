"use client";

import { createContext, useCallback, useContext } from "react";

import type { SiteCopyDictionary } from "@/src/modules/site-copy/copy";

const SiteCopyContext = createContext<SiteCopyDictionary | null>(null);

export function SiteCopyProvider({
  copy,
  children,
}: {
  copy: SiteCopyDictionary;
  children: React.ReactNode;
}) {
  return <SiteCopyContext value={copy}>{children}</SiteCopyContext>;
}

export function useSiteCopy(): (key: string) => string {
  const copy = useContext(SiteCopyContext);
  if (!copy)
    throw new Error("useSiteCopy must be used within SiteCopyProvider");
  return useCallback(
    (key: string) => {
      const value = copy[key];
      if (value === undefined)
        throw new Error(`Missing required site copy: ${key}`);
      return value;
    },
    [copy],
  );
}
