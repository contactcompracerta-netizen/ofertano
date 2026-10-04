"use client";

type GlobalErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function GlobalError({ reset }: GlobalErrorProps) {
  return (
    <html lang="pt-BR">
      <body
        style={{
          display: "flex",
          minHeight: "100vh",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "#f8fafc",
          color: "#0f172a",
          fontFamily: "system-ui, sans-serif",
          textAlign: "center",
          padding: "1rem",
        }}
      >
        <h1 style={{ fontSize: "1.5rem", fontWeight: 800 }}>
          Algo deu errado
        </h1>
        <p style={{ marginTop: "0.75rem", color: "#475569" }}>
          Não foi possível carregar o Ofertano agora. Tente novamente em
          instantes.
        </p>
        <button
          type="button"
          onClick={reset}
          style={{
            marginTop: "1.5rem",
            borderRadius: "0.5rem",
            background: "#059669",
            color: "#fff",
            padding: "0.75rem 1.25rem",
            fontWeight: 800,
            border: "none",
            cursor: "pointer",
          }}
        >
          Tentar novamente
        </button>
      </body>
    </html>
  );
}
