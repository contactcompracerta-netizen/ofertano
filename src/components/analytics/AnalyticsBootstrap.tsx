"use client";

import { useEffect } from "react";

import { bootstrapAnalytics } from "@/lib/analytics/tracker";

export default function AnalyticsBootstrap() {
  useEffect(() => {
    bootstrapAnalytics();
  }, []);

  return null;
}
