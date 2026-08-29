"use client";

import { useCallback, useEffect, useState } from "react";

type PushStatus =
  | "idle"
  | "unsupported"
  | "denied"
  | "prompt"
  | "enabled"
  | "disabled"
  | "loading"
  | "error";

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const raw = window.atob(base64);
  const output = new Uint8Array(raw.length);

  for (let index = 0; index < raw.length; index += 1) {
    output[index] = raw.charCodeAt(index);
  }

  return output;
}

async function getCurrentSubscription() {
  const registration = await navigator.serviceWorker.getRegistration("/admin/");
  return registration?.pushManager.getSubscription() ?? null;
}

export default function AdminPushButton() {
  const [status, setStatus] = useState<PushStatus>("idle");
  const [message, setMessage] = useState("");

  const refreshStatus = useCallback(async () => {
    if (
      typeof window === "undefined" ||
      !("Notification" in window) ||
      !("serviceWorker" in navigator) ||
      !("PushManager" in window)
    ) {
      setStatus("unsupported");
      setMessage("Este navegador não suporta Web Push.");
      return;
    }

    if (Notification.permission === "denied") {
      setStatus("denied");
      setMessage("As notificações foram bloqueadas neste navegador.");
      return;
    }

    const subscription = await getCurrentSubscription();

    if (subscription) {
      setStatus("enabled");
      setMessage("Notificações ativas neste dispositivo.");
      return;
    }

    setStatus(Notification.permission === "granted" ? "disabled" : "prompt");
    setMessage("");
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  async function enableNotifications() {
    try {
      setStatus("loading");
      setMessage("");

      const vapidResponse = await fetch("/api/admin/push/vapid", {
        method: "GET",
        credentials: "include",
        cache: "no-store",
      });

      const vapidData = (await vapidResponse.json()) as {
        success?: boolean;
        publicKey?: string;
        error?: string;
      };

      if (!vapidResponse.ok || !vapidData.publicKey) {
        throw new Error(
          vapidData.error ||
            "Notificações push ainda não estão configuradas.",
        );
      }

      const permission = await Notification.requestPermission();

      if (permission !== "granted") {
        setStatus(permission === "denied" ? "denied" : "prompt");
        setMessage(
          permission === "denied"
            ? "As notificações foram bloqueadas neste navegador."
            : "Permissão não concedida.",
        );
        return;
      }

      const registration = await navigator.serviceWorker.register("/admin/sw.js", {
        scope: "/admin/",
      });
      await navigator.serviceWorker.ready;

      const existing = await registration.pushManager.getSubscription();
      const subscription =
        existing ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidData.publicKey),
        }));

      const payload = subscription.toJSON();

      const response = await fetch("/api/admin/push/subscribe", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          endpoint: payload.endpoint,
          keys: payload.keys,
          userAgent: navigator.userAgent,
        }),
      });

      const data = (await response.json()) as {
        success?: boolean;
        duplicated?: boolean;
        error?: string;
        message?: string;
      };

      if (!response.ok || !data.success) {
        throw new Error(data.error || "Não foi possível registrar o dispositivo.");
      }

      setStatus("enabled");
      setMessage(
        data.duplicated
          ? "Este dispositivo já estava registrado."
          : "Notificações ativadas neste dispositivo.",
      );
    } catch (error) {
      setStatus("error");
      setMessage(
        error instanceof Error
          ? error.message
          : "Não foi possível ativar as notificações.",
      );
    }
  }

  async function disableNotifications() {
    try {
      setStatus("loading");

      const subscription = await getCurrentSubscription();

      if (subscription) {
        await fetch("/api/admin/push/subscribe", {
          method: "DELETE",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            endpoint: subscription.endpoint,
          }),
        });

        await subscription.unsubscribe();
      }

      setStatus("disabled");
      setMessage("Notificações desativadas neste dispositivo.");
    } catch (error) {
      setStatus("error");
      setMessage(
        error instanceof Error
          ? error.message
          : "Não foi possível desativar as notificações.",
      );
    }
  }

  const enabled = status === "enabled";
  const loading = status === "loading";
  const blocked = status === "unsupported" || status === "denied";

  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <button
          type="button"
          onClick={() =>
            void (enabled ? disableNotifications() : enableNotifications())
          }
          disabled={loading || blocked}
          className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
        >
          {loading
            ? "Aguarde..."
            : enabled
              ? "Desativar notificações"
              : "Ativar notificações"}
        </button>

        {message ? (
          <p className="text-sm leading-5 text-emerald-900">{message}</p>
        ) : (
          <p className="text-sm leading-5 text-emerald-800">
            Receba um aviso quando o Mercado Livre tiver o menor preço e faltar o
            link afiliado.
          </p>
        )}
      </div>
    </div>
  );
}
