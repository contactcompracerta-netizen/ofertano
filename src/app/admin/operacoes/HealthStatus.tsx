"use client";

import { useEffect, useState } from "react";

import styles from "./operations.module.css";

type HealthState = "UNKNOWN" | "OK" | "ERROR";

export default function HealthStatus() {
  const [status, setStatus] = useState<HealthState>("UNKNOWN");

  useEffect(() => {
    const controller = new AbortController();

    fetch("/api/health", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as
          | { status?: string }
          | null;
        if (!controller.signal.aborted) {
          setStatus(response.ok && body?.status === "ok" ? "OK" : "ERROR");
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setStatus("UNKNOWN");
      });

    return () => controller.abort();
  }, []);

  return (
    <span
      className={styles.status}
      data-status={status}
      aria-live="polite"
      aria-label={`API Health: ${status}`}
    >
      {status}
    </span>
  );
}