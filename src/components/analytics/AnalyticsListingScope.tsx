"use client";

import {
  createContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

import { beginListingOccurrence } from "@/lib/analytics/tracker";

export const ListingOccurrenceContext = createContext<string | null>(null);

type AnalyticsListingScopeProps = {
  surface: string;
  scope?: string;
  children: ReactNode;
};

export default function AnalyticsListingScope({
  surface,
  scope = "",
  children,
}: AnalyticsListingScopeProps) {
  const [occurrenceId, setOccurrenceId] = useState<string | null>(null);

  useEffect(() => {
    let ativo = true;
    void Promise.resolve().then(() => {
      if (ativo) {
        setOccurrenceId(beginListingOccurrence(surface, scope));
      }
    });
    return () => {
      ativo = false;
    };
  }, [surface, scope]);

  return (
    <ListingOccurrenceContext.Provider value={occurrenceId}>
      {children}
    </ListingOccurrenceContext.Provider>
  );
}
